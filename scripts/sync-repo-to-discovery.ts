import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type RepoChunkRow = {
  id: string;
  repo: string;
  branch: string;
  commitSha: string;
  sourceBlobSha: string;
  path: string;
  lineStart: number;
  lineEnd: number;
  chunkType: string;
  language: string | null;
  symbol: string | null;
  chunkContent: string;
  contentHash: string;
  governanceRefs: string[] | null;
  indexedAt: unknown;
};

type DiscoveryOperation = {
  name?: string;
  done?: boolean;
  error?: {
    code?: number;
    message?: string;
  };
  metadata?: Record<string, unknown>;
};

type DiscoveryListResponse = {
  documents?: unknown[];
};

const DATA_SCHEMA = "document";
const DEFAULT_LIMIT = 5_000;

type SpannerJsonResult = {
  metadata?: {
    rowType?: {
      fields?: Array<{ name?: string }>;
    };
  };
  rows?: unknown[][];
};

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ severity: "INFO", event, ...fields }));
}

function warn(event: string, fields: Record<string, unknown> = {}): void {
  console.warn(JSON.stringify({ severity: "WARNING", event, ...fields }));
}

function getAccessToken(): string {
  return execFileSync("gcloud", ["auth", "print-access-token"], {
    encoding: "utf8",
  }).trim();
}

function runGcloud(args: string[]): void {
  execFileSync("gcloud", args, { stdio: "inherit" });
}

function datastoreResourceName(): string {
  const datastore = requireEnv("VERTEX_SEARCH_DATASTORE_ID").trim();
  if (datastore.startsWith("projects/")) return datastore;

  return [
    "projects",
    requireEnv("GCP_PROJECT_ID"),
    "locations",
    requireEnv("GOOGLE_CLOUD_LOCATION"),
    "collections",
    "default_collection",
    "dataStores",
    datastore,
  ].join("/");
}

function importEndpoint(datastore: string): string {
  return `https://discoveryengine.googleapis.com/v1/${datastore}/branches/0/documents:import`;
}

function documentsEndpoint(datastore: string): string {
  return `https://discoveryengine.googleapis.com/v1/${datastore}/branches/0/documents?pageSize=10`;
}

function normalizeValue(value: unknown): unknown {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const maybeToJSON = value as { toJSON?: () => unknown };
    if (typeof maybeToJSON.toJSON === "function") {
      return normalizeValue(maybeToJSON.toJSON());
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        normalizeValue(nested),
      ]),
    );
  }
  return value;
}

function toDiscoveryDocument(row: RepoChunkRow): Record<string, unknown> {
  const {
    id,
    repo,
    branch,
    commitSha,
    sourceBlobSha,
    path: sourcePath,
    lineStart,
    lineEnd,
    chunkType,
    language,
    symbol,
    chunkContent,
    contentHash,
    governanceRefs,
    indexedAt,
  } = row;

  return {
    id,
    structData: {
      title: `${sourcePath}:${lineStart}-${lineEnd}`,
      repo,
      branch,
      commitSha,
      sourceBlobSha,
      path: sourcePath,
      lineStart,
      lineEnd,
      chunkType,
      language,
      symbol,
      chunkContent,
      contentHash,
      governanceRefs: governanceRefs ?? [],
      indexedAt: normalizeValue(indexedAt),
    },
  };
}

async function fetchRepoChunks(): Promise<RepoChunkRow[]> {
  const limit = Number(process.env.REPO_DISCOVERY_EXPORT_LIMIT || DEFAULT_LIMIT);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50_000) {
    throw new Error("REPO_DISCOVERY_EXPORT_LIMIT must be an integer between 1 and 50000");
  }

  const sql = `
      SELECT
        ChunkId AS id,
        Repo AS repo,
        Branch AS branch,
        CommitSha AS commitSha,
        SourceBlobSha AS sourceBlobSha,
        Path AS path,
        LineStart AS lineStart,
        LineEnd AS lineEnd,
        ChunkType AS chunkType,
        Language AS language,
        Symbol AS symbol,
        Content AS chunkContent,
        ContentHash AS contentHash,
        GovernanceRefs AS governanceRefs,
        IndexedAt AS indexedAt
      FROM RepoChunks
      WHERE DeletedAt IS NULL
      ORDER BY Repo, Path, LineStart
      LIMIT ${limit}
    `;
  const output = execFileSync(
    "gcloud",
    [
      "spanner",
      "databases",
      "execute-sql",
      requireEnv("SPANNER_DATABASE"),
      `--instance=${requireEnv("SPANNER_INSTANCE_ID")}`,
      `--sql=${sql}`,
      "--format=json",
    ],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(output) as SpannerJsonResult;
  const fields = parsed.metadata?.rowType?.fields?.map((field) => field.name || "") ?? [];
  const rows = parsed.rows ?? [];

  return rows.map((values) => {
    const row = Object.fromEntries(
      fields.map((field, index) => [field, normalizeValue(values[index])]),
    );
    return row as RepoChunkRow;
  });
}

function ensureBucket(bucket: string, projectId: string): void {
  try {
    execFileSync("gcloud", ["storage", "buckets", "describe", `gs://${bucket}`], {
      stdio: "ignore",
    });
    return;
  } catch {
    log("repo_discovery_bucket_create", { bucket });
  }

  runGcloud([
    "storage",
    "buckets",
    "create",
    `gs://${bucket}`,
    "--location=US",
    `--project=${projectId}`,
  ]);
}

async function startImport(datastore: string, gcsUri: string, token: string): Promise<string> {
  const response = await fetch(importEndpoint(datastore), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Goog-User-Project": requireEnv("GCP_PROJECT_ID"),
    },
    body: JSON.stringify({
      gcsSource: {
        inputUris: [gcsUri],
        dataSchema: DATA_SCHEMA,
      },
      reconciliationMode: "INCREMENTAL",
    }),
  });

  const body = (await response.json().catch(() => ({}))) as DiscoveryOperation;
  if (!response.ok) {
    throw new Error(JSON.stringify({ status: response.status, body }));
  }

  if (!body.name) {
    throw new Error("DISCOVERY_IMPORT_OPERATION_MISSING");
  }

  return body.name;
}

async function pollImport(operationName: string, token: string): Promise<DiscoveryOperation> {
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const response = await fetch(`https://discoveryengine.googleapis.com/v1/${operationName}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Goog-User-Project": requireEnv("GCP_PROJECT_ID"),
      },
    });

    const body = (await response.json().catch(() => ({}))) as DiscoveryOperation;
    if (!response.ok) {
      warn("repo_discovery_import_poll_failed", {
        status: response.status,
        body,
      });
      continue;
    }

    if (body.done) return body;
    process.stdout.write(".");
  }
}

async function listDocuments(datastore: string, token: string): Promise<number> {
  const response = await fetch(documentsEndpoint(datastore), {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Goog-User-Project": requireEnv("GCP_PROJECT_ID"),
    },
  });
  const body = (await response.json().catch(() => ({}))) as DiscoveryListResponse;
  if (!response.ok) {
    warn("repo_discovery_documents_list_failed", {
      status: response.status,
      body,
    });
    return 0;
  }

  return body.documents?.length ?? 0;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const projectId = requireEnv("GCP_PROJECT_ID");
  const bucket = requireEnv("DISCOVERY_EXPORT_BUCKET");
  const datastore = datastoreResourceName();
  const chunks = await fetchRepoChunks();

  log("repo_discovery_export_rows_loaded", {
    count: chunks.length,
    datastore,
  });

  if (chunks.length === 0) {
    log("repo_discovery_export_empty");
    return;
  }

  const documents = chunks.map(toDiscoveryDocument);
  const tempPath = path.join(tmpdir(), `repo-discovery-${randomUUID()}.ndjson`);
  const gcsObject = `repo-discovery/${path.basename(tempPath)}`;
  const gcsUri = `gs://${bucket}/${gcsObject}`;

  writeFileSync(tempPath, `${documents.map((doc) => JSON.stringify(doc)).join("\n")}\n`, "utf8");

  log("repo_discovery_ndjson_written", {
    tempPath,
    firstDocument: documents[0],
  });

  ensureBucket(bucket, projectId);
  runGcloud(["storage", "cp", tempPath, gcsUri]);
  log("repo_discovery_gcs_uploaded", { gcsUri });

  const token = getAccessToken();
  const operationName = await startImport(datastore, gcsUri, token);
  log("repo_discovery_import_started", { operationName });

  const operation = await pollImport(operationName, token);
  console.log();

  if (operation.error) {
    throw new Error(JSON.stringify(operation.error));
  }

  const documentCount = await listDocuments(datastore, token);
  log("repo_discovery_import_completed", {
    operationName,
    metadata: operation.metadata ?? {},
    listedDocuments: documentCount,
    timingMs: Date.now() - startedAt,
  });

  runGcloud(["storage", "rm", gcsUri]);
  unlinkSync(tempPath);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({
    severity: "ERROR",
    operation: "repo_discovery_sync",
    message,
  }));
  process.exit(1);
});

import { randomUUID } from "node:crypto";

import { GoogleAuth } from "google-auth-library";

import { requireEnv } from "@/lib/env";
import { getDb } from "@/lib/spanner-pool";

type ImportResult =
  | { skipped: false; operationName: string }
  | { skipped: true; reason: "debounced" };

type SpannerJsonValue = string | number | boolean | null | SpannerJsonValue[] | { [key: string]: SpannerJsonValue };

type SpannerRow = {
  toJSON: () => Record<string, unknown>;
};

type RepoChunkRow = {
  ChunkId: string;
  Repo: string;
  Branch: string;
  CommitSha: string;
  SourceBlobSha: string;
  Path: string;
  LineStart: number;
  LineEnd: number;
  ChunkType: string;
  Language: string | null;
  Symbol: string | null;
  Content: string;
  ContentHash: string;
  GovernanceRefs: string[] | null;
  IndexedAt: unknown;
};

type DiscoveryDocument = {
  id: string;
  structData: Record<string, SpannerJsonValue>;
};

type DiscoveryOperationResponse = {
  name?: string;
  error?: {
    message?: string;
  };
};

const IMPORT_DEBOUNCE_MS = 30_000;
const DISCOVERY_DATA_SCHEMA = "document";
const REPO_CHUNK_EXPORT_LIMIT = 50_000;
const lastImportByDatastore = new Map<string, number>();

function logInfo(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ severity: "INFO", ...fields }));
}

function datastoreResourceName(): string {
  const value = requireEnv("VERTEX_SEARCH_DATASTORE_ID").trim();
  if (value.startsWith("projects/")) return value;

  return [
    "projects",
    requireEnv("GCP_PROJECT_ID"),
    "locations",
    requireEnv("GOOGLE_CLOUD_LOCATION"),
    "collections",
    "default_collection",
    "dataStores",
    value,
  ].join("/");
}

function importEndpoint(parent: string): string {
  return `https://discoveryengine.googleapis.com/v1/${parent}/branches/0/documents:import`;
}

function normalizeStructValue(value: unknown): SpannerJsonValue {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(normalizeStructValue);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "object") {
    const maybeJson = value as { toJSON?: () => unknown };
    if (typeof maybeJson.toJSON === "function") {
      return normalizeStructValue(maybeJson.toJSON());
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        normalizeStructValue(nested),
      ]),
    );
  }

  return String(value);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`REPO_CHUNK_FIELD_MISSING:${field}`);
  }
  return value.trim();
}

function asNumber(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  throw new Error(`REPO_CHUNK_FIELD_INVALID:${field}`);
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === "string");
}

function toRepoChunkRow(row: Record<string, unknown>): RepoChunkRow {
  return {
    ChunkId: asString(row.ChunkId, "ChunkId"),
    Repo: asString(row.Repo, "Repo"),
    Branch: asString(row.Branch, "Branch"),
    CommitSha: asString(row.CommitSha, "CommitSha"),
    SourceBlobSha: asString(row.SourceBlobSha, "SourceBlobSha"),
    Path: asString(row.Path, "Path"),
    LineStart: asNumber(row.LineStart, "LineStart"),
    LineEnd: asNumber(row.LineEnd, "LineEnd"),
    ChunkType: asString(row.ChunkType, "ChunkType"),
    Language: asNullableString(row.Language),
    Symbol: asNullableString(row.Symbol),
    Content: asString(row.Content, "Content"),
    ContentHash: asString(row.ContentHash, "ContentHash"),
    GovernanceRefs: asStringArray(row.GovernanceRefs),
    IndexedAt: row.IndexedAt ?? null,
  };
}

function toDiscoveryDocument(row: RepoChunkRow): DiscoveryDocument {
  return {
    id: row.ChunkId,
    structData: {
      title: `${row.Path}:${row.LineStart}-${row.LineEnd}`,
      repo: row.Repo,
      branch: row.Branch,
      commitSha: row.CommitSha,
      sourceBlobSha: row.SourceBlobSha,
      path: row.Path,
      lineStart: row.LineStart,
      lineEnd: row.LineEnd,
      chunkType: row.ChunkType,
      language: row.Language,
      symbol: row.Symbol,
      chunkContent: row.Content,
      contentHash: row.ContentHash,
      governanceRefs: row.GovernanceRefs ?? [],
      indexedAt: normalizeStructValue(row.IndexedAt),
    },
  };
}

async function fetchRepoChunks(): Promise<RepoChunkRow[]> {
  const db = getDb(requireEnv("SPANNER_DATABASE"));
  const [rows] = await db.run({
    sql: `
      SELECT
        ChunkId,
        Repo,
        Branch,
        CommitSha,
        SourceBlobSha,
        Path,
        LineStart,
        LineEnd,
        ChunkType,
        Language,
        Symbol,
        Content,
        ContentHash,
        GovernanceRefs,
        IndexedAt
      FROM RepoChunks
      WHERE DeletedAt IS NULL
      ORDER BY Repo, Path, LineStart
      LIMIT @limit
    `,
    params: { limit: REPO_CHUNK_EXPORT_LIMIT },
  }) as [SpannerRow[]];

  return rows.map((row) => toRepoChunkRow(row.toJSON()));
}

async function getAccessToken(): Promise<string> {
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  const accessToken = typeof token === "string" ? token : token.token;
  if (!accessToken) throw new Error("DISCOVERY_ENGINE_AUTH_TOKEN_MISSING");
  return accessToken;
}

async function uploadNdjsonToGcs(documents: DiscoveryDocument[], accessToken: string): Promise<{
  objectName: string;
  gcsUri: string;
}> {
  const bucketName = requireEnv("DISCOVERY_GCS_BUCKET");
  const objectName = `repo-discovery/repo-sync-${Date.now()}-${randomUUID()}.ndjson`;
  const ndjson = `${documents.map((document) => JSON.stringify(document)).join("\n")}\n`;
  const uploadUrl = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucketName)}/o`);
  uploadUrl.searchParams.set("uploadType", "media");
  uploadUrl.searchParams.set("name", objectName);

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-ndjson",
      "X-Goog-User-Project": requireEnv("GCP_PROJECT_ID"),
    },
    body: ndjson,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GCS_REST_UPLOAD_FAILED:${response.status}:${errorText}`);
  }

  return {
    objectName,
    gcsUri: `gs://${bucketName}/${objectName}`,
  };
}

async function startDiscoveryImport(datastore: string, gcsUri: string, accessToken: string): Promise<string> {
  const response = await fetch(importEndpoint(datastore), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-goog-user-project": requireEnv("GCP_PROJECT_ID"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reconciliationMode: "INCREMENTAL",
      gcsSource: {
        inputUris: [gcsUri],
        dataSchema: DISCOVERY_DATA_SCHEMA,
      },
    }),
  });

  const body = (await response.json().catch(() => ({}))) as DiscoveryOperationResponse;
  if (!response.ok) {
    throw new Error(body.error?.message || `DISCOVERY_IMPORT_FAILED_${response.status}`);
  }

  const operationName = body.name;
  if (!operationName) throw new Error("DISCOVERY_IMPORT_OPERATION_MISSING");
  return operationName;
}

/**
 * Extracts RepoChunks from Spanner, formats them as exact Discovery Engine
 * Document NDJSON, uploads that file to GCS, and starts a background import.
 */
export async function syncRepoToDiscovery(): Promise<string> {
  const datastore = datastoreResourceName();
  const chunks = await fetchRepoChunks();
  if (chunks.length === 0) {
    throw new Error("NO_REPO_CHUNKS_TO_SYNC");
  }

  const documents = chunks.map(toDiscoveryDocument);
  const accessToken = await getAccessToken();
  const upload = await uploadNdjsonToGcs(documents, accessToken);
  const operationName = await startDiscoveryImport(datastore, upload.gcsUri, accessToken);

  logInfo({
    operation: "repo_discovery_import",
    event: "started",
    datastore,
    operationName,
    documentCount: documents.length,
    gcsUri: upload.gcsUri,
  });

  return operationName;
}

export function resetDiscoveryImportDebounceForTests(): void {
  lastImportByDatastore.clear();
}

export async function triggerDiscoveryEngineImport(): Promise<ImportResult> {
  const datastore = datastoreResourceName();
  const now = Date.now();
  const lastImport = lastImportByDatastore.get(datastore) ?? 0;

  if (now - lastImport < IMPORT_DEBOUNCE_MS) {
    logInfo({
      operation: "repo_discovery_import",
      event: "debounced",
      datastore,
    });
    return { skipped: true, reason: "debounced" };
  }

  lastImportByDatastore.set(datastore, now);
  const operationName = await syncRepoToDiscovery();
  return { skipped: false, operationName };
}

import { Octokit } from "@octokit/rest";
import { getDb } from "@/lib/spanner-pool";
import { requireEnv } from "@/lib/env";
import {
  computeCommitChunks,
  isAllowedRepoFile,
  isWithinRepoFileSizeLimit,
  type RepoChunk,
} from "@/lib/repo-indexer/chunker";
import { triggerDiscoveryEngineImport } from "@/lib/repo-indexer/discovery-import";

type ReindexInput = {
  repo: string;
  branch: string;
  commitSha: string;
};

type TreeEntry = {
  path?: string;
  sha?: string;
  type?: string;
  size?: number;
};

type SpannerRow = {
  toJSON: () => Record<string, unknown>;
};

type BatchStatement = {
  sql: string;
  params?: Record<string, unknown>;
};

type SpannerTransaction = {
  batchUpdate: (statements: BatchStatement[]) => Promise<number[]>;
};

type ChangedPath = {
  path: string;
  status: "added" | "modified" | "removed" | "renamed";
};

const MAX_MUTATIONS_PER_TRANSACTION = 250;

function splitRepo(repo: string): { owner: string; repoName: string } {
  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) throw new Error("REPO_MUST_BE_OWNER_SLASH_NAME");
  return { owner, repoName };
}

function getRecruitingDatabase() {
  return getDb(requireEnv("SPANNER_DATABASE"));
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function getPreviousIndexedCommit(repo: string, branch: string): Promise<string | null> {
  const db = getRecruitingDatabase();
  const [rows] = await db.run({
    sql: `
      SELECT CommitSha
      FROM RepoChunks
      WHERE Repo = @repo AND Branch = @branch
      ORDER BY IndexedAt DESC
      LIMIT 1
    `,
    params: { repo, branch },
  }) as [SpannerRow[]];

  return rows.length > 0 ? asString(rows[0].toJSON().CommitSha) : null;
}

async function getPreviousPaths(repo: string, branch: string): Promise<Set<string>> {
  const db = getRecruitingDatabase();
  const [rows] = await db.run({
    sql: `
      SELECT DISTINCT Path
      FROM RepoChunks
      WHERE Repo = @repo AND Branch = @branch AND DeletedAt IS NULL
    `,
    params: { repo, branch },
  }) as [SpannerRow[]];

  return new Set(rows.map((row) => asString(row.toJSON().Path)).filter((path): path is string => Boolean(path)));
}

async function getCommitTree(octokit: Octokit, repo: string, commitSha: string): Promise<TreeEntry[]> {
  const { owner, repoName } = splitRepo(repo);
  const { data } = await octokit.git.getTree({
    owner,
    repo: repoName,
    tree_sha: commitSha,
    recursive: "true",
  });
  return data.tree as TreeEntry[];
}

async function compareCommits(octokit: Octokit, repo: string, base: string, head: string): Promise<ChangedPath[]> {
  const { owner, repoName } = splitRepo(repo);
  const { data } = await octokit.repos.compareCommitsWithBasehead({
    owner,
    repo: repoName,
    basehead: `${base}...${head}`,
  });

  return (data.files ?? [])
    .map((file) => ({
      path: file.filename,
      status: file.status as ChangedPath["status"],
    }))
    .filter((file) => ["added", "modified", "removed", "renamed"].includes(file.status));
}

async function fetchBlobContent(octokit: Octokit, repo: string, sha: string): Promise<string> {
  const { owner, repoName } = splitRepo(repo);
  const { data } = await octokit.git.getBlob({
    owner,
    repo: repoName,
    file_sha: sha,
  });

  return Buffer.from(data.content, "base64").toString("utf8");
}

function mutationForChunk(chunk: RepoChunk): BatchStatement {
  return {
    sql: `
      INSERT OR UPDATE INTO RepoChunks (
        ChunkId, Repo, Branch, CommitSha, SourceBlobSha, Path, LineStart, LineEnd,
        ChunkType, Language, Symbol, Content, ContentHash, GovernanceRefs, IndexedAt, DeletedAt
      ) VALUES (
        @ChunkId, @Repo, @Branch, @CommitSha, @SourceBlobSha, @Path, @LineStart, @LineEnd,
        @ChunkType, @Language, @Symbol, @Content, @ContentHash, @GovernanceRefs,
        PENDING_COMMIT_TIMESTAMP(), NULL
      )
    `,
    params: chunk,
  };
}

function mutationForDeletedPath(repo: string, branch: string, path: string): BatchStatement {
  return {
    sql: `
      UPDATE RepoChunks
      SET DeletedAt = PENDING_COMMIT_TIMESTAMP()
      WHERE Repo = @repo AND Branch = @branch AND Path = @path AND DeletedAt IS NULL
    `,
    params: { repo, branch, path },
  };
}

async function applyMutations(statements: BatchStatement[]): Promise<void> {
  const db = getRecruitingDatabase();
  for (const batch of chunkArray(statements, MAX_MUTATIONS_PER_TRANSACTION)) {
    await db.runTransactionAsync(async (tx: SpannerTransaction) => {
      await tx.batchUpdate(batch);
    });
  }
}

export async function reindexRepoAtCommit(input: ReindexInput): Promise<{
  chunksWritten: number;
  deletedPaths: number;
  importOperationId: string | null;
  importSkipped: boolean;
}> {
  const startedAt = Date.now();
  const octokit = new Octokit({ auth: requireEnv("GITHUB_TOKEN") });
  const previousCommit = await getPreviousIndexedCommit(input.repo, input.branch);
  const tree = await getCommitTree(octokit, input.repo, input.commitSha);
  const blobsByPath = new Map<string, TreeEntry>();

  for (const item of tree) {
    if (item.type !== "blob" || !item.path || !item.sha) continue;
    if (!isAllowedRepoFile(item.path)) continue;
    if (typeof item.size === "number" && item.size > 100 * 1024) continue;
    blobsByPath.set(item.path, item);
  }

  const changed = previousCommit
    ? await compareCommits(octokit, input.repo, previousCommit, input.commitSha)
    : Array.from(blobsByPath.keys()).map((path) => ({ path, status: "added" as const }));

  const previousPaths = await getPreviousPaths(input.repo, input.branch);
  const removedPaths = new Set<string>();
  for (const change of changed) {
    if (change.status === "removed" || !blobsByPath.has(change.path)) {
      removedPaths.add(change.path);
    }
  }
  for (const previousPath of previousPaths) {
    if (!blobsByPath.has(previousPath)) removedPaths.add(previousPath);
  }

  const changedPaths = new Set(
    changed
      .filter((change) => change.status !== "removed")
      .map((change) => change.path)
      .filter((path) => blobsByPath.has(path)),
  );

  const newChunks: RepoChunk[] = [];
  for (const path of changedPaths) {
    const blob = blobsByPath.get(path);
    if (!blob?.sha) continue;
    const content = await fetchBlobContent(octokit, input.repo, blob.sha);
    if (!isWithinRepoFileSizeLimit(content)) continue;
    newChunks.push(...computeCommitChunks({
      repo: input.repo,
      branch: input.branch,
      commitSha: input.commitSha,
      path,
      sourceBlobSha: blob.sha,
      content,
    }));
  }

  const mutations = [
    ...Array.from(removedPaths).map((path) => mutationForDeletedPath(input.repo, input.branch, path)),
    ...newChunks.map(mutationForChunk),
  ];

  if (mutations.length > 0) await applyMutations(mutations);

  const importResult = await triggerDiscoveryEngineImport();
  const timingMs = Date.now() - startedAt;

  console.log(JSON.stringify({
    severity: "INFO",
    operation: "repo_reindex",
    repo: input.repo,
    branch: input.branch,
    commitSha: input.commitSha,
    previousCommit,
    chunksWritten: newChunks.length,
    deletedPaths: removedPaths.size,
    importResult,
    timingMs,
  }));

  return {
    chunksWritten: newChunks.length,
    deletedPaths: removedPaths.size,
    importOperationId: importResult.skipped ? null : importResult.operationName,
    importSkipped: importResult.skipped,
  };
}

export async function markReindexJobComplete(input: {
  jobId: string;
  status: "completed" | "failed";
  error?: string;
}): Promise<void> {
  const db = getRecruitingDatabase();
  await db.runTransactionAsync(async (tx: SpannerTransaction) => {
    await tx.batchUpdate([{
      sql: `
        UPDATE ReindexJobs
        SET Status = @status, CompletedAt = PENDING_COMMIT_TIMESTAMP(), Error = @error
        WHERE JobId = @jobId
      `,
      params: {
        jobId: input.jobId,
        status: input.status,
        error: input.error ?? null,
      },
    }]);
  });
}

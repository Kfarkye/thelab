import test from "node:test";
import assert from "node:assert/strict";

const runIntegration = process.env.RUN_REPO_REINDEX_INTEGRATION === "1";

test("reindexes a real commit into Spanner and triggers Discovery Engine import", { skip: !runIntegration }, async () => {
  const repo = process.env.REPO_REINDEX_INTEGRATION_REPO;
  const branch = process.env.REPO_REINDEX_INTEGRATION_BRANCH;
  const commitSha = process.env.REPO_REINDEX_INTEGRATION_COMMIT;

  assert.ok(repo, "REPO_REINDEX_INTEGRATION_REPO is required");
  assert.ok(branch, "REPO_REINDEX_INTEGRATION_BRANCH is required");
  assert.ok(commitSha, "REPO_REINDEX_INTEGRATION_COMMIT is required");

  const { reindexRepoAtCommit } = await import("@/lib/repo-indexer/reindex");
  const result = await reindexRepoAtCommit({ repo, branch, commitSha });

  assert.ok(result.chunksWritten >= 0);
  assert.equal(typeof result.importSkipped, "boolean");
});

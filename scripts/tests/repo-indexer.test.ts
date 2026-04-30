import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import { computeCommitChunks } from "@/lib/repo-indexer/chunker";
import { verifyGitHubSignature } from "@/lib/middleware/webhook";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "repo-indexer");

function fixture(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), "utf8");
}

function chunkFixture(name: string) {
  return computeCommitChunks({
    repo: "owner/repo",
    branch: "main",
    commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    path: name,
    sourceBlobSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    content: fixture(name),
  });
}

test("chunks TypeScript declarations and governance references", () => {
  const chunks = chunkFixture("sample.ts");
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].ChunkType, "function");
  assert.equal(chunks[0].Symbol, "answerQuestion");
  assert.deepEqual(chunks[0].GovernanceRefs, ["AYA.CONTEXT_SCOPE.V1"]);
});

test("chunks JSON, SQL, Markdown, and YAML inputs", () => {
  assert.equal(chunkFixture("sample.json")[0].Language, "json");
  assert.equal(chunkFixture("sample.sql").length, 2);
  assert.deepEqual(chunkFixture("sample.md").map((chunk) => chunk.Symbol), ["First", "Second"]);
  assert.deepEqual(chunkFixture("sample.yaml").map((chunk) => chunk.Symbol), ["alpha", "beta"]);
});

test("verifies GitHub signatures with timing-safe comparison", () => {
  const rawBody = Buffer.from(JSON.stringify({ hello: "world" }));
  const secret = "super-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;

  assert.equal(verifyGitHubSignature({ rawBody, signatureHeader: signature, secret }), true);
  assert.equal(verifyGitHubSignature({ rawBody, signatureHeader: `${signature.slice(0, -1)}0`, secret }), false);
  assert.equal(verifyGitHubSignature({ rawBody, signatureHeader: null, secret }), false);
});

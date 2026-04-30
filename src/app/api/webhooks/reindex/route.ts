import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import branchPolicy from "../../../../../governance/branches.json";
import { getDb } from "@/lib/spanner-pool";
import { requireEnv } from "@/lib/env";
import { verifyGitHubSignature } from "@/lib/middleware/webhook";
import { markReindexJobComplete, reindexRepoAtCommit } from "@/lib/repo-indexer/reindex";

export const runtime = "nodejs";
export const maxDuration = 300;

type SpannerRow = {
  toJSON: () => Record<string, unknown>;
};

type BatchStatement = {
  sql: string;
  params?: Record<string, unknown>;
};

type SpannerTransaction = {
  run: (query: { sql: string; params?: Record<string, unknown> }) => Promise<[SpannerRow[]]>;
  batchUpdate: (statements: BatchStatement[]) => Promise<number[]>;
};

const pushPayloadSchema = z.object({
  ref: z.string(),
  after: z.string().regex(/^[a-f0-9]{40}$/i),
  deleted: z.boolean().optional(),
  repository: z.object({
    full_name: z.string().min(3),
  }),
});

type JobClaim =
  | { claimed: true; jobId: string }
  | { claimed: false; jobId: string; reason: "duplicate" };

function jobIdFor(repo: string, commitSha: string): string {
  return createHash("sha256").update(`${repo}:${commitSha}`).digest("hex");
}

function branchFromRef(ref: string): string | null {
  const prefix = "refs/heads/";
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : null;
}

function branchMatches(pattern: string, branch: string): boolean {
  if (pattern.endsWith("/*")) {
    return branch.startsWith(pattern.slice(0, -1));
  }
  return pattern === branch;
}

function isAllowedBranch(branch: string): boolean {
  return branchPolicy.allowed_branches.some((pattern) => branchMatches(pattern, branch));
}

function getRepoDb() {
  return getDb(requireEnv("SPANNER_DATABASE"));
}

async function claimReindexJob(repo: string, commitSha: string): Promise<JobClaim> {
  const jobId = jobIdFor(repo, commitSha);
  const db = getRepoDb();

  return db.runTransactionAsync(async (tx: SpannerTransaction) => {
    const [rows] = await tx.run({
      sql: "SELECT Status FROM ReindexJobs WHERE JobId = @jobId LIMIT 1",
      params: { jobId },
    });

    const status = rows[0]?.toJSON().Status;
    if (status === "running" || status === "completed") {
      return { claimed: false, jobId, reason: "duplicate" };
    }

    await tx.batchUpdate([{
      sql: `
        INSERT OR UPDATE INTO ReindexJobs (
          JobId, Repo, CommitSha, Status, StartedAt, CompletedAt, Error
        ) VALUES (
          @jobId, @repo, @commitSha, 'running', PENDING_COMMIT_TIMESTAMP(), NULL, NULL
        )
      `,
      params: { jobId, repo, commitSha },
    }]);

    return { claimed: true, jobId };
  }) as Promise<JobClaim>;
}

function logWebhookEvent(input: {
  severity: "INFO" | "WARNING" | "ERROR";
  event: string;
  repo?: string;
  branch?: string;
  commitSha?: string;
  jobId?: string;
  error?: string;
  timingMs?: number;
}): void {
  console.log(JSON.stringify({
    operation: "repo_reindex_webhook",
    ...input,
  }));
}

function runReindexJobInBackground(input: {
  repo: string;
  branch: string;
  commitSha: string;
  jobId: string;
  startedAt: number;
}): void {
  void Promise.resolve()
    .then(async () => {
      await reindexRepoAtCommit({
        repo: input.repo,
        branch: input.branch,
        commitSha: input.commitSha,
      });
      await markReindexJobComplete({ jobId: input.jobId, status: "completed" });

      logWebhookEvent({
        severity: "INFO",
        event: "completed",
        repo: input.repo,
        branch: input.branch,
        commitSha: input.commitSha,
        jobId: input.jobId,
        timingMs: Date.now() - input.startedAt,
      });
    })
    .catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      await markReindexJobComplete({
        jobId: input.jobId,
        status: "failed",
        error: message,
      }).catch((markError: unknown) => {
        logWebhookEvent({
          severity: "ERROR",
          event: "job_failure_mark_failed",
          repo: input.repo,
          branch: input.branch,
          commitSha: input.commitSha,
          jobId: input.jobId,
          error: markError instanceof Error ? markError.message : String(markError),
        });
      });

      logWebhookEvent({
        severity: "ERROR",
        event: "failed",
        repo: input.repo,
        branch: input.branch,
        commitSha: input.commitSha,
        jobId: input.jobId,
        error: message,
        timingMs: Date.now() - input.startedAt,
      });
    });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
  const rawBody = Buffer.from(await request.arrayBuffer());
  const signatureHeader = request.headers.get("x-hub-signature-256");

  if (!verifyGitHubSignature({
    rawBody,
    signatureHeader,
    secret: requireEnv("GITHUB_WEBHOOK_SECRET"),
  })) {
    logWebhookEvent({
      severity: "WARNING",
      event: "signature_rejected",
      timingMs: Date.now() - startedAt,
    });
    return NextResponse.json({ ok: true, accepted: false, reason: "signature_rejected" });
  }

  let jobId: string | null = null;
  let repo: string | undefined;
  let branch: string | undefined;
  let commitSha: string | undefined;

  try {
    const payload = pushPayloadSchema.parse(JSON.parse(rawBody.toString("utf8")));
    repo = payload.repository.full_name;
    commitSha = payload.after;
    branch = branchFromRef(payload.ref) ?? undefined;

    if (!branch || payload.deleted) {
      logWebhookEvent({ severity: "INFO", event: "ignored_ref", repo, branch, commitSha });
      return NextResponse.json({ ok: true, accepted: false, reason: "ignored_ref" });
    }

    if (!isAllowedBranch(branch)) {
      logWebhookEvent({ severity: "INFO", event: "branch_ignored", repo, branch, commitSha });
      return NextResponse.json({ ok: true, accepted: false, reason: "branch_ignored" });
    }

    const claim = await claimReindexJob(repo, commitSha);
    jobId = claim.jobId;

    if (!claim.claimed) {
      logWebhookEvent({ severity: "INFO", event: "duplicate_skipped", repo, branch, commitSha, jobId });
      return NextResponse.json({ ok: true, accepted: true, duplicate: true });
    }

    logWebhookEvent({
      severity: "INFO",
      event: "queued",
      repo,
      branch,
      commitSha,
      jobId,
      timingMs: Date.now() - startedAt,
    });

    runReindexJobInBackground({ repo, branch, commitSha, jobId, startedAt });

    return NextResponse.json({ ok: true, accepted: true, jobId }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (jobId) {
      await markReindexJobComplete({ jobId, status: "failed", error: message }).catch((markError: unknown) => {
        logWebhookEvent({
          severity: "ERROR",
          event: "job_failure_mark_failed",
          repo,
          branch,
          commitSha,
          jobId: jobId ?? undefined,
          error: markError instanceof Error ? markError.message : String(markError),
        });
      });
    }

    logWebhookEvent({
      severity: "ERROR",
      event: "failed",
      repo,
      branch,
      commitSha,
      jobId: jobId ?? undefined,
      error: message,
      timingMs: Date.now() - startedAt,
    });

    return NextResponse.json({ ok: true, accepted: false, reason: "logged_failure" });
  }
}

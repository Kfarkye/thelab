import { NextRequest, NextResponse } from "next/server";
import { access_hub } from "@/lib/hub";
import { requireAuth } from "@/lib/middleware/auth";
import { getDb } from "@/lib/spanner-pool";

type ApprovalBody = {
  taskId?: unknown;
  pullId?: unknown;
};

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

async function readApprovalBody(req: NextRequest): Promise<{ taskId: string; pullId: string } | null> {
  const body = (await req.json().catch(() => ({}))) as ApprovalBody;
  const taskId = readString(body.taskId);
  const pullId = readString(body.pullId);
  if (!taskId || !pullId) return null;
  return { taskId, pullId };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (auth.response) return auth.response as NextResponse;

  const body = await readApprovalBody(req);
  if (!body) {
    return NextResponse.json({ error: "MALFORMED_REQUEST" }, { status: 400 });
  }

  const { taskId, pullId } = body;
  const db = getDb("verdict");
  const actor = auth.user.uid;
  const logId = `approval:${taskId}:${pullId}`;

  try {
    const [logs] = await db.run({
      sql: `SELECT hub_merge_sha FROM approval_logs WHERE id = @id AND status = 'accepted' LIMIT 1`,
      params: { id: logId },
    });

    const acceptedLog = logs[0]?.toJSON ? logs[0].toJSON() : null;
    let activeSha = readString(acceptedLog?.hub_merge_sha);

    if (!activeSha) {
      if (typeof access_hub.getMergeState !== "function") {
        throw new Error("HUB_STATE_RECOVERY_UNAVAILABLE");
      }

      const hubState = await access_hub.getMergeState(pullId);
      if (hubState?.merged && hubState.sha) {
        activeSha = hubState.sha;
      }
    }

    if (activeSha) {
      await db.runTransactionAsync(async (tx: any) => {
        const [count] = await tx.runUpdate({
          sql: `UPDATE verdicts SET status = 'accepted', hub_merge_sha = @sha WHERE task_id = @taskId`,
          params: { taskId, sha: activeSha },
        });
        if (Number(count || 0) !== 1) throw new Error("VERDICT_RECONCILE_FAILED");
        await tx.commit();
      });

      return NextResponse.json({ success: true, sha: activeSha, reconciled: true });
    }

    await db.runTransactionAsync(async (tx: any) => {
      await tx.runUpdate({
        sql: `INSERT OR UPDATE INTO approval_logs (id, task_id, pull_id, status, actor, timestamp)
              VALUES (@id, @taskId, @pullId, 'pending_merge', @actor, PENDING_COMMIT_TIMESTAMP())`,
        params: { id: logId, taskId, pullId, actor },
      });
      await tx.commit();
    });

    const { sha } = await access_hub.mergePR(pullId);

    await db.runTransactionAsync(async (tx: any) => {
      const [verdictCount] = await tx.runUpdate({
        sql: `UPDATE verdicts SET status = 'accepted', hub_merge_sha = @sha WHERE task_id = @taskId`,
        params: { taskId, sha },
      });
      await tx.runUpdate({
        sql: `INSERT OR UPDATE INTO approval_logs (id, task_id, pull_id, status, actor, hub_merge_sha, timestamp)
              VALUES (@id, @taskId, @pullId, 'accepted', @actor, @sha, PENDING_COMMIT_TIMESTAMP())`,
        params: { id: logId, taskId, pullId, actor, sha },
      });
      if (Number(verdictCount || 0) !== 1) throw new Error("VERDICT_FINALIZE_FAILED");
      await tx.commit();
    });

    return NextResponse.json({ success: true, sha });
  } catch (error: unknown) {
    const failId = `${logId}:err:${Date.now()}`;
    const message = readErrorMessage(error);

    await db
      .runTransactionAsync(async (tx: any) => {
        await tx.runUpdate({
          sql: `INSERT OR UPDATE INTO approval_logs (id, task_id, pull_id, status, actor, error_context, timestamp)
                VALUES (@id, @taskId, @pullId, 'failed_merge', @actor, @err, PENDING_COMMIT_TIMESTAMP())`,
          params: { id: failId, taskId, pullId, actor, err: message },
        });
        await tx.commit();
      })
      .catch((auditError: unknown) => {
        console.error(
          JSON.stringify({
            severity: "ERROR",
            component: "governance_approve",
            event: "approval_failure_audit_failed",
            error: readErrorMessage(auditError),
          }),
        );
      });

    return NextResponse.json({ error: "Saga execution failed" }, { status: 502 });
  }
}

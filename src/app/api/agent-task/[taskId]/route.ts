import { NextRequest } from "next/server";
import { getAgentHandoffTask, saveAgentHandoffResult } from "@/lib/agent/handoff-store";

export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function readTaskId(
  paramsInput: { taskId: string } | Promise<{ taskId: string }>,
): Promise<string> {
  const params = await paramsInput;
  return decodeURIComponent(String(params.taskId || "").trim());
}

export async function GET(
  _request: NextRequest,
  context: { params: { taskId: string } | Promise<{ taskId: string }> },
) {
  const taskId = await readTaskId(context.params);
  if (!taskId) {
    return Response.json(
      { ok: false, code: "INVALID_TASK_ID", error: "taskId is required." },
      { status: 400 },
    );
  }

  const task = await getAgentHandoffTask(taskId);
  if (!task) {
    return Response.json(
      { ok: false, code: "AGENT_TASK_NOT_FOUND", error: `Task '${taskId}' was not found.` },
      { status: 404 },
    );
  }

  return Response.json({ ok: true, task });
}

export async function POST(
  request: NextRequest,
  context: { params: { taskId: string } | Promise<{ taskId: string }> },
) {
  const taskId = await readTaskId(context.params);
  if (!taskId) {
    return Response.json(
      { ok: false, code: "INVALID_TASK_ID", error: "taskId is required." },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const status = String(body.status || "completed").toLowerCase() === "failed" ? "failed" : "completed";
  const result = asRecord(body.result);
  const resultSummary = body.result_summary ? String(body.result_summary) : body.summary ? String(body.summary) : null;
  const errorCode = body.error_code ? String(body.error_code) : null;
  const errorMessage = body.error_message ? String(body.error_message) : null;

  if (status === "completed" && !result) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_RESULT_PAYLOAD",
        error: "Completed task results require a structured object at `result`.",
      },
      { status: 400 },
    );
  }

  const updated = await saveAgentHandoffResult(taskId, {
    status,
    result,
    resultSummary,
    errorCode,
    errorMessage,
  });

  if (!updated) {
    return Response.json(
      { ok: false, code: "AGENT_TASK_NOT_FOUND", error: `Task '${taskId}' was not found.` },
      { status: 404 },
    );
  }

  return Response.json({ ok: true, task: updated });
}

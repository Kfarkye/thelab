import { NextRequest, NextResponse } from "next/server";
import { getAgentHandoffTask, markAgentHandoffOpened } from "@/lib/agent/handoff-store";

export const dynamic = "force-dynamic";

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
    return NextResponse.json(
      { ok: false, code: "INVALID_TASK_ID", error: "taskId is required." },
      { status: 400 },
    );
  }

  const task = await getAgentHandoffTask(taskId);
  if (!task) {
    return NextResponse.json(
      { ok: false, code: "AGENT_TASK_NOT_FOUND", error: `Task '${taskId}' was not found.` },
      { status: 404 },
    );
  }

  await markAgentHandoffOpened(taskId);
  return NextResponse.redirect(task.targetUrl, { status: 302 });
}

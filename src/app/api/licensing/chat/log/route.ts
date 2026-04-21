import { NextRequest } from "next/server";
import { logLicensingChatQuestion } from "@/lib/licensing/chat-question-log";

function readString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const pageUrl = readString(body.page_url || body.pageUrl);
    const userQuestion = readString(body.user_question || body.userQuestion);
    const wasSuggested =
      typeof body.was_suggested === "boolean"
        ? body.was_suggested
        : typeof body.wasSuggested === "boolean"
          ? body.wasSuggested
          : false;
    const visitTimestamp =
      readString(body.visit_timestamp || body.visitTimestamp) || new Date().toISOString();
    const resolvedEntityId =
      readString(body.resolved_entity_id || body.resolvedEntityId) || null;

    if (!pageUrl || !userQuestion) {
      return Response.json(
        { error: "page_url and user_question are required" },
        { status: 400 },
      );
    }

    await logLicensingChatQuestion({
      page_url: pageUrl,
      user_question: userQuestion,
      was_suggested: wasSuggested,
      visit_timestamp: visitTimestamp,
      resolved_entity_id: resolvedEntityId,
    });

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to write licensing chat log";
    const isMissingTable = /table not found|not found:\s*licensing_chat_question_logs/i.test(message);

    if (isMissingTable) {
      return Response.json(
        {
          ok: false,
          code: "LOG_TABLE_MISSING",
          error: "Log table is not deployed yet.",
        },
        { status: 202 },
      );
    }

    console.error("Licensing chat log write failed:", error);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

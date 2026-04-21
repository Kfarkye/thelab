import { getLicensingDb } from "@/lib/spanner-pool";

const licensingDb = getLicensingDb();

export interface LicensingChatQuestionLogInput {
  page_url: string;
  user_question: string;
  was_suggested: boolean;
  visit_timestamp?: string | null;
  resolved_entity_id?: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = asRecord(value);
    if (record) {
      const nested =
        record.value ??
        record.stringValue ??
        record.integerValue ??
        record.numberValue ??
        record.floatValue ??
        record.boolValue;
      if (nested !== undefined) return readString(nested);
    }
  }
  return "";
}

export async function logLicensingChatQuestion(input: LicensingChatQuestionLogInput): Promise<void> {
  const pageUrl = readString(input.page_url).slice(0, 2048);
  const userQuestion = readString(input.user_question).slice(0, 4000);
  const visitTimestampIso = readString(input.visit_timestamp) || new Date().toISOString();
  const visitTimestampDate = new Date(visitTimestampIso);
  const resolvedEntityId = readString(input.resolved_entity_id).slice(0, 256) || null;
  const wasSuggested = Boolean(input.was_suggested);

  if (!pageUrl || !userQuestion) {
    throw new Error("page_url and user_question are required");
  }
  if (Number.isNaN(visitTimestampDate.getTime())) {
    throw new Error("visit_timestamp must be a valid ISO timestamp");
  }

  await licensingDb.runTransactionAsync(async (tx: any) => {
    await tx.runUpdate({
      sql: `INSERT INTO licensing_chat_question_logs (
              page_url,
              user_question,
              was_suggested,
              visit_timestamp,
              resolved_entity_id,
              created_at
            ) VALUES (
              @pageUrl,
              @userQuestion,
              @wasSuggested,
              @visitTimestamp,
              @resolvedEntityId,
              PENDING_COMMIT_TIMESTAMP()
            )`,
      params: {
        pageUrl,
        userQuestion,
        wasSuggested,
        visitTimestamp: visitTimestampDate,
        resolvedEntityId,
      },
      types: {
        pageUrl: { type: "string" },
        userQuestion: { type: "string" },
        wasSuggested: { type: "bool" },
        visitTimestamp: { type: "timestamp" },
        resolvedEntityId: { type: "string" },
      },
    });
    await tx.commit();
  });
}

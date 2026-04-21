import { NextRequest } from "next/server";
import type { CommitAction } from "@/lib/types/sandbox";
import { executeDbTool } from "@/lib/spanner/tools";
import {
  OPS_REASSIGNMENT_RECIPIENT,
  OPS_REASSIGNMENT_TEMPLATE_ID,
  isTemplateRecipientMismatch,
} from "@/lib/ayaops/email-template-routing";
import { createAgentHandoffTask } from "@/lib/agent/handoff-store";
import { getDb } from "@/lib/spanner-pool";
import { requireAuth } from "@/lib/middleware/auth";

const NOVA_SESSION_TOKEN = process.env.NOVA_SESSION_TOKEN || "";
const WORLDCUP_WRITEUP_BASE_URL = String(process.env.WORLDCUP_WRITEUP_BASE_URL || "https://thedrip.bet/worldcup")
  .trim()
  .replace(/\/+$/, "");
const PUBLIC_BASE_URL = String(
  process.env.PUBLIC_APP_BASE_URL ||
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_BASE_URL ||
    "",
)
  .trim()
  .replace(/\/+$/, "");

const COMMIT_ALLOWLIST = new Set<CommitAction["type"]>([
  "publish_preview",
  "spanner_write",
  "api_fetch",
  "create_email_draft",
  "send_email_now",
  "log_candidate_note",
  "create_agent_handoff_task",
]);
const SEND_NOW_DISABLED_TEMPLATES = new Set(["pay_package_snippet"]);

const SPANNER_DB_ALLOWLIST = new Set(["worldcupdb", "recruitingdb", "sportsdb"]);
const SAFE_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isSafeIdentifier(value: string): boolean {
  return SAFE_IDENTIFIER_RE.test(value);
}

function normalizeSpannerDatabaseName(value: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (["internal", "recruiting", "recruiting_db", "recruitingdb"].includes(normalized)) {
    return "recruitingdb";
  }
  if (["worldcup", "worldcup_db", "worldcupdb"].includes(normalized)) {
    return "worldcupdb";
  }
  if (["sports", "sports_db", "sportsdb"].includes(normalized)) {
    return "sportsdb";
  }
  return normalized;
}

function buildCanonicalWorldCupWriteupUrl(fixtureId: string): string {
  return `${WORLDCUP_WRITEUP_BASE_URL}/${encodeURIComponent(String(fixtureId || "").trim())}`;
}

function resolvePublicOrigin(request: NextRequest): string {
  if (/^https?:\/\//i.test(PUBLIC_BASE_URL)) return PUBLIC_BASE_URL;

  const forwardedHost = readString(request.headers.get("x-forwarded-host"));
  const forwardedProto = readString(request.headers.get("x-forwarded-proto")) || "https";
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`.replace(/\/+$/, "");
  }

  const host = readString(request.headers.get("host"));
  if (host) {
    return `https://${host}`.replace(/\/+$/, "");
  }

  const fallback = request.nextUrl.origin.replace(/\/+$/, "");
  return /^https?:\/\/(0\.0\.0\.0|127\.0\.0\.1|localhost)(:\d+)?$/i.test(fallback)
    ? "https://gemini3-chat-1049576459547.us-central1.run.app"
    : fallback;
}

async function runDmlWithTransaction(
  databaseName: string,
  sql: string,
  params: Record<string, unknown>,
): Promise<number> {
  const db = getDb(databaseName);
  let rowCount = 0;
  await db.runTransactionAsync(async (tx: any) => {
    const [count] = await tx.runUpdate({ sql, params });
    rowCount = Number(count || 0);
    await tx.commit();
  });
  return rowCount;
}

function normalizeStringMap(value: unknown): Record<string, string> {
  const source = asRecord(value) || {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(source)) {
    if (!raw) continue;
    out[key] = String(raw);
  }
  return out;
}

function readString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => readString(entry)).filter(Boolean);
}

function asResultRecord(value: unknown): Record<string, unknown> {
  return asRecord(value) || {};
}

function mapDbToolError(error: string): { status: number; code: string; error: string } {
  const message = String(error || "").trim();
  if (/CANDIDATE_NOT_FOUND/i.test(message)) {
    return { status: 404, code: "CANDIDATE_NOT_FOUND", error: message };
  }
  if (/to_email is required/i.test(message)) {
    return { status: 400, code: "MISSING_RECIPIENT_EMAIL", error: message };
  }
  if (/Invalid email format/i.test(message)) {
    return { status: 400, code: "INVALID_RECIPIENT_EMAIL", error: message };
  }
  if (/Draft subject is required/i.test(message) || /Draft body is required/i.test(message)) {
    return { status: 400, code: "MISSING_REQUIRED_FIELDS", error: message };
  }
  return { status: 500, code: "EMAIL_WORKFLOW_FAILED", error: message || "Unknown DB tool error" };
}

async function commitPublishPreview(action: Extract<CommitAction, { type: "publish_preview" }>) {
  const fixtureId = String(action.fixtureId || "").trim();
  const rawWriteupUrl = String(action.writeupUrl || "").trim();
  const writeupUrl = buildCanonicalWorldCupWriteupUrl(fixtureId);
  const writeupTitle = action.writeupTitle != null ? String(action.writeupTitle) : null;

  if (!fixtureId) {
    return { ok: false, status: 400, code: "INVALID_FIXTURE_ID", error: "fixtureId is required." };
  }
  if (rawWriteupUrl && !/^https:\/\//i.test(rawWriteupUrl)) {
    return { ok: false, status: 400, code: "INVALID_WRITEUP_URL", error: "writeupUrl must be an absolute https URL." };
  }

  const rowCount = await runDmlWithTransaction(
    "worldcupdb",
    `INSERT OR UPDATE INTO WCMatchPreview
        (FixtureID, WriteupUrl, WriteupTitle, PublishedAt, UpdatedAt)
      VALUES
        (@fixtureId, @writeupUrl, @writeupTitle, PENDING_COMMIT_TIMESTAMP(), PENDING_COMMIT_TIMESTAMP())`,
    {
      fixtureId,
      writeupUrl,
      writeupTitle,
    },
  );

  return {
    ok: true,
    status: 200,
    result: {
      action: "publish_preview",
      fixtureId,
      writeupUrl,
      requestedWriteupUrl: rawWriteupUrl || null,
      writeupTitle,
      rowsUpdated: rowCount,
    },
  };
}

async function commitSpannerWrite(action: Extract<CommitAction, { type: "spanner_write" }>) {
  const database = normalizeSpannerDatabaseName(String(action.database || ""));
  const table = String(action.table || "").trim();
  const operation = String(action.operation || "").toUpperCase() as "INSERT" | "UPDATE" | "DELETE";
  const params = asRecord(action.params) || {};

  if (!SPANNER_DB_ALLOWLIST.has(database)) {
    return { ok: false, status: 400, code: "INVALID_DATABASE", error: `database '${database}' is not allowed.` };
  }
  if (!isSafeIdentifier(table)) {
    return { ok: false, status: 400, code: "INVALID_TABLE", error: "table name is invalid." };
  }
  if (!["INSERT", "UPDATE", "DELETE"].includes(operation)) {
    return { ok: false, status: 400, code: "INVALID_OPERATION", error: `operation '${operation}' is not supported.` };
  }

  if (operation === "INSERT") {
    const values = asRecord(params.values || params);
    if (!values || Object.keys(values).length === 0) {
      return { ok: false, status: 400, code: "INVALID_INSERT_VALUES", error: "INSERT requires params.values object." };
    }
    const columns = Object.keys(values);
    if (!columns.every(isSafeIdentifier)) {
      return { ok: false, status: 400, code: "INVALID_INSERT_COLUMNS", error: "One or more INSERT column names are invalid." };
    }
    const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((c) => `@${c}`).join(", ")})`;
    const rowCount = await runDmlWithTransaction(database, sql, values);
    return {
      ok: true,
      status: 200,
      result: {
        action: "spanner_write",
        database,
        table,
        operation,
        rowsUpdated: rowCount,
      },
    };
  }

  if (operation === "UPDATE") {
    const setValues = asRecord(params.set);
    const whereValues = asRecord(params.where);
    if (!setValues || Object.keys(setValues).length === 0) {
      return { ok: false, status: 400, code: "INVALID_UPDATE_SET", error: "UPDATE requires params.set object." };
    }
    if (!whereValues || Object.keys(whereValues).length === 0) {
      return { ok: false, status: 400, code: "INVALID_UPDATE_WHERE", error: "UPDATE requires params.where object." };
    }
    const setCols = Object.keys(setValues);
    const whereCols = Object.keys(whereValues);
    if (![...setCols, ...whereCols].every(isSafeIdentifier)) {
      return { ok: false, status: 400, code: "INVALID_UPDATE_COLUMNS", error: "One or more UPDATE column names are invalid." };
    }

    const sql = `UPDATE ${table}
                 SET ${setCols.map((col) => `${col}=@set_${col}`).join(", ")}
                 WHERE ${whereCols.map((col) => `${col}=@where_${col}`).join(" AND ")}`;
    const queryParams: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(setValues)) queryParams[`set_${key}`] = value;
    for (const [key, value] of Object.entries(whereValues)) queryParams[`where_${key}`] = value;
    const rowCount = await runDmlWithTransaction(database, sql, queryParams);
    return {
      ok: true,
      status: 200,
      result: {
        action: "spanner_write",
        database,
        table,
        operation,
        rowsUpdated: rowCount,
      },
    };
  }

  const whereValues = asRecord(params.where);
  if (!whereValues || Object.keys(whereValues).length === 0) {
    return { ok: false, status: 400, code: "INVALID_DELETE_WHERE", error: "DELETE requires params.where object." };
  }
  const whereCols = Object.keys(whereValues);
  if (!whereCols.every(isSafeIdentifier)) {
    return { ok: false, status: 400, code: "INVALID_DELETE_COLUMNS", error: "One or more DELETE column names are invalid." };
  }

  const sql = `DELETE FROM ${table} WHERE ${whereCols.map((col) => `${col}=@where_${col}`).join(" AND ")}`;
  const queryParams: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(whereValues)) queryParams[`where_${key}`] = value;
  const rowCount = await runDmlWithTransaction(database, sql, queryParams);
  return {
    ok: true,
    status: 200,
    result: {
      action: "spanner_write",
      database,
      table,
      operation,
      rowsUpdated: rowCount,
    },
  };
}

async function commitApiFetch(action: Extract<CommitAction, { type: "api_fetch" }>) {
  if (!NOVA_SESSION_TOKEN) {
    return {
      ok: false,
      status: 400,
      code: "NOVA_TOKEN_NOT_CONFIGURED",
      error: "Nova token not configured. Set NOVA_SESSION_TOKEN and redeploy.",
    };
  }

  const method = String(action.method || "GET").toUpperCase();
  const url = String(action.url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, status: 400, code: "INVALID_API_URL", error: "api_fetch url must be an absolute HTTP(S) URL." };
  }

  const headers = normalizeStringMap(action.headers);
  headers.Authorization = `Bearer ${NOVA_SESSION_TOKEN}`;
  if (!headers["Content-Type"] && method !== "GET" && method !== "HEAD") {
    headers["Content-Type"] = "application/json";
  }

  const init: RequestInit = { method, headers };
  if (action.body != null && method !== "GET" && method !== "HEAD") {
    init.body = typeof action.body === "string" ? action.body : JSON.stringify(action.body);
  }

  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      status: 502,
      code: "API_FETCH_FAILED",
      error: `API fetch failed with ${response.status} ${response.statusText}`,
      details: {
        method,
        url,
        upstreamStatus: response.status,
        upstreamBody: text.slice(0, 2000),
      },
    };
  }

  return {
    ok: true,
    status: 200,
    result: {
      action: "api_fetch",
      method,
      url,
      upstreamStatus: response.status,
      responseBody: text.slice(0, 2000),
    },
  };
}

async function commitCreateEmailDraft(action: Extract<CommitAction, { type: "create_email_draft" }>) {
  const candidateId = readString(action.candidateId);
  const templateId = readString(action.templateId || "initial_outreach").toLowerCase();
  const toEmail = readString(action.toEmail);
  const subject = readString(action.subject);
  const body = readString(action.body);
  const cc = readStringList(action.cc);
  const missing: string[] = [];

  if (!candidateId) missing.push("candidateId");
  if (!templateId) missing.push("templateId");
  if (!toEmail) missing.push("toEmail");
  if (!subject) missing.push("subject");
  if (!body) missing.push("body");

  if (missing.length > 0) {
    return {
      ok: false,
      status: 400,
      code: "MISSING_REQUIRED_FIELDS",
      error: `create_email_draft missing required fields: ${missing.join(", ")}`,
    };
  }

  if (isTemplateRecipientMismatch({ templateId, toEmail })) {
    return {
      ok: false,
      status: 400,
      code: "TEMPLATE_RECIPIENT_MISMATCH",
      error: `Template '${OPS_REASSIGNMENT_TEMPLATE_ID}' requires toEmail '${OPS_REASSIGNMENT_RECIPIENT}'.`,
    };
  }

  const draft = await executeDbTool("create_com_draft_email", {
    candidate_id: candidateId,
    subject,
    body,
    to_email: toEmail,
    cc,
    save_note_trace: true,
  });
  if (draft.error) {
    const mapped = mapDbToolError(draft.error);
    return { ok: false, status: mapped.status, code: mapped.code, error: mapped.error };
  }

  const resultObj = asResultRecord(draft.result);
  return {
    ok: true,
    status: 200,
    result: {
      action: "create_email_draft",
      template_id: templateId,
      candidate_id: resultObj.candidate_id || candidateId,
      draft_id: resultObj.draft_id || null,
      subject: resultObj.subject || subject,
      to_email: resultObj.to_email || toEmail,
      cc: Array.isArray(resultObj.cc) ? resultObj.cc : cc,
      note_trace: resultObj.note_trace || null,
      rowsUpdated: typeof resultObj.rows_updated === "number" ? resultObj.rows_updated : 1,
      outcome: resultObj.outcome || "inserted",
    },
  };
}

async function commitLogCandidateNote(action: Extract<CommitAction, { type: "log_candidate_note" }>) {
  const candidateId = readString(action.candidateId);
  const content = readString(action.content);
  const noteType = readString(action.noteType || "follow_up") || "follow_up";
  if (!candidateId || !content) {
    return {
      ok: false,
      status: 400,
      code: "MISSING_REQUIRED_FIELDS",
      error: "log_candidate_note requires candidateId and content.",
    };
  }

  const note = await executeDbTool("add_candidate_note", {
    candidate_id: candidateId,
    content,
    note_type: noteType,
  });
  if (note.error) {
    const mapped = mapDbToolError(note.error);
    return { ok: false, status: mapped.status, code: mapped.code, error: mapped.error };
  }

  const resultObj = asResultRecord(note.result);
  return {
    ok: true,
    status: 200,
    result: {
      action: "log_candidate_note",
      candidate_id: resultObj.candidate_id || candidateId,
      note_id: asResultRecord(resultObj.note).id || null,
      rowsUpdated: typeof resultObj.rows_updated === "number" ? resultObj.rows_updated : 1,
      outcome: resultObj.outcome || "inserted",
    },
  };
}

async function commitSendEmailNow(action: Extract<CommitAction, { type: "send_email_now" }>) {
  const candidateId = readString(action.candidateId);
  const templateId = readString(action.templateId || "initial_outreach").toLowerCase();
  const toEmail = readString(action.toEmail);
  const subject = readString(action.subject);
  const body = readString(action.body);
  const cc = readStringList(action.cc);

  if (SEND_NOW_DISABLED_TEMPLATES.has(templateId)) {
    return {
      ok: false,
      status: 400,
      code: "TEMPLATE_SEND_NOT_ALLOWED",
      error: `Template '${templateId}' supports Save Draft only.`,
    };
  }

  const missing: string[] = [];

  if (!candidateId) missing.push("candidateId");
  if (!templateId) missing.push("templateId");
  if (!toEmail) missing.push("toEmail");
  if (!subject) missing.push("subject");
  if (!body) missing.push("body");
  if (missing.length > 0) {
    return {
      ok: false,
      status: 400,
      code: "MISSING_REQUIRED_FIELDS",
      error: `send_email_now missing required fields: ${missing.join(", ")}`,
    };
  }

  if (isTemplateRecipientMismatch({ templateId, toEmail })) {
    return {
      ok: false,
      status: 400,
      code: "TEMPLATE_RECIPIENT_MISMATCH",
      error: `Template '${OPS_REASSIGNMENT_TEMPLATE_ID}' requires toEmail '${OPS_REASSIGNMENT_RECIPIENT}'.`,
    };
  }

  const draft = await executeDbTool("create_com_draft_email", {
    candidate_id: candidateId,
    subject,
    body,
    to_email: toEmail,
    cc,
    save_note_trace: false,
  });
  if (draft.error) {
    const mapped = mapDbToolError(draft.error);
    return { ok: false, status: mapped.status, code: mapped.code, error: mapped.error };
  }

  const draftResult = asResultRecord(draft.result);
  const draftId = readString(draftResult.draft_id);
  if (!draftId) {
    return {
      ok: false,
      status: 500,
      code: "EMAIL_WORKFLOW_FAILED",
      error: "Draft created without draft_id.",
    };
  }

  const sentAtIso = new Date().toISOString();
  const metadataJson = JSON.stringify({
    to_email: toEmail,
    cc,
    channel: "email",
    state: "sent",
    sent_at: sentAtIso,
  });
  const sentRowsUpdated = await runDmlWithTransaction(
    "recruitingdb",
    `UPDATE activities
      SET metadata = PARSE_JSON(@metadataJson)
      WHERE activity_id = @activityId`,
    {
      metadataJson,
      activityId: draftId,
    },
  );

  const providedNote = readString(action.noteContent);
  const defaultSentNote = [
    "Outreach sent",
    `Template: ${templateId}`,
    `Subject: ${subject}`,
    `Recipient: ${toEmail}`,
    `Contacted At: ${sentAtIso}`,
    "Status: Sent",
  ].join("\n");
  const noteContent = providedNote
    ? /contacted at:/i.test(providedNote)
      ? providedNote
      : `${providedNote}\nContacted At: ${sentAtIso}`
    : defaultSentNote;

  const note = await executeDbTool("add_candidate_note", {
    candidate_id: candidateId,
    content: noteContent,
    note_type: "follow_up",
  });
  if (note.error) {
    const mapped = mapDbToolError(note.error);
    return { ok: false, status: mapped.status, code: mapped.code, error: mapped.error };
  }
  const noteResult = asResultRecord(note.result);
  const draftRowsUpdated = typeof draftResult.rows_updated === "number" ? draftResult.rows_updated : 1;
  const noteRowsUpdated = typeof noteResult.rows_updated === "number" ? noteResult.rows_updated : 1;

  return {
    ok: true,
    status: 200,
    result: {
      action: "send_email_now",
      template_id: templateId,
      candidate_id: draftResult.candidate_id || candidateId,
      draft_id: draftId,
      subject: draftResult.subject || subject,
      to_email: draftResult.to_email || toEmail,
      cc: Array.isArray(draftResult.cc) ? draftResult.cc : cc,
      note_id: asResultRecord(noteResult.note).id || null,
      rowsUpdated: draftRowsUpdated + sentRowsUpdated + noteRowsUpdated,
      outcome: "updated",
    },
  };
}

async function commitCreateAgentHandoffTask(
  action: Extract<CommitAction, { type: "create_agent_handoff_task" }>,
  taskId: string,
  requestOrigin: string,
) {
  const targetUrl = readString(action.targetUrl);
  const goal = readString(action.goal);
  const sourceSurface = readString(action.sourceSurface || "nova").toLowerCase() || "nova";
  const instructions = readStringList(action.instructions);
  const expectedReturnSchema = asRecord(action.expectedReturnSchema) || {};
  const context = asRecord(action.context);
  const autoLaunch = Boolean(action.autoLaunch);

  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_TARGET_URL",
      error: "create_agent_handoff_task requires absolute HTTP(S) targetUrl.",
    };
  }
  if (!goal) {
    return {
      ok: false,
      status: 400,
      code: "MISSING_GOAL",
      error: "create_agent_handoff_task requires goal.",
    };
  }
  if (!Array.isArray(action.instructions) || instructions.length === 0) {
    return {
      ok: false,
      status: 400,
      code: "MISSING_INSTRUCTIONS",
      error: "create_agent_handoff_task requires non-empty instructions array.",
    };
  }

  const record = await createAgentHandoffTask({
    targetUrl,
    sourceSurface,
    goal,
    instructions,
    expectedReturnSchema,
    context,
    autoLaunch,
    createdBy: "sandbox",
    sandboxTaskId: taskId || null,
  });

  const handoffUrl = `${requestOrigin.replace(/\/+$/, "")}/agent-task/${encodeURIComponent(record.taskId)}`;
  return {
    ok: true,
    status: 200,
    result: {
      action: "create_agent_handoff_task",
      task_id: record.taskId,
      ledger_id: record.ledgerId,
      source_surface: record.sourceSurface,
      target_url: record.targetUrl,
      handoff_url: handoffUrl,
      return_path: `/api/agent-task/${encodeURIComponent(record.taskId)}`,
      rowsUpdated: 1,
      outcome: "inserted",
    },
  };
}

export async function POST(request: NextRequest) {
  // ── Auth Gate ──────────────────────────────────────────────
  const { user, response: authResponse } = await requireAuth(request);
  if (authResponse) return authResponse;

  try {
    const body = (await request.json()) as { taskId?: string; commitAction?: CommitAction };
    const taskId = typeof body.taskId === "string" ? body.taskId : "";
    const commitAction = body.commitAction;

    if (!commitAction || typeof commitAction !== "object") {
      return Response.json(
        { status: "failed", code: "MISSING_COMMIT_ACTION", error: "commitAction is required." },
        { status: 400 },
      );
    }
    if (!COMMIT_ALLOWLIST.has(commitAction.type)) {
      return Response.json(
        {
          status: "failed",
          code: "UNSUPPORTED_COMMIT_ACTION",
          error: `Commit action '${String(commitAction.type)}' is not allowed in sandbox v1.`,
        },
        { status: 400 },
      );
    }

    let result:
      | Awaited<ReturnType<typeof commitPublishPreview>>
      | Awaited<ReturnType<typeof commitSpannerWrite>>
      | Awaited<ReturnType<typeof commitApiFetch>>
      | Awaited<ReturnType<typeof commitCreateEmailDraft>>
      | Awaited<ReturnType<typeof commitSendEmailNow>>
      | Awaited<ReturnType<typeof commitLogCandidateNote>>
      | Awaited<ReturnType<typeof commitCreateAgentHandoffTask>>;

    if (commitAction.type === "publish_preview") {
      result = await commitPublishPreview(commitAction);
    } else if (commitAction.type === "spanner_write") {
      result = await commitSpannerWrite(commitAction);
    } else if (commitAction.type === "create_email_draft") {
      result = await commitCreateEmailDraft(commitAction);
    } else if (commitAction.type === "send_email_now") {
      result = await commitSendEmailNow(commitAction);
    } else if (commitAction.type === "log_candidate_note") {
      result = await commitLogCandidateNote(commitAction);
    } else if (commitAction.type === "create_agent_handoff_task") {
      result = await commitCreateAgentHandoffTask(commitAction, taskId, resolvePublicOrigin(request));
    } else {
      result = await commitApiFetch(commitAction);
    }

    if (!result.ok) {
      return Response.json(
        {
          status: "failed",
          taskId,
          code: result.code,
          error: result.error,
          details: "details" in result ? result.details : undefined,
        },
        { status: result.status },
      );
    }

    return Response.json({
      status: "executed",
      taskId,
      result: result.result,
    });
  } catch (error) {
    return Response.json(
      {
        status: "failed",
        code: "SANDBOX_COMMIT_INTERNAL_ERROR",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

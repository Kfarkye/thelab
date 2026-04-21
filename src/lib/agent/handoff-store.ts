import { getRecruitingDb } from "@/lib/spanner-pool";

const db = getRecruitingDb();

export type AgentHandoffStatus = "pending" | "opened" | "completed" | "failed";

export interface AgentHandoffTaskRecord {
  taskId: string;
  ledgerId: string;
  status: AgentHandoffStatus;
  targetUrl: string;
  sourceSurface: string;
  goal: string;
  instructions: string[];
  expectedReturnSchema: Record<string, unknown>;
  context: Record<string, unknown> | null;
  autoLaunch: boolean;
  createdBy: string;
  sandboxTaskId: string | null;
  conversationId: string | null;
  mode: string | null;
  result: Record<string, unknown> | null;
  resultSummary: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string | null;
  openedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
}

interface CreateAgentHandoffTaskInput {
  targetUrl: string;
  sourceSurface?: string;
  goal: string;
  instructions?: string[];
  expectedReturnSchema?: Record<string, unknown>;
  context?: Record<string, unknown> | null;
  autoLaunch?: boolean;
  createdBy?: string;
  sandboxTaskId?: string | null;
  conversationId?: string | null;
  mode?: string | null;
}

interface SaveAgentHandoffResultInput {
  status: "completed" | "failed";
  result?: Record<string, unknown> | null;
  resultSummary?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

type SpannerJson = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toIsoString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseJsonColumn(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return value;
  return null;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "null";
  }
}

async function runDml(
  sql: string,
  params: Record<string, unknown>,
  types: Record<string, { type: string }>,
): Promise<number> {
  let rowsUpdated = 0;
  await db.runTransactionAsync(async (tx: any) => {
    const [count] = await tx.runUpdate({ sql, params, types });
    rowsUpdated = Number(count || 0);
    await tx.commit();
  });
  return rowsUpdated;
}

function normalizeInstructions(value: string[] | undefined, goal: string): string[] {
  const normalized = (value || []).map((entry) => String(entry || "").trim()).filter(Boolean);
  if (normalized.length > 0) return normalized;
  return [
    `Open target Nova URL and execute: ${goal}`,
    "Return a structured JSON payload that matches expected_return_schema.",
    "Include brief strategic read and supporting evidence notes.",
  ];
}

function normalizeExpectedReturnSchema(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (value && Object.keys(value).length > 0) return value;
  return {
    type: "object",
    required: ["task_id", "facts", "structured_json", "strategic_read"],
    properties: {
      task_id: { type: "string" },
      facts: { type: "array", items: { type: "string" } },
      structured_json: { type: "object" },
      strategic_read: { type: "string" },
    },
  };
}

function buildAgentTaskIds(sourceSurface: string): { taskId: string; ledgerId: string } {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  const surface = sourceSurface.replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "NOVA";
  return {
    taskId: `AYA.TASK.${surface}.${ymd}.${rand}`,
    ledgerId: `AYA.EVT.AGENT_HANDOFF.${ymd}.${rand}`,
  };
}

function mapRowToTask(row: SpannerJson): AgentHandoffTaskRecord {
  const instructionsRaw = parseJsonColumn(row.instructions_json);
  const instructions = Array.isArray(instructionsRaw)
    ? instructionsRaw.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const expectedReturnSchemaRaw = parseJsonColumn(row.expected_return_schema_json);
  const contextRaw = parseJsonColumn(row.context_json);
  const resultRaw = parseJsonColumn(row.result_json);

  return {
    taskId: String(row.task_id || ""),
    ledgerId: String(row.ledger_id || ""),
    status: String(row.status || "pending") as AgentHandoffStatus,
    targetUrl: String(row.target_url || ""),
    sourceSurface: String(row.source_surface || "nova"),
    goal: String(row.goal || ""),
    instructions,
    expectedReturnSchema: asRecord(expectedReturnSchemaRaw) || {},
    context: asRecord(contextRaw),
    autoLaunch: Boolean(row.auto_launch),
    createdBy: String(row.created_by || "sandbox"),
    sandboxTaskId: row.sandbox_task_id ? String(row.sandbox_task_id) : null,
    conversationId: row.conversation_id ? String(row.conversation_id) : null,
    mode: row.mode ? String(row.mode) : null,
    result: asRecord(resultRaw),
    resultSummary: row.result_summary ? String(row.result_summary) : null,
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: toIsoString(row.created_at),
    openedAt: toIsoString(row.opened_at),
    completedAt: toIsoString(row.completed_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

export async function getAgentHandoffTask(taskId: string): Promise<AgentHandoffTaskRecord | null> {
  const id = String(taskId || "").trim();
  if (!id) return null;

  const [rows] = await db.run({
    sql: `SELECT
            task_id, ledger_id, status, target_url, source_surface, goal,
            instructions_json, expected_return_schema_json, context_json, auto_launch,
            created_by, sandbox_task_id, conversation_id, mode,
            result_json, result_summary, error_code, error_message,
            created_at, opened_at, completed_at, updated_at
          FROM agent_handoff_tasks
          WHERE task_id = @taskId
          LIMIT 1`,
    params: { taskId: id },
    types: {
      taskId: { type: "string" },
    },
  });

  if (rows.length === 0) return null;
  return mapRowToTask(rows[0].toJSON() as SpannerJson);
}

export async function createAgentHandoffTask(
  input: CreateAgentHandoffTaskInput,
): Promise<AgentHandoffTaskRecord> {
  const targetUrl = String(input.targetUrl || "").trim();
  const parsedTarget = new URL(targetUrl);
  if (!/^https?:$/i.test(parsedTarget.protocol)) {
    throw new Error("targetUrl must be an absolute HTTP(S) URL.");
  }

  const sourceSurface = String(input.sourceSurface || "nova").trim().toLowerCase() || "nova";
  const goal = String(input.goal || "").trim();
  if (!goal) {
    throw new Error("goal is required.");
  }

  const instructions = normalizeInstructions(input.instructions, goal);
  const expectedReturnSchema = normalizeExpectedReturnSchema(input.expectedReturnSchema);
  const context = input.context && typeof input.context === "object" ? input.context : null;
  const autoLaunch = Boolean(input.autoLaunch);
  const createdBy = String(input.createdBy || "sandbox").trim() || "sandbox";
  const sandboxTaskId = input.sandboxTaskId ? String(input.sandboxTaskId).trim() : null;
  const conversationId = input.conversationId ? String(input.conversationId).trim() : null;
  const mode = input.mode ? String(input.mode).trim() : null;

  const { taskId, ledgerId } = buildAgentTaskIds(sourceSurface);

  await runDml(
    `INSERT INTO agent_handoff_tasks (
            task_id,
            ledger_id,
            status,
            target_url,
            source_surface,
            goal,
            instructions_json,
            expected_return_schema_json,
            context_json,
            auto_launch,
            created_by,
            sandbox_task_id,
            conversation_id,
            mode,
            result_json,
            result_summary,
            error_code,
            error_message,
            created_at,
            updated_at
          ) VALUES (
            @taskId,
            @ledgerId,
            'pending',
            @targetUrl,
            @sourceSurface,
            @goal,
            PARSE_JSON(@instructionsJson),
            PARSE_JSON(@expectedReturnSchemaJson),
            PARSE_JSON(@contextJson),
            @autoLaunch,
            @createdBy,
            @sandboxTaskId,
            @conversationId,
            @mode,
            NULL,
            NULL,
            NULL,
            NULL,
            PENDING_COMMIT_TIMESTAMP(),
            PENDING_COMMIT_TIMESTAMP()
          )`,
    {
      taskId,
      ledgerId,
      targetUrl,
      sourceSurface,
      goal,
      instructionsJson: safeJsonStringify(instructions),
      expectedReturnSchemaJson: safeJsonStringify(expectedReturnSchema),
      contextJson: safeJsonStringify(context),
      autoLaunch,
      createdBy,
      sandboxTaskId,
      conversationId,
      mode,
    },
    {
      taskId: { type: "string" },
      ledgerId: { type: "string" },
      targetUrl: { type: "string" },
      sourceSurface: { type: "string" },
      goal: { type: "string" },
      instructionsJson: { type: "string" },
      expectedReturnSchemaJson: { type: "string" },
      contextJson: { type: "string" },
      autoLaunch: { type: "bool" },
      createdBy: { type: "string" },
      sandboxTaskId: { type: "string" },
      conversationId: { type: "string" },
      mode: { type: "string" },
    },
  );

  const created = await getAgentHandoffTask(taskId);
  if (!created) {
    throw new Error(`Agent handoff task was not visible after insert for id ${taskId}`);
  }
  return created;
}

export async function markAgentHandoffOpened(taskId: string): Promise<AgentHandoffTaskRecord | null> {
  const id = String(taskId || "").trim();
  if (!id) return null;

  await runDml(
    `UPDATE agent_handoff_tasks
          SET status = CASE WHEN status = 'pending' THEN 'opened' ELSE status END,
              opened_at = PENDING_COMMIT_TIMESTAMP(),
              updated_at = PENDING_COMMIT_TIMESTAMP()
          WHERE task_id = @taskId`,
    { taskId: id },
    {
      taskId: { type: "string" },
    },
  );

  return getAgentHandoffTask(id);
}

export async function saveAgentHandoffResult(
  taskId: string,
  input: SaveAgentHandoffResultInput,
): Promise<AgentHandoffTaskRecord | null> {
  const id = String(taskId || "").trim();
  if (!id) return null;
  const status = input.status === "failed" ? "failed" : "completed";

  await runDml(
    `UPDATE agent_handoff_tasks
          SET status = @status,
              result_json = PARSE_JSON(@resultJson),
              result_summary = @resultSummary,
              error_code = @errorCode,
              error_message = @errorMessage,
              completed_at = PENDING_COMMIT_TIMESTAMP(),
              updated_at = PENDING_COMMIT_TIMESTAMP()
          WHERE task_id = @taskId`,
    {
      taskId: id,
      status,
      resultJson: safeJsonStringify(input.result || null),
      resultSummary: input.resultSummary ? String(input.resultSummary) : null,
      errorCode: input.errorCode ? String(input.errorCode) : null,
      errorMessage: input.errorMessage ? String(input.errorMessage) : null,
    },
    {
      taskId: { type: "string" },
      status: { type: "string" },
      resultJson: { type: "string" },
      resultSummary: { type: "string" },
      errorCode: { type: "string" },
      errorMessage: { type: "string" },
    },
  );

  return getAgentHandoffTask(id);
}

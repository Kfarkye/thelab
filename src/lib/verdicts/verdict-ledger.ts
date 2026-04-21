// ── Verdict Ledger ───────────────────────────────────────────────
// Shared architecture decision log for AI agents and humans.
// Both Antigravity and Codex write here; The Lab renders it live.

import { randomUUID } from "node:crypto";
import { Spanner } from "@google-cloud/spanner";
import { getRecruitingDb } from "@/lib/spanner-pool";

const db = getRecruitingDb();

// ── Types ───────────────────────────────────────────────────────

export type VerdictStatus = "proposed" | "accepted" | "rejected" | "superseded";
export type VerdictCategory = "architecture" | "bug" | "refactor" | "security" | "perf" | "data";
export type AgentSource = "antigravity" | "codex" | "human";
export type RiskZone = "MONEY" | "AUTH" | "ID" | "SHAPE" | "INFRA" | "SEC";

export type Verdict = {
  verdict_id: string;
  agent_source: AgentSource;
  category: VerdictCategory;
  status: VerdictStatus;
  title: string;
  body: string;
  risk_zones: RiskZone[];
  files_touched: string[];
  refs: string[];
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateVerdictInput = {
  agent_source: AgentSource;
  category: VerdictCategory;
  title: string;
  body: string;
  risk_zones?: RiskZone[];
  files_touched?: string[];
  refs?: string[];
  status?: VerdictStatus;
};

export type UpdateVerdictInput = {
  verdict_id: string;
  status?: VerdictStatus;
  body?: string;
  superseded_by?: string;
};

// ── Queries ─────────────────────────────────────────────────────

export async function createVerdict(input: CreateVerdictInput): Promise<Verdict> {
  const verdictId = randomUUID();
  const now = Spanner.COMMIT_TIMESTAMP;

  await db.runTransactionAsync(async (tx: any) => {
    tx.insert("verdicts", {
      verdict_id: verdictId,
      agent_source: input.agent_source,
      category: input.category,
      status: input.status || "proposed",
      title: input.title,
      body: input.body,
      risk_zones: input.risk_zones || [],
      files_touched: input.files_touched || [],
      refs: input.refs || [],
      superseded_by: null,
      created_at: now,
      updated_at: now,
    });
    await tx.commit();
  });

  // Re-read to get the committed timestamp
  const [rows] = await db.run({
    sql: `SELECT * FROM verdicts WHERE verdict_id = @verdictId`,
    params: { verdictId },
  });

  return rowToVerdict(rows[0]);
}

export async function updateVerdictStatus(input: UpdateVerdictInput): Promise<Verdict | null> {
  const sets: string[] = [];
  const params: Record<string, unknown> = { verdictId: input.verdict_id };

  if (input.status) {
    sets.push("status = @newStatus");
    params.newStatus = input.status;
  }
  if (input.body) {
    sets.push("body = @newBody");
    params.newBody = input.body;
  }
  if (input.superseded_by) {
    sets.push("superseded_by = @supersededBy");
    params.supersededBy = input.superseded_by;
  }

  if (sets.length === 0) return null;

  sets.push("updated_at = PENDING_COMMIT_TIMESTAMP()");

  await db.runTransactionAsync(async (tx: any) => {
    await tx.runUpdate({
      sql: `UPDATE verdicts SET ${sets.join(", ")} WHERE verdict_id = @verdictId`,
      params,
    });
    await tx.commit();
  });

  const [rows] = await db.run({
    sql: `SELECT * FROM verdicts WHERE verdict_id = @verdictId`,
    params: { verdictId: input.verdict_id },
  });

  if (rows.length === 0) return null;
  return rowToVerdict(rows[0]);
}

export async function listVerdicts(opts?: {
  status?: VerdictStatus;
  agent?: AgentSource;
  limit?: number;
}): Promise<Verdict[]> {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};
  const limit = Math.min(Math.max(opts?.limit || 50, 1), 200);

  if (opts?.status) {
    conditions.push("status = @statusFilter");
    params.statusFilter = opts.status;
  }
  if (opts?.agent) {
    conditions.push("agent_source = @agentFilter");
    params.agentFilter = opts.agent;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [rows] = await db.run({
    sql: `SELECT * FROM verdicts ${where} ORDER BY created_at DESC LIMIT ${limit}`,
    params,
  });

  return rows.map((r: any) => rowToVerdict(r));
}

export async function getVerdict(verdictId: string): Promise<Verdict | null> {
  const [rows] = await db.run({
    sql: `SELECT * FROM verdicts WHERE verdict_id = @verdictId`,
    params: { verdictId },
  });

  if (rows.length === 0) return null;
  return rowToVerdict(rows[0]);
}

// ── Row Mapper ──────────────────────────────────────────────────

function rowToVerdict(row: any): Verdict {
  const j = row.toJSON ? row.toJSON() : row;
  return {
    verdict_id: String(j.verdict_id || ""),
    agent_source: String(j.agent_source || "human") as AgentSource,
    category: String(j.category || "architecture") as VerdictCategory,
    status: String(j.status || "proposed") as VerdictStatus,
    title: String(j.title || ""),
    body: String(j.body || ""),
    risk_zones: Array.isArray(j.risk_zones) ? j.risk_zones.map(String) : [],
    files_touched: Array.isArray(j.files_touched) ? j.files_touched.map(String) : [],
    refs: Array.isArray(j.refs) ? j.refs.map(String) : [],
    superseded_by: j.superseded_by ? String(j.superseded_by) : null,
    created_at: j.created_at instanceof Date ? j.created_at.toISOString() : String(j.created_at || ""),
    updated_at: j.updated_at instanceof Date ? j.updated_at.toISOString() : String(j.updated_at || ""),
  };
}

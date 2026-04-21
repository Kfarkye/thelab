// ── Verdicts API Route ───────────────────────────────────────────
// GET  /api/verdicts — List all verdicts (optional ?status=, ?agent=)
// POST /api/verdicts — Create a new verdict
// Both Antigravity and Codex call this to write architecture decisions.

import { NextResponse } from "next/server";
import {
  createVerdict,
  listVerdicts,
  type CreateVerdictInput,
  type AgentSource,
  type VerdictCategory,
  type VerdictStatus,
  type RiskZone,
} from "@/lib/verdicts/verdict-ledger";

const VALID_AGENTS: Set<string> = new Set(["antigravity", "codex", "human"]);
const VALID_CATEGORIES: Set<string> = new Set([
  "architecture", "bug", "refactor", "security", "perf", "data",
]);
const VALID_STATUSES: Set<string> = new Set([
  "proposed", "accepted", "rejected", "superseded",
]);
const VALID_RISK_ZONES: Set<string> = new Set([
  "MONEY", "AUTH", "ID", "SHAPE", "INFRA", "SEC",
]);

function validateRiskZones(zones: unknown): RiskZone[] {
  if (!Array.isArray(zones)) return [];
  return zones
    .map((z) => String(z).toUpperCase())
    .filter((z) => VALID_RISK_ZONES.has(z)) as RiskZone[];
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get("status") || undefined;
    const agentFilter = searchParams.get("agent") || undefined;
    const limitParam = Number(searchParams.get("limit") || 50);

    const verdicts = await listVerdicts({
      status: statusFilter && VALID_STATUSES.has(statusFilter) ? statusFilter as VerdictStatus : undefined,
      agent: agentFilter && VALID_AGENTS.has(agentFilter) ? agentFilter as AgentSource : undefined,
      limit: limitParam,
    });

    return NextResponse.json({
      ok: true,
      count: verdicts.length,
      verdicts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[verdicts] GET failed: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Validate required fields
    const agentSource = String(body.agent_source || "").toLowerCase();
    if (!VALID_AGENTS.has(agentSource)) {
      return NextResponse.json(
        { ok: false, error: `Invalid agent_source. Valid: ${[...VALID_AGENTS].join(", ")}` },
        { status: 400 },
      );
    }

    const category = String(body.category || "").toLowerCase();
    if (!VALID_CATEGORIES.has(category)) {
      return NextResponse.json(
        { ok: false, error: `Invalid category. Valid: ${[...VALID_CATEGORIES].join(", ")}` },
        { status: 400 },
      );
    }

    const title = String(body.title || "").trim();
    if (!title) {
      return NextResponse.json({ ok: false, error: "title is required" }, { status: 400 });
    }

    const verdictBody = String(body.body || "").trim();
    if (!verdictBody) {
      return NextResponse.json({ ok: false, error: "body is required" }, { status: 400 });
    }

    const input: CreateVerdictInput = {
      agent_source: agentSource as AgentSource,
      category: category as VerdictCategory,
      title,
      body: verdictBody,
      risk_zones: validateRiskZones(body.risk_zones),
      files_touched: Array.isArray(body.files_touched)
        ? body.files_touched.map(String)
        : [],
      refs: Array.isArray(body.refs) ? body.refs.map(String) : [],
      status: body.status && VALID_STATUSES.has(body.status) ? body.status : "proposed",
    };

    const verdict = await createVerdict(input);

    console.log(
      `[verdicts] Created verdict="${verdict.verdict_id}" agent=${verdict.agent_source} title="${verdict.title}"`,
    );

    return NextResponse.json({ ok: true, verdict }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[verdicts] POST failed: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

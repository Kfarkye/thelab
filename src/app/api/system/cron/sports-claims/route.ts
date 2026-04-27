import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import {
  ingestGovernedClaims,
  type GovernedClaimIngestItem,
} from "@/lib/sports/claims-ledger";
import { buildDefaultSportsClaimItems } from "@/lib/sports/claims-producer";

export const runtime = "nodejs";
export const maxDuration = 120;

function readString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

function readInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
}

function parseItems(value: unknown): GovernedClaimIngestItem[] {
  if (!Array.isArray(value)) return [];

  const items: GovernedClaimIngestItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const obj = entry as Record<string, unknown>;

    const source_policy_id = readString(obj.source_policy_id || obj.sourcePolicyId);
    const extractionRaw = obj.extraction;
    if (!source_policy_id) continue;
    if (!extractionRaw || typeof extractionRaw !== "object" || Array.isArray(extractionRaw)) continue;

    items.push({
      source_policy_id,
      extraction: extractionRaw as GovernedClaimIngestItem["extraction"],
    });
  }
  return items;
}

function parseLeagueIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => readString(entry).toLowerCase())
    .filter(Boolean);
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const { response } = await requireAuth(request);
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }

  const payload = body as Record<string, unknown>;
  const manualItems = parseItems(payload.items);
  const autoMode = manualItems.length === 0;
  const lookbackDays = readInteger(payload.lookbackDays ?? payload.lookback_days);
  const limit = readInteger(payload.limit);
  const leagueIds = parseLeagueIds(payload.leagueIds ?? payload.league_ids);

  const items = autoMode
    ? await buildDefaultSportsClaimItems({
        lookbackDays: lookbackDays ?? undefined,
        limit: limit ?? undefined,
        leagueIds: leagueIds.length > 0 ? leagueIds : undefined,
      })
    : manualItems;

  if (items.length === 0) {
    const status = autoMode ? 200 : 400;
    return NextResponse.json(
      autoMode
        ? {
            status: "ok",
            mode: "auto",
            produced_count: 0,
            message: "No eligible market-line claims found in the requested window.",
          }
        : { error: "items must be a non-empty array of { source_policy_id, extraction }" },
      { status, headers: { "x-request-id": requestId } },
    );
  }

  try {
    const result = await ingestGovernedClaims(items);
    return NextResponse.json(
      {
        status: "ok",
        mode: autoMode ? "auto" : "manual",
        produced_count: autoMode ? items.length : undefined,
        ...result,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0, must-revalidate",
          "x-request-id": requestId,
        },
      },
    );
  } catch (error) {
    console.error("[sports-claims-cron] failed", {
      count: items.length,
      mode: autoMode ? "auto" : "manual",
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: "Failed to ingest sports claims." },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0, must-revalidate",
          "x-request-id": requestId,
        },
      },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  computeTrackRecord,
  listPicks,
  resolvePick,
  todayDateKey,
  type PickTier,
} from "@/lib/sports/picks-ledger";

export const runtime = "nodejs";

function parseRole(value: string | null): PickTier {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "INTERNAL") return "INTERNAL";
  if (normalized === "PAID") return "PAID";
  return "PUBLIC";
}

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 40;
  return Math.max(1, Math.min(200, Math.trunc(parsed)));
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  const briefId = request.nextUrl.searchParams.get("brief_id");
  const targetDate = request.nextUrl.searchParams.get("date");
  const role = parseRole(request.nextUrl.searchParams.get("role") || request.nextUrl.searchParams.get("surface"));
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

  const effectiveDate = briefId ? null : (targetDate || todayDateKey());

  try {
    const picks = await listPicks({
      briefId,
      date: effectiveDate,
      limit,
    });

    const shaped = picks.map((pick) => resolvePick(pick, role));
    const trackRecord = await computeTrackRecord(30);

    return NextResponse.json(
      {
        type: "pick_list",
        status: "resolved",
        summary: `${shaped.length} picks loaded`,
        data: {
          filters: {
            brief_id: briefId || null,
            date: effectiveDate,
            role,
            limit,
          },
          track_record: trackRecord,
          picks: shaped,
        },
        links: {
          self: request.nextUrl.pathname + request.nextUrl.search,
          by_pick: "/api/sports/picks/{pick_id}",
          by_brief: "/api/sports/picks?brief_id={brief_id}",
          by_date: "/api/sports/picks?date=YYYY-MM-DD",
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0, must-revalidate",
          "x-request-id": requestId,
        },
      },
    );
  } catch (error) {
    console.error("[sports-picks] Failed to load picks", {
      briefId,
      targetDate: effectiveDate,
      role,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: "Failed to load picks ledger." },
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

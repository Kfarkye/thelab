import { NextRequest, NextResponse } from "next/server";
import {
  buildConsumerSettlementSummary,
  getPickById,
  resolvePick,
  type PickTier,
} from "@/lib/sports/picks-ledger";

export const runtime = "nodejs";

function parseTier(value: string | null): PickTier {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "INTERNAL") return "INTERNAL";
  if (normalized === "PAID") return "PAID";
  return "PUBLIC";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pickId: string }> },
) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const { pickId: pickIdRaw } = await params;
  const pickId = String(pickIdRaw || "").trim();
  const tier = parseTier(request.nextUrl.searchParams.get("tier") || request.nextUrl.searchParams.get("role"));

  if (!pickId) {
    return NextResponse.json(
      { error: "Pick ID is required." },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store, max-age=0, must-revalidate",
          "x-request-id": requestId,
        },
      },
    );
  }

  try {
    const pick = await getPickById(pickId);
    if (!pick) {
      return NextResponse.json(
        {
          type: "pick",
          status: "not_found",
          summary: `No pick matched \"${pickId}\".`,
          data: null,
          links: {},
        },
        {
          status: 404,
          headers: {
            "Cache-Control": "no-store, max-age=0, must-revalidate",
            "x-request-id": requestId,
          },
        },
      );
    }

    const resolved = resolvePick(pick, tier);
    const summary =
      tier === "INTERNAL"
        ? `${pick.display} | ${pick.event_status || "SCHEDULED"} | ${pick.grading_status || "PENDING"}`
        : buildConsumerSettlementSummary({
            display: pick.display,
            market_type: pick.market_type,
            grading_status: pick.grading_status,
            units_result: pick.units_result,
          });

    return NextResponse.json(
      {
        type: "pick",
        id: pick.pick_id,
        status: "resolved",
        summary,
        data: resolved,
        links: {
          self: `/api/sports/picks/${encodeURIComponent(pick.pick_id)}`,
          collection: "/api/sports/picks",
          by_brief: pick.brief_id
            ? `/api/sports/picks?brief_id=${encodeURIComponent(pick.brief_id)}`
            : null,
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
    console.error("[sports-pick-api] Failed to resolve pick", {
      pickId,
      tier,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: "Failed to resolve pick." },
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

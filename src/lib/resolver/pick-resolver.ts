import {
  buildConsumerSettlementSummary,
  getPickById,
  listPicks,
  resolvePick as resolvePickPayload,
} from "@/lib/sports/picks-ledger";
import { buildPickLinks } from "./links";
import type { HubResponse } from "./candidate-resolver";

function buildSummary(payload: Record<string, unknown>): string {
  const display = String(payload.display || "Pick");
  return buildConsumerSettlementSummary({
    display,
    market_type: String(payload.market_type || ""),
    grading_status: String(payload.grading_status || "PENDING"),
    units_result: typeof payload.result === "number" ? payload.result : null,
  });
}

export async function resolvePick(identifier: string): Promise<HubResponse> {
  const byId = await getPickById(identifier);
  if (byId) {
    const shaped = resolvePickPayload(byId, "PUBLIC") as Record<string, unknown>;
    return {
      type: "pick",
      id: byId.pick_id,
      status: "resolved",
      summary: buildSummary(shaped),
      data: shaped,
      links: buildPickLinks(byId.pick_id, { briefId: byId.brief_id }),
    };
  }

  const alternatives = await listPicks({ briefId: identifier, limit: 10 });
  if (alternatives.length === 1) {
    const row = alternatives[0];
    const shaped = resolvePickPayload(row, "PUBLIC") as Record<string, unknown>;
    return {
      type: "pick",
      id: row.pick_id,
      status: "resolved",
      summary: buildSummary(shaped),
      data: shaped,
      links: buildPickLinks(row.pick_id, { briefId: row.brief_id }),
    };
  }

  if (alternatives.length > 1) {
    return {
      type: "pick",
      status: "ambiguous",
      summary: `Multiple picks matched \"${identifier}\". Use a pick_id for exact resolution.`,
      data: null,
      links: {},
      alternatives: alternatives.map((pick) => ({
        name: pick.display,
        id: pick.pick_id,
        nova_id: null,
        status: pick.grading_status,
        specialty: pick.priority_band,
        confidence: 50,
      })),
    };
  }

  return {
    type: "pick",
    status: "not_found",
    summary: `No pick matched \"${identifier}\".`,
    data: null,
    links: {},
  };
}

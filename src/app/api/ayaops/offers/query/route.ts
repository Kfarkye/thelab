import { NextRequest } from "next/server";
import {
  OFFER_STATUS_ENUM,
  queryOfferLedger,
  type OfferLedgerQueryInput,
} from "@/lib/ayaops/offer-ledger";

export const runtime = "nodejs";

function toNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function toBoolean(value: string | null): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return undefined;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const query: OfferLedgerQueryInput = {
      offer_id: params.get("offer_id") || undefined,
      candidate_id: params.get("candidate_id") || undefined,
      candidate_name: params.get("candidate_name") || undefined,
      facility_name: params.get("facility_name") || undefined,
      profession: params.get("profession") || undefined,
      specialty: params.get("specialty") || undefined,
      offer_status: params.get("offer_status") || undefined,
      event_id: params.get("event_id") || undefined,
      source_kind: params.get("source_kind") || undefined,
      view_type: params.get("view_type") || undefined,
      include_provenance: toBoolean(params.get("include_provenance")),
      limit: toNumber(params.get("limit")),
      event_limit: toNumber(params.get("event_limit")),
    };

    const result = await queryOfferLedger(query);
    return Response.json({
      ok: true,
      result,
      offer_status_enum: [...OFFER_STATUS_ENUM],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to query offer ledger";
    const status = /must be one of|invalid/i.test(message) ? 400 : 500;
    console.error("Offer ledger query failed:", error);
    return Response.json({ error: message }, { status });
  }
}


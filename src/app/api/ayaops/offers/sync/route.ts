import { NextRequest } from "next/server";
import {
  OFFER_STATUS_ENUM,
  syncOfferLedger,
  type OfferLedgerSyncInput,
} from "@/lib/ayaops/offer-ledger";

export const runtime = "nodejs";

function mapSyncErrorToStatus(message: string): number {
  if (/NOVA_TOKEN_NOT_CONFIGURED/i.test(message)) return 400;
  if (/NOVA_OFFERS_ENDPOINT_NOT_CONFIGURED/i.test(message)) return 400;
  if (/NOVA_PAYLOAD_PARSE_FAILED/i.test(message)) return 502;
  if (/NOVA_FETCH_FAILED:\s*401/i.test(message)) return 401;
  if (/NOVA_FETCH_FAILED:\s*403/i.test(message)) return 403;
  if (/NOVA_FETCH_FAILED:\s*404/i.test(message)) return 404;
  if (/NOVA_FETCH_FAILED/i.test(message)) return 502;
  return 500;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as OfferLedgerSyncInput;
    const result = await syncOfferLedger(body || {});
    return Response.json({
      ok: true,
      result,
      offer_status_enum: [...OFFER_STATUS_ENUM],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync offer ledger";
    const status = mapSyncErrorToStatus(message);
    console.error("Offer ledger sync failed:", error);
    return Response.json({ error: message }, { status });
  }
}


import { NextRequest } from "next/server";
import {
  FEE_TYPE_ENUM,
  queryFeeLedger,
  type FeeLedgerQueryInput,
} from "@/lib/licensing/fee-ledger";

export const runtime = "nodejs";

function toNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const query: FeeLedgerQueryInput = {
      state: params.get("state") || undefined,
      profession: params.get("profession") || undefined,
      fee_type: params.get("fee_type") || undefined,
      event_id: params.get("event_id") || undefined,
      view_type: params.get("view_type") || undefined,
      source_kind: params.get("source_kind") || undefined,
      source_url: params.get("source_url") || undefined,
      limit: toNumber(params.get("limit")),
      event_limit: toNumber(params.get("event_limit")),
    };

    const result = await queryFeeLedger(query);
    return Response.json({
      ok: true,
      result,
      fee_type_enum: [...FEE_TYPE_ENUM],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to query fee ledger";
    const status = /must be one of/i.test(message) ? 400 : 500;
    console.error("Fee ledger query failed:", error);
    return Response.json({ error: message }, { status });
  }
}

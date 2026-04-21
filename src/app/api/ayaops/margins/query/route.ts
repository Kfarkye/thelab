import { NextRequest } from "next/server";
import {
  queryMarginLedger,
  type MarginLedgerQueryInput,
} from "@/lib/ayaops/margin-ledger";

export const runtime = "nodejs";

function toInt(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function toBoolean(value: string | null): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return undefined;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const query: MarginLedgerQueryInput = {
      margin_object_id: params.get("margin_object_id") || undefined,
      candidate_id: params.get("candidate_id") || undefined,
      candidate_name: params.get("candidate_name") || undefined,
      margin_id: params.get("margin_id") || undefined,
      job_id: params.get("job_id") || undefined,
      facility_name: params.get("facility_name") || undefined,
      profession: params.get("profession") || undefined,
      specialty: params.get("specialty") || undefined,
      event_id: params.get("event_id") || undefined,
      source_kind: params.get("source_kind") || undefined,
      view_type: params.get("view_type") || undefined,
      include_provenance: toBoolean(params.get("include_provenance")),
      limit: toInt(params.get("limit")),
      event_limit: toInt(params.get("event_limit")),
    };

    const result = await queryMarginLedger(query);
    return Response.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to query margin ledger";
    console.error("Margin ledger query failed:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}

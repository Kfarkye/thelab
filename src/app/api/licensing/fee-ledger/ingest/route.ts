import { NextRequest } from "next/server";
import {
  FEE_TYPE_ENUM,
  ingestFeeLedgerCapture,
  type FeeCaptureIngestInput,
} from "@/lib/licensing/fee-ledger";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as FeeCaptureIngestInput;
    if (!body || !Array.isArray(body.rows) || body.rows.length === 0) {
      return Response.json(
        { error: "rows is required and must include at least one row" },
        { status: 400 },
      );
    }

    const result = await ingestFeeLedgerCapture(body);
    return Response.json({
      ok: true,
      result,
      fee_type_enum: [...FEE_TYPE_ENUM],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to ingest fee ledger capture";
    const status = /Invalid row|must be one of|rows is required|captured_at must/i.test(message)
      ? 400
      : 500;
    console.error("Fee ledger ingest failed:", error);
    return Response.json({ error: message }, { status });
  }
}

import { NextRequest } from "next/server";
import {
  SHIFT_TYPE_ENUM,
  ingestMarginLedgerCapture,
  type MarginCaptureIngestInput,
} from "@/lib/ayaops/margin-ledger";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as MarginCaptureIngestInput;
    if (!body || !Array.isArray(body.rows) || body.rows.length === 0) {
      return Response.json(
        { error: "rows is required and must include at least one row" },
        { status: 400 },
      );
    }

    const result = await ingestMarginLedgerCapture(body);
    return Response.json({
      ok: true,
      result,
      shift_type_enum: [...SHIFT_TYPE_ENUM],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to ingest margin ledger capture";
    const status = /rows is required|captured_at must/i.test(message) ? 400 : 500;
    console.error("Margin ledger ingest failed:", error);
    return Response.json({ error: message }, { status });
  }
}

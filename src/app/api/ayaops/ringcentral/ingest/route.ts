import { NextRequest } from "next/server";
import {
  ingestRingCentralThreadCapture,
  type RingCentralThreadIngestInput,
} from "@/lib/ayaops/ringcentral-ledger";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RingCentralThreadIngestInput;
    if (!body || typeof body !== "object") {
      return Response.json(
        { error: "A RingCentral thread payload object is required" },
        { status: 400 },
      );
    }

    const result = await ingestRingCentralThreadCapture(body);
    return Response.json({ ok: true, result });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to ingest RingCentral thread payload";
    const status = /captured_at must/i.test(message) ? 400 : 500;
    console.error("RingCentral ingest failed:", error);
    return Response.json({ error: message }, { status });
  }
}

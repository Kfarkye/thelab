import { NextRequest, NextResponse } from "next/server";
import { attachCandidateToJob } from "@/lib/ayaops/margin-ledger";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await attachCandidateToJob(body);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("not found") ? 404
      : message.includes("already a margin") ? 409
      : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

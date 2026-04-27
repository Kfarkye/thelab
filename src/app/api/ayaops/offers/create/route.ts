import { NextRequest, NextResponse } from "next/server";
import { attachCandidateToJob } from "@/lib/ayaops/margin-ledger";
import { requireAuth } from "@/lib/middleware/auth";

export async function POST(request: NextRequest) {
  try {
    const { response } = await requireAuth(request);
    if (response) return response;

    const body = await request.json();
    const result = await attachCandidateToJob(body);
    return NextResponse.json({
      ok: true,
      offer: {
        status: result.offer_status,
        candidate_id: result.candidate_id,
        candidate_name: result.candidate_name,
        selected_pay_package_id: result.selected_pay_package_id,
      },
      margin_approval: {
        margin_object_id: result.margin_object_id,
        record_phase: result.record_phase,
      },
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("not found") ? 404
      : message.includes("already a margin") ? 409
      : message.includes("already has an offer") ? 409
      : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

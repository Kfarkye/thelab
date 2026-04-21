import { NextRequest } from "next/server";
import {
  approveHealthcareResearchSnapshot,
  type HealthcareResearchApprovalInput,
} from "@/lib/licensing/research-ledger";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as HealthcareResearchApprovalInput;
    const result = await approveHealthcareResearchSnapshot(body || {});
    return Response.json({ ok: true, result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to approve healthcare research snapshot";
    const status = /required|valid US state|profession token|approved_at/i.test(message) ? 400 : 500;
    console.error("Healthcare research approval failed:", error);
    return Response.json({ error: message }, { status });
  }
}

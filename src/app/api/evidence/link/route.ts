import { NextRequest } from "next/server";
import { linkSavedImageCandidate } from "@/lib/evidence/store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { imageId?: string; candidateId?: string };
    if (!body.imageId || !body.candidateId) {
      return Response.json({ error: "imageId and candidateId are required" }, { status: 400 });
    }

    await linkSavedImageCandidate(body.imageId, body.candidateId);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to link candidate";
    console.error("Evidence link update failed:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}

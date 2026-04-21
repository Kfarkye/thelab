import { NextRequest } from "next/server";
import { listSavedImages } from "@/lib/evidence/store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const limitParam = Number(params.get("limit") || "10");
    const limit = Number.isFinite(limitParam) ? limitParam : 10;
    const mode = params.get("mode");
    const candidateId = params.get("candidateId");
    const conversationId = params.get("conversationId");

    const images = await listSavedImages({
      limit,
      mode: mode || null,
      candidateId: candidateId || null,
      conversationId: conversationId || null,
    });

    return Response.json({ images });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load images";
    console.error("Evidence recent fetch failed:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}

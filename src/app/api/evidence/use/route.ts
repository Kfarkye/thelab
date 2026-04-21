import { NextRequest } from "next/server";
import { markSavedImageUsed } from "@/lib/evidence/store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { imageId?: string };
    if (!body.imageId) {
      return Response.json({ error: "imageId is required" }, { status: 400 });
    }

    await markSavedImageUsed(body.imageId);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to mark image as used";
    console.error("Evidence use update failed:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}

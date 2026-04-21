import { NextRequest } from "next/server";
import { setSavedImagePin } from "@/lib/evidence/store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { imageId?: string; isPinned?: boolean };
    if (!body.imageId) {
      return Response.json({ error: "imageId is required" }, { status: 400 });
    }

    await setSavedImagePin(body.imageId, Boolean(body.isPinned));
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update pin";
    console.error("Evidence pin update failed:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}

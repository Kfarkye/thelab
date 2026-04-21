import { NextRequest } from "next/server";
import { getSavedImageContent } from "@/lib/evidence/store";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const { bytes, mimeType } = await getSavedImageContent(id);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load image";
    return Response.json({ error: message }, { status: 404 });
  }
}

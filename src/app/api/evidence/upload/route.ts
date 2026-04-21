import { NextRequest } from "next/server";
import { saveEvidenceImage } from "@/lib/evidence/store";

export const runtime = "nodejs";

interface UploadRequestBody {
  imageDataUrl?: string;
  candidateId?: string | null;
  sourceType?: string;
  screenType?: string | null;
  mode?: string | null;
  uploadedBy?: string | null;
  conversationId?: string | null;
  tags?: string[];
  isPinned?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as UploadRequestBody;
    if (!body.imageDataUrl) {
      return Response.json({ error: "imageDataUrl is required" }, { status: 400 });
    }

    const image = await saveEvidenceImage({
      imageDataUrl: body.imageDataUrl,
      candidateId: body.candidateId || null,
      sourceType: body.sourceType || "nova",
      screenType: body.screenType || null,
      mode: body.mode || null,
      uploadedBy: body.uploadedBy || null,
      conversationId: body.conversationId || null,
      tags: body.tags || [],
      isPinned: Boolean(body.isPinned),
    });

    return Response.json({ image });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    console.error("Evidence upload failed:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}

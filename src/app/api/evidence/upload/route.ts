import { NextRequest } from "next/server";
import { saveEvidenceImage } from "@/lib/evidence/store";
import { extractImageText, saveScreenshotExtraction, suggestCandidateFromText } from "@/lib/evidence/vision";

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

    let suggestions = null;

    try {
      const match = body.imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (match) {
        const bytes = Buffer.from(match[2], "base64");
        const extraction = await extractImageText(bytes);
        
        if (extraction) {
          if (!image.candidateId) {
            const suggestionCheck = await suggestCandidateFromText(extraction.fullText);
            suggestions = suggestionCheck.suggestion;
            await saveScreenshotExtraction(
              image.imageId,
              body.uploadedBy || "system",
              image.storagePath,
              extraction,
              'success',
              null,
              suggestionCheck.status,
              suggestionCheck.suggestion
            );
          } else {
            await saveScreenshotExtraction(
              image.imageId,
              body.uploadedBy || "system",
              image.storagePath,
              extraction,
              'success',
              null,
              'pre_linked',
              null
            );
          }
        } else {
          await saveScreenshotExtraction(
            image.imageId,
            body.uploadedBy || "system",
            image.storagePath,
            null,
            'failed',
            'No extraction result returned',
            'none',
            null
          );
        }
      }
    } catch (visionError) {
      console.error("[Vision API] Failed to extract text from screenshot:", visionError);
      try {
        await saveScreenshotExtraction(
          image.imageId,
          body.uploadedBy || "system",
          image.storagePath,
          null,
          'failed',
          visionError instanceof Error ? visionError.message : String(visionError),
          'none',
          null
        );
      } catch (saveError) {
        console.error("[Vision API] Failed to log vision error to DB:", saveError);
      }
    }

    return Response.json({ image: { ...image, suggestions } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    console.error("Evidence upload failed:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}

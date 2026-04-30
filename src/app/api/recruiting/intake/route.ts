import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import {
  parseRecruiterInputParts,
  type RecruiterIntakeMode,
  type RecruiterInputPart,
} from "@/lib/recruiting/intake-service";

export const runtime = "nodejs";

function parseDataUrl(value: unknown): { mimeType: string; data: string } | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^data:([a-zA-Z0-9.+/-]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

function readMode(value: unknown): RecruiterIntakeMode {
  return value === "candidate" ? "candidate" : "package";
}

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await requireAuth(request);
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const mode = readMode(body.mode);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "";
    const inlineImage = parseDataUrl(body.imageDataUrl || body.image);
    const parts: RecruiterInputPart[] = [];

    if (text || sourceUrl) {
      parts.push({
        text: [sourceUrl ? `Source URL: ${sourceUrl}` : null, text ? `Input:\n${text}` : null]
          .filter(Boolean)
          .join("\n\n"),
      });
    }

    if (inlineImage) {
      parts.push({ inlineData: inlineImage });
    }

    if (parts.length === 0) {
      return NextResponse.json(
        { error: "Text, screenshot, or source URL is required." },
        { status: 400 },
      );
    }

    const preview = await parseRecruiterInputParts(parts, mode);
    return NextResponse.json({
      ok: true,
      mode,
      preview,
      save_required: true,
      saved: false,
    });
  } catch (error: unknown) {
    console.error("Recruiting intake parse failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to parse recruiter intake." },
      { status: 500 },
    );
  }
}

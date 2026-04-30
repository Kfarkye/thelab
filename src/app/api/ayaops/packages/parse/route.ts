import { NextRequest, NextResponse } from "next/server";
import { createVertexGenAI, GEMINI_FAST_MODEL } from "@/lib/ai/gemini-config";
import { requireAuth } from "@/lib/middleware/auth";
import { getEvidenceInlineData } from "@/lib/evidence/store";
import {
  normalizePackageParseResult,
  PACKAGE_PARSE_RESPONSE_SCHEMA,
  type PackageSourceType,
} from "@/lib/ayaops/package-intake";

export const runtime = "nodejs";

const ai = createVertexGenAI();

const MODEL = GEMINI_FAST_MODEL;

function parseDataUrl(value: unknown): { mimeType: string; data: string } | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

export async function POST(request: NextRequest) {
  const { response } = await requireAuth(request);
  if (response) return response;

  try {
    const body = await request.json();
    const sourceType = String(body.sourceType || body.source_type || "manual") as PackageSourceType;
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "";
    const imageRecordId =
      typeof body.imageRecordId === "string"
        ? body.imageRecordId
        : typeof body.image_record_id === "string"
          ? body.image_record_id
          : null;
    const imageDataUrl = parseDataUrl(body.imageDataUrl || body.image);
    const inlineImage = imageRecordId
      ? await getEvidenceInlineData(imageRecordId)
      : imageDataUrl;

    if (!text && !inlineImage && !sourceUrl) {
      return NextResponse.json(
        { error: "Package text, screenshot, or URL is required." },
        { status: 400 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts: any[] = [
      {
        text:
          "Extract a healthcare pay package from the provided screenshot and/or pasted text. " +
          "Return strict JSON only. This is read-only extraction for human review, not a save action. " +
          "Use ISO dates (YYYY-MM-DD), HH:mm 24-hour times, numeric money values without symbols, and null-like blanks as missing fields. " +
          "Do not invent facility location, requirements, job description, or pay values when not visible. " +
          "If the image is a margin approval, still extract only the underlying package fields unless a field is explicitly about job context. " +
          `Source type: ${sourceType}.` +
          (sourceUrl ? `\n\nSource URL:\n${sourceUrl}` : "") +
          (text ? `\n\nPasted text:\n${text}` : ""),
      },
    ];

    if (inlineImage) {
      parts.push({ inlineData: inlineImage });
    }

    const start = performance.now();
    const geminiResponse = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction:
          "You are a precise healthcare staffing pay package parser. You do not write data. " +
          "Your output feeds a human preview before saving, so mark uncertain or absent values as missing.",
        responseMimeType: "application/json",
        responseSchema: PACKAGE_PARSE_RESPONSE_SCHEMA,
        temperature: 0.1,
      },
    });

    const raw = geminiResponse.text || "{}";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }

    return NextResponse.json({
      ok: true,
      result: normalizePackageParseResult(parsed),
      raw,
      durationMs: Math.round(performance.now() - start),
    });
  } catch (error) {
    console.error("Package parse error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to parse package." },
      { status: 500 },
    );
  }
}

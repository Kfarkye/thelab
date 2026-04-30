import { NextRequest } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import { createVertexGenAI, GEMINI_FAST_MODEL } from "@/lib/ai/gemini-config";
import { getEvidenceInlineData, markSavedImageUsed } from "@/lib/evidence/store";

export const runtime = "nodejs";

const ai: GoogleGenAI = createVertexGenAI();

function parseCredentialJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const imageId = body.imageId;
    if (!imageId) return Response.json({ error: "imageId is required" }, { status: 400 });

    const evidence = await getEvidenceInlineData(imageId);

    const prompt = "Analyze this healthcare credential. Extract visible credential facts only. Use null for missing values.";

    const result = await ai.models.generateContent({
      model: GEMINI_FAST_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: evidence.mimeType,
                data: evidence.data,
              },
            },
          ],
        },
      ],
      config: {
        systemInstruction:
          "You are a precise healthcare credential parser. Return strict JSON only and do not invent values.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            type: { type: Type.STRING, nullable: true },
            provider_name: { type: Type.STRING, nullable: true },
            credential_number: { type: Type.STRING, nullable: true },
            state: { type: Type.STRING, nullable: true },
            issue_date: { type: Type.STRING, nullable: true },
            expiration_date: { type: Type.STRING, nullable: true },
            valid: { type: Type.BOOLEAN, nullable: true },
          },
          required: ["type", "provider_name", "credential_number", "state", "issue_date", "expiration_date", "valid"],
        },
        temperature: 0.1,
      },
    });

    const extracted = parseCredentialJson(result.text || "{}");

    await markSavedImageUsed(imageId);

    return Response.json({ status: "ok", imageId, extracted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error processing credential";
    console.error("Credential Processing Error:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}

import { randomUUID } from "node:crypto";
import { Spanner } from "@google-cloud/spanner";
import { Type } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/spanner-pool";
import { createVertexGenAI, GEMINI_PRO_MODEL, GEMINI_THINKING_HIGH } from "@/lib/ai/gemini-config";
import { requireAuth } from "@/lib/middleware/auth";
import {
  evaluateArtifactGovernance,
  MAX_ARTIFACT_CODE_SIZE,
  MAX_ARTIFACT_PREVIEW_SIZE,
  parseArtifactIntent,
  validateArtifactDestination,
} from "@/lib/artifacts/governance";

export const runtime = "nodejs";

const ai = createVertexGenAI();

type ArtifactGeneration = {
  code: string;
  preview_html: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readGeneratedArtifact(value: unknown): ArtifactGeneration {
  const data = isRecord(value) ? value : {};
  const code = typeof data.code === "string" ? data.code : "";
  const previewHtml = typeof data.preview_html === "string" ? data.preview_html : "";
  if (!code || !previewHtml) throw new Error("INVALID_GENERATION");
  return { code, preview_html: previewHtml };
}

function jsonError(code: string, status: number): Response {
  return NextResponse.json({ error: { code } }, { status });
}

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth.response) return auth.response;

  let intent: ReturnType<typeof parseArtifactIntent>;
  try {
    const body = await req.json();
    intent = parseArtifactIntent(isRecord(body) ? body.intent : null);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "INVALID_REQUEST", 400);
  }

  try {
    const artifactId = randomUUID();
    const rawDestination = intent.destination_hint || `src/components/generated/${artifactId}.tsx`;
    let proposedDestination = `src/components/generated/${artifactId}.tsx`;
    try {
      proposedDestination = validateArtifactDestination(rawDestination);
    } catch {
      proposedDestination = `src/components/generated/${artifactId}.tsx`;
    }

    const result = await ai.models.generateContent({
      model: GEMINI_PRO_MODEL,
      contents: [{ role: "user", parts: [{ text: intent.description }] }],
      config: {
        tools: [{ googleSearch: {} }],
        thinkingConfig: GEMINI_THINKING_HIGH,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            code: { type: Type.STRING },
            preview_html: { type: Type.STRING },
          },
          required: ["code", "preview_html"],
        },
        systemInstruction: [
          "Generate the requested artifact as strict JSON.",
          "Use real Google Search grounding for factual claims.",
          "Do not create fake search endpoints or client-side fetches.",
          "Use plain recruiter-to-recruiter language.",
          "Avoid banned product words: maximize, optimize, leverage, streamline, seamlessly, harness, innovative.",
          "Consumer surfaces must be light mode with serif headlines and sans body.",
          "No generated images, data URIs, CSS art, placeholders, dark mode, or infrastructure copy.",
        ].join(" "),
      },
    });

    const generated = readGeneratedArtifact(JSON.parse(result.text || "{}"));
    if (generated.code.length > MAX_ARTIFACT_CODE_SIZE) return jsonError("ARTIFACT_CODE_TOO_LARGE", 413);
    if (generated.preview_html.length > MAX_ARTIFACT_PREVIEW_SIZE) return jsonError("ARTIFACT_PREVIEW_TOO_LARGE", 413);

    const violations = evaluateArtifactGovernance({
      code: generated.code,
      html: generated.preview_html,
      proposedDestination,
    });

    const actorId = auth.user.email || auth.user.uid;
    const db = getDb("recruitingdb");
    await db.table("ephemeral_artifacts").insert({
      artifact_id: artifactId,
      actor_id: actorId,
      intent_json: JSON.stringify(intent),
      generated_code: generated.code,
      preview_html: generated.preview_html,
      raw_destination: rawDestination,
      proposed_destination: proposedDestination,
      status: "pending",
      violations_json: JSON.stringify(violations),
      created_at: Spanner.COMMIT_TIMESTAMP,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    return NextResponse.json({
      artifact_id: artifactId,
      preview_html: generated.preview_html,
      violations,
      proposed_destination: proposedDestination,
    });
  } catch (error) {
    console.error(JSON.stringify({
      severity: "ERROR",
      component: "artifact_generation",
      event: "generation_failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    return jsonError("ARTIFACT_GENERATION_FAILED", 500);
  }
}

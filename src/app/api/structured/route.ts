import { NextRequest } from "next/server";
import { createVertexGenAI, GEMINI_FAST_MODEL } from "@/lib/ai/gemini-config";

const MODEL = GEMINI_FAST_MODEL;

const ai = createVertexGenAI();

/**
 * POST /api/structured
 * 
 * Controlled Generation — forces Gemini to return valid JSON matching a schema.
 * 
 * Body: {
 *   prompt: string,
 *   schema?: object,        // JSON Schema to enforce
 *   image?: string,         // base64 data URL (optional)
 *   mode?: string,          // healthcare | sports | code
 * }
 * 
 * Returns: { result: <parsed JSON>, raw: <raw string>, durationMs: number }
 */
export async function POST(request: NextRequest) {
  try {
    const { prompt, schema, image, mode } = await request.json();

    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "prompt is required" }), { status: 400 });
    }

    const start = performance.now();
    const hasImage = image && typeof image === "string";
    const activeMode = mode || "code";

    // Build contents
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts: any[] = [{ text: prompt }];
    
    if (hasImage) {
      const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
      }
    }

    // Default schema if none provided — generic key-value extraction
    const responseSchema = schema || {
      type: "object",
      properties: {
        summary: { type: "string", description: "Brief summary of the analysis" },
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "string" },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["label", "value"],
          },
        },
        recommendation: { type: "string", description: "Actionable next step" },
      },
      required: ["summary", "findings"],
    };

    const STRUCTURED_PROMPTS: Record<string, string> = {
      healthcare: "You are a healthcare data extraction specialist. Extract structured information from the user's query or image. Be precise about dates, IDs, and regulatory details.",
      sports: "You are a sports data extraction specialist. Extract structured information about games, players, odds, and statistics from the user's query or image.",
      code: "You are a code analysis specialist. Extract structured information about bugs, architecture decisions, dependencies, and implementation details from the user's query or image.",
    };

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: STRUCTURED_PROMPTS[activeMode] || STRUCTURED_PROMPTS.code,
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0.2, // Lower temp for more deterministic JSON
      },
    });

    const raw = response.text || "{}";
    const durationMs = Math.round(performance.now() - start);

    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      result = { _raw: raw, _parseError: true };
    }

    return new Response(
      JSON.stringify({ result, raw, durationMs }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Structured API error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500 }
    );
  }
}

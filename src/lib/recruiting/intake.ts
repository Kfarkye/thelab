import type { GoogleGenAI, Schema as GenAiSchema } from "@google/genai";
import { createVertexGenAI, GEMINI_FAST_MODEL, GEMINI_THINKING_MINIMAL } from "@/lib/ai/gemini-config";

const MODEL = GEMINI_FAST_MODEL;

export interface ParsedIntake {
  searchQuery: string;
  reasoning: string;
}

type GenerateContentResult = Awaited<ReturnType<GoogleGenAI["models"]["generateContent"]>>;

type JsonSchema = {
  type: "OBJECT" | "STRING";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

let aiClient: GoogleGenAI | null = null;

async function getAiClient(): Promise<GoogleGenAI> {
  if (!aiClient) {
    aiClient = createVertexGenAI();
  }
  return aiClient;
}

const parsedIntakeSchema = ({
  type: "OBJECT",
  properties: {
    searchQuery: {
      type: "STRING",
      description: "A compact Spanner full-text search query focused on specialty, skills, certs, and role language.",
    },
    reasoning: {
      type: "STRING",
      description: "Short factual explanation of what drove the query.",
    },
  },
  required: ["searchQuery", "reasoning"],
} satisfies JsonSchema) as unknown as GenAiSchema;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return {};
  }
}

export async function parseRecruiterNote(text: string): Promise<ParsedIntake> {
  const cleanText = text.trim();
  if (!cleanText) throw new Error("Recruiter note is required.");

  const ai = await getAiClient();
  const result: GenerateContentResult = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: cleanText }] }],
    config: {
      systemInstruction:
        "You are an Aya recruiter search parser. Turn messy notes into a precise Spanner search query. Focus on specialty, specific skills, credentials, and role language. Return JSON only.",
      responseMimeType: "application/json",
      responseSchema: parsedIntakeSchema,
      temperature: 0,
      thinkingConfig: GEMINI_THINKING_MINIMAL,
    },
  });

  const parsed = parseJsonObject(result.text || "{}");
  const searchQuery = readString(parsed.searchQuery);
  if (!searchQuery) throw new Error("AI intake did not return a search query.");

  return {
    searchQuery,
    reasoning: readString(parsed.reasoning),
  };
}

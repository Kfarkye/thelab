import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { requireEnv } from "@/lib/env";

export const GEMINI_PRO_MODEL = "gemini-3.1-pro-preview";
export const GEMINI_FAST_MODEL = "gemini-3.1-flash-lite-preview";

export const GEMINI_THINKING_HIGH = { thinkingLevel: ThinkingLevel.HIGH } as const;
export const GEMINI_THINKING_MINIMAL = { thinkingLevel: ThinkingLevel.MINIMAL } as const;

export function createVertexGenAI(location = requireEnv("GOOGLE_CLOUD_LOCATION")): GoogleGenAI {
  return new GoogleGenAI({
    vertexai: true,
    project: requireEnv("GOOGLE_CLOUD_PROJECT"),
    location,
  });
}

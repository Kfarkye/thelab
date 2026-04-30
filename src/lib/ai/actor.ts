import type { GenerateContentResponse } from "@google/genai";
import { createVertexGenAI, GEMINI_PRO_MODEL, GEMINI_THINKING_HIGH } from "@/lib/ai/gemini-config";
import { PatchSchema } from "./schemes";

const ai = createVertexGenAI();

export const getAiClient = () => ai;

export const executeCodingLogic = async (
  prompt: string,
  context: string,
): Promise<AsyncGenerator<GenerateContentResponse>> => {
  return ai.models.generateContentStream({
    model: GEMINI_PRO_MODEL,
    contents: [
      { role: 'user', parts: [{ text: `Context:\n${context}` }, { text: prompt }] }
    ],
    config: {
      systemInstruction: `You are a Senior Software Engineer. 
      Standards: Strict TypeScript, Spanner ^8.6.0, Next.js App Router.
      Tone: Technical, direct.`,
      thinkingConfig: GEMINI_THINKING_HIGH,
      temperature: 0.2,
      presencePenalty: 0.0
    }
  });
};

export const generateStructuredPatch = async (userPrompt: string, repoContext: string) => {
  return ai.models.generateContent({
    model: GEMINI_PRO_MODEL,
    contents: [{ role: 'user', parts: [{ text: `Repo:\n${repoContext}` }, { text: userPrompt }] }],
    config: {
      thinkingConfig: GEMINI_THINKING_HIGH,
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: PatchSchema,
    }
  });
};

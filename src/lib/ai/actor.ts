import { GoogleGenAI } from "@google/genai";
import { requireEnv } from "@/lib/env";
import { PatchSchema } from "./schemes";
const ai = new GoogleGenAI({
  vertexai: true,
  project: requireEnv("GOOGLE_CLOUD_PROJECT"),
  location: "us-central1",
});

export const getAiClient = () => ai;

export const executeCodingLogic = async (prompt: string, context: string): Promise<ReadableStream> => {
  const model = ai.models.get("gemini-3-deep-think");

  const result = await model.generateContentStream({
    contents: [
      { role: 'user', parts: [{ text: `Context:\n${context}` }, { text: prompt }] }
    ],
    config: {
      systemInstruction: `You are a Senior Software Engineer. 
      Standards: Strict TypeScript, Spanner ^8.6.0, Next.js App Router.
      Tone: Technical, direct.`,
      thinking: true, 
      thoughtBudget: 5000, 
      temperature: 0.2,
      presencePenalty: 0.0
    }
  });

  return result.stream;
};

export const generateStructuredPatch = async (userPrompt: string, repoContext: string) => {
  const model = ai.models.get("gemini-3-deep-think");

  return model.generateContent({
    contents: [{ role: 'user', parts: [{ text: `Repo:\n${repoContext}` }, { text: userPrompt }] }],
    config: {
      thinking: true,
      thoughtBudget: 5000,
      temperature: 0.2,
      // Rule: Structured Output per Ledger
      responseMimeType: "application/json",
      responseSchema: PatchSchema,
      // Rule: Real-time documentation grounding
      tools: [{ googleSearch: {} }] 
    }
  });
};

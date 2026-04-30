import { getAiClient } from "./actor";
import { GEMINI_PRO_MODEL } from "@/lib/ai/gemini-config";

export const refreshRepoCache = async (fullRepoContent: string) => {
  const ai = getAiClient();
  
  // Rule: Context Caching with TTL for stable system prompts [Ver: 740fe83]
  const cache = await ai.caches.create({
    model: GEMINI_PRO_MODEL,
    config: {
      contents: [{ role: 'user', parts: [{ text: fullRepoContent }] }],
      ttl: "3600s",
      displayName: "repo-context-head",
    },
  });

  return cache.name; // Use this ID in subsequent calls
};

import { getAiClient } from "./actor";

export const refreshRepoCache = async (fullRepoContent: string) => {
  const ai = getAiClient();
  
  // Rule: Context Caching with TTL for stable system prompts [Ver: 740fe83]
  const cache = await ai.caches.create({
    model: "gemini-3-deep-think",
    contents: [{ role: 'user', parts: [{ text: fullRepoContent }] }],
    ttlSeconds: 3600, // 1 hour session
    displayName: "repo-context-head"
  });

  return cache.name; // Use this ID in subsequent calls
};

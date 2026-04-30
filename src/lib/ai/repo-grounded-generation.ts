import { getGoogleGenAI } from "@/lib/ai/google-genai";
import { GEMINI_FAST_MODEL } from "@/lib/ai/gemini-config";
import { requireEnv } from "@/lib/env";

function repoDatastoreResourceName(): string {
  const value = requireEnv("VERTEX_SEARCH_DATASTORE_ID").trim();
  if (value.startsWith("projects/")) return value;

  return [
    "projects",
    requireEnv("GCP_PROJECT_ID"),
    "locations",
    requireEnv("GOOGLE_CLOUD_LOCATION"),
    "collections",
    "default_collection",
    "dataStores",
    value,
  ].join("/");
}

export async function* streamRepoGroundedContent(prompt: string): AsyncGenerator<string> {
  const response = await getGoogleGenAI().models.generateContentStream({
    model: GEMINI_FAST_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      tools: [
        {
          retrieval: {
            vertexAiSearch: {
              datastore: repoDatastoreResourceName(),
            },
          },
        },
      ],
      systemInstruction: [
        "Answer from the indexed repository content.",
        "If the repository content does not contain the answer, say that plainly.",
        "Prefer file paths, rule IDs, and short implementation details.",
      ].join(" "),
    },
  });

  for await (const chunk of response) {
    const text = chunk.text;
    if (text) yield text;
  }
}

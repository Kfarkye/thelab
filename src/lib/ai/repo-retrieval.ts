import { getGeminiModelName, getGoogleGenAI } from "@/lib/ai/google-genai";
import { GEMINI_FAST_MODEL } from "@/lib/ai/gemini-config";
import { requireEnv } from "@/lib/env";

export type RepoGroundedCitation = {
  title: string | null;
  uri: string | null;
};

export type RepoGroundedResponse = {
  text: string;
  citations: RepoGroundedCitation[];
  grounded: boolean;
};

type JsonRecord = Record<string, unknown>;

function readText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function repoDatastoreResourceName(): string {
  const value = (process.env.VERTEX_AI_REPO_DATASTORE_PATH || process.env.VERTEX_SEARCH_DATASTORE_ID || "").trim();
  if (!value) return requireEnv("VERTEX_AI_REPO_DATASTORE_PATH");
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

function extractCitations(chunks: unknown[]): RepoGroundedCitation[] {
  const citations: RepoGroundedCitation[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const record = asRecord(chunk);
    const retrievedContext = asRecord(record?.retrievedContext);
    const document = asRecord(record?.document);
    const source = retrievedContext ?? document ?? record;
    const title = readText(source?.title) ?? readText(source?.name);
    const uri = readText(source?.uri) ?? readText(source?.url) ?? readText(source?.sourceUri);
    const key = `${title ?? ""}:${uri ?? ""}`;

    if ((!title && !uri) || seen.has(key)) continue;
    seen.add(key);
    citations.push({ title, uri });
  }

  return citations;
}

export async function queryRepoKnowledge(prompt: string): Promise<RepoGroundedResponse> {
  const cleanPrompt = readText(prompt);
  if (!cleanPrompt) {
    throw new Error("Missing repo knowledge prompt.");
  }

  const ai = getGoogleGenAI();
  const model = getGeminiModelName("GEMINI_REPO_MODEL", GEMINI_FAST_MODEL);
  const datastore = repoDatastoreResourceName();

  try {
    const response = await ai.models.generateContent({
      model,
      contents: cleanPrompt,
      config: {
        systemInstruction: [
          "You answer questions about this repo using the repo retrieval index.",
          "Use retrieved repo context when available.",
          "If the answer is not supported by retrieved repo context, say: I don't know from the repo index.",
          "Do not guess file paths, model IDs, or policy rules.",
        ].join("\n"),
        tools: [
          {
            retrieval: {
              vertexAiSearch: {
                datastore,
              },
            },
          },
        ],
      },
    });

    const candidate = response.candidates?.[0];
    const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
    const citations = extractCitations(chunks);

    return {
      text: response.text ?? "No response generated.",
      citations,
      grounded: citations.length > 0,
    };
  } catch (error) {
    console.error(JSON.stringify({
      severity: "ERROR",
      operation: "query_repo_knowledge",
      message: "Failed to generate repo-grounded content",
      error: error instanceof Error ? error.message : String(error),
    }));
    throw new Error("Failed to query repo knowledge.");
  }
}

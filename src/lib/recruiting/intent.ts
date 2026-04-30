import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import { VERTEX_AI_AYAOPS_URL_DATASTORE } from "@/lib/env";
import { createVertexGenAI, GEMINI_FAST_MODEL, GEMINI_THINKING_MINIMAL } from "@/lib/ai/gemini-config";

const LOCATION_HINTS = /\b(near|around|within|local|by|in|close to|los angeles|la|sacramento|san francisco|sf|bay area|the bay|california|ca)\b/i;
const RADIUS_PATTERN = /\bwithin\s+(\d{1,4})\s+miles?\b/i;

export const recruiterIntentSchema = z.object({
  intent: z.literal("candidate_search"),
  profession: z.string().trim().min(1).nullable(),
  specialty: z.string().trim().min(1).nullable(),
  license_state: z.string().trim().min(1).nullable(),
  status: z.string().trim().min(1).nullable(),
  location_text: z.string().trim().min(1).nullable(),
  radius_miles: z.number().int().positive().max(500).nullable(),
  limit: z.number().int().positive().max(50).default(10),
  requires_location: z.boolean(),
  raw_query: z.string().trim().min(1),
});

export type RecruiterIntent = z.infer<typeof recruiterIntentSchema>;

type IntentSeed = {
  profession: string | null;
  specialty: string | null;
  license_state: string | null;
  status: string | null;
  location_text: string | null;
  radius_miles: number | null;
  requires_location: boolean;
};

let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    aiClient = createVertexGenAI();
  }
  return aiClient;
}

function clampLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(Math.trunc(value), 50));
}

function parseRadius(input: string): number | null {
  const match = input.match(RADIUS_PATTERN);
  if (!match) return null;
  const radius = Number(match[1]);
  return Number.isFinite(radius) ? Math.max(1, Math.min(Math.trunc(radius), 500)) : null;
}

function inferSeed(input: string): IntentSeed {
  const lower = input.toLowerCase();
  const seed: IntentSeed = {
    profession: null,
    specialty: null,
    license_state: null,
    status: null,
    location_text: null,
    radius_miles: parseRadius(input),
    requires_location: LOCATION_HINTS.test(input),
  };

  if (/\bmed[\s-]?surg\b/.test(lower)) {
    seed.profession = "RN";
    seed.specialty = "MS RN";
  } else if (/\brns?\b|\bnurses?\b|\bregistered nurses?\b/.test(lower)) {
    seed.profession = "RN";
    seed.specialty = "RN";
  } else if (/\brespiratory\b|\brt\b|\brrt\b/.test(lower)) {
    seed.profession = "RESP";
    seed.specialty = "Respiratory Therapy";
  } else if (/\bdietit(?:ian|ians|an)\b|\bdietic?ians?\b|\bdiet\b/.test(lower)) {
    seed.profession = "Dietitian";
    seed.specialty = "Dietitian";
  } else if (/\bphysical therapist\b|\bpt\b/.test(lower)) {
    seed.profession = "PT";
    seed.specialty = "PT";
  } else if (/\boccupational therapist\b|\bot\b/.test(lower)) {
    seed.profession = "OT";
    seed.specialty = "OT";
  }

  if (/\bactive\b/.test(lower)) seed.status = "ACTIVE";

  if (/\bsacramento\b/.test(lower)) seed.location_text = "Sacramento";
  else if (/\bsan francisco\b|\bsf\b/.test(lower)) seed.location_text = "San Francisco";
  else if (/\bbay area\b|\bthe bay\b|\bbay\b/.test(lower)) seed.location_text = "Bay Area";
  else if (/\blos angeles\b|\bla\b/.test(lower)) seed.location_text = "Los Angeles";
  else if (/\bcalifornia\b|\bca\b/.test(lower)) {
    seed.location_text = "California";
    seed.license_state = "CA";
  }

  return seed;
}

function normalizeParsed(value: unknown, input: string): RecruiterIntent {
  const seed = inferSeed(input);
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  const candidate = {
    intent: "candidate_search",
    profession: typeof raw.profession === "string" && raw.profession.trim() ? raw.profession.trim() : seed.profession,
    specialty: typeof raw.specialty === "string" && raw.specialty.trim() ? raw.specialty.trim() : seed.specialty,
    license_state: typeof raw.license_state === "string" && raw.license_state.trim() ? raw.license_state.trim().toUpperCase() : seed.license_state,
    status: typeof raw.status === "string" && raw.status.trim() ? raw.status.trim().toUpperCase() : seed.status,
    location_text: typeof raw.location_text === "string" && raw.location_text.trim() ? raw.location_text.trim() : seed.location_text,
    radius_miles: typeof raw.radius_miles === "number" && Number.isFinite(raw.radius_miles) ? Math.trunc(raw.radius_miles) : seed.radius_miles,
    limit: clampLimit(raw.limit),
    requires_location: typeof raw.requires_location === "boolean" ? raw.requires_location : seed.requires_location,
    raw_query: input,
  };

  if (!LOCATION_HINTS.test(input)) candidate.requires_location = false;
  return recruiterIntentSchema.parse(candidate);
}

function fallbackIntent(input: string): RecruiterIntent {
  return normalizeParsed({}, input);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("INTENT_PARSE_TIMEOUT")), timeoutMs);
    }),
  ]);
}

export async function parseRecruiterIntent(input: string): Promise<RecruiterIntent> {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("INPUT_REQUIRED");

  try {
    const response = await withTimeout(getAiClient().models.generateContent({
      model: GEMINI_FAST_MODEL,
      contents: [{ role: "user", parts: [{ text: trimmed }] }],
      config: {
        tools: [
          {
            retrieval: {
              vertexAiSearch: {
                datastore: VERTEX_AI_AYAOPS_URL_DATASTORE,
              },
            },
          },
        ],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            intent: { type: Type.STRING },
            profession: { type: Type.STRING, nullable: true },
            specialty: { type: Type.STRING, nullable: true },
            license_state: { type: Type.STRING, nullable: true },
            status: { type: Type.STRING, nullable: true },
            location_text: { type: Type.STRING, nullable: true },
            radius_miles: { type: Type.INTEGER, nullable: true },
            limit: { type: Type.INTEGER },
            requires_location: { type: Type.BOOLEAN },
            raw_query: { type: Type.STRING },
          },
          required: ["intent", "limit", "requires_location", "raw_query"],
        },
        systemInstruction: [
          "Parse recruiter candidate-search requests into JSON only.",
          "Use Vertex grounding context for candidate terminology and location phrasing.",
          "Do not ask clarifying questions.",
          "Use best-effort values and null for unknown fields.",
          "Set intent to candidate_search.",
          "Default limit to 10.",
          "Set requires_location only when the text asks for near, around, within, local, by, or names a specific city or region.",
        ].join(" "),
        thinkingConfig: GEMINI_THINKING_MINIMAL,
      },
    }), 1200);

    const text = response.text || "{}";
    return normalizeParsed(JSON.parse(text), trimmed);
  } catch (error) {
    console.warn(JSON.stringify({
      severity: "WARNING",
      component: "recruiting_intent",
      event: "intent_parse_fallback",
      error: error instanceof Error ? error.message : String(error),
    }));
    return fallbackIntent(trimmed);
  }
}

import {
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  Type,
  type Schema,
} from "@google/genai";
import { createVertexGenAI, GEMINI_FAST_MODEL } from "@/lib/ai/gemini-config";
import { normalizeSpecialty } from "@/lib/recruiting/engine";
import type { CandidateObject, PackageObject } from "@/lib/recruiting/types";

export type RecruiterIntakeMode = "package" | "candidate";

export type RecruiterInlineData = {
  mimeType: string;
  data: string;
};

export type RecruiterInputPart =
  | { text: string }
  | { inlineData: RecruiterInlineData };

const MODEL = GEMINI_FAST_MODEL;

let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    aiClient = createVertexGenAI();
  }
  return aiClient;
}

const nullableString = (description?: string): Schema => ({
  type: Type.STRING,
  nullable: true,
  ...(description ? { description } : {}),
});

const nullableNumber = (description?: string): Schema => ({
  type: Type.NUMBER,
  nullable: true,
  ...(description ? { description } : {}),
});

const stringArray = (description?: string): Schema => ({
  type: Type.ARRAY,
  items: { type: Type.STRING },
  ...(description ? { description } : {}),
});

const packageSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    package_id: nullableString("Canonical AYA.PKG ID if visible, otherwise null."),
    record_phase: {
      type: Type.STRING,
      enum: ["unattached", "candidate_attached", "margin_created"],
      nullable: true,
    },
    facility: nullableString("Facility name exactly as shown."),
    specialty: nullableString("Recruiter specialty or role label exactly as shown."),
    normalized_specialty: nullableString("Canonical specialty if obvious."),
    location: {
      type: Type.OBJECT,
      properties: {
        city: nullableString(),
        state: nullableString("Two-letter state code when visible."),
        zip: nullableString(),
        lat: nullableNumber(),
        lng: nullableNumber(),
      },
      required: ["city", "state", "zip", "lat", "lng"],
    },
    pay_range: {
      type: Type.OBJECT,
      properties: {
        min: nullableNumber(),
        max: nullableNumber(),
      },
      required: ["min", "max"],
    },
    weekly_gross: nullableNumber("Weekly gross pay as a number without currency symbols."),
    shift: nullableString("Shift label or window."),
    start_date: nullableString("ISO 8601 date, YYYY-MM-DD."),
    duration_weeks: nullableNumber("Assignment duration in weeks."),
    job_description: nullableString(),
    requirements: stringArray("Credential, license, experience, and facility requirements."),
    flags: stringArray("Review flags, missing fields, or risk markers."),
  },
  required: [
    "package_id",
    "record_phase",
    "facility",
    "specialty",
    "normalized_specialty",
    "location",
    "pay_range",
    "weekly_gross",
    "shift",
    "start_date",
    "duration_weeks",
    "job_description",
    "requirements",
    "flags",
  ],
};

const candidateSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    candidate_id: nullableString("Canonical AYA.CAND ID if visible, otherwise null."),
    candidate_name: nullableString("Candidate full name."),
    nova_url: nullableString("Canonical Nova candidate URL if visible."),
    specialty: nullableString("Candidate specialty exactly as shown."),
    normalized_specialty: nullableString("Canonical specialty if obvious."),
    home_city: nullableString(),
    home_state: nullableString("Two-letter state code when visible."),
    home_lat: nullableNumber(),
    home_lng: nullableNumber(),
    license_states: stringArray("Two-letter licensed states."),
    available_date: nullableString("ISO 8601 date, YYYY-MM-DD."),
    bucket: {
      type: Type.STRING,
      enum: ["already_mine", "claimable", "protected", "excluded"],
      nullable: true,
    },
  },
  required: [
    "candidate_id",
    "candidate_name",
    "nova_url",
    "specialty",
    "normalized_specialty",
    "home_city",
    "home_state",
    "home_lat",
    "home_lng",
    "license_states",
    "available_date",
    "bucket",
  ],
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || /^(null|n\/a|na|none|--|pending)$/i.test(text)) return null;
  return text;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function normalizeDate(value: unknown): string | null {
  const text = readString(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return {};
  }
}

function normalizePackage(value: unknown): Partial<PackageObject> {
  const input = asRecord(value);
  const location = asRecord(input.location);
  const payRange = asRecord(input.pay_range);
  const specialty = readString(input.specialty);
  const normalizedSpecialty = readString(input.normalized_specialty) || (specialty ? normalizeSpecialty(specialty) : null);

  return {
    package_id: readString(input.package_id) || undefined,
    record_phase: ["unattached", "candidate_attached", "margin_created"].includes(String(input.record_phase))
      ? input.record_phase as PackageObject["record_phase"]
      : "unattached",
    facility: readString(input.facility),
    specialty,
    normalized_specialty: normalizedSpecialty,
    location: {
      city: readString(location.city),
      state: readString(location.state),
      zip: readString(location.zip),
      lat: readNumber(location.lat),
      lng: readNumber(location.lng),
    },
    pay_range: {
      min: readNumber(payRange.min),
      max: readNumber(payRange.max),
    },
    weekly_gross: readNumber(input.weekly_gross),
    shift: readString(input.shift),
    start_date: normalizeDate(input.start_date),
    duration_weeks: readNumber(input.duration_weeks),
    job_description: readString(input.job_description),
    requirements: readStringList(input.requirements),
    flags: readStringList(input.flags),
  };
}

function normalizeCandidate(value: unknown): Partial<CandidateObject> {
  const input = asRecord(value);
  const specialty = readString(input.specialty);
  const normalizedSpecialty = readString(input.normalized_specialty) || (specialty ? normalizeSpecialty(specialty) : null);
  const bucket = String(input.bucket || "claimable");

  return {
    candidate_id: readString(input.candidate_id) || undefined,
    candidate_name: readString(input.candidate_name) || "Unknown Candidate",
    nova_url: readString(input.nova_url) || "",
    specialty,
    normalized_specialty: normalizedSpecialty,
    home_city: readString(input.home_city),
    home_state: readString(input.home_state),
    home_lat: readNumber(input.home_lat),
    home_lng: readNumber(input.home_lng),
    license_states: readStringList(input.license_states).map((state) => state.toUpperCase()),
    available_date: normalizeDate(input.available_date),
    bucket: ["already_mine", "claimable", "protected", "excluded"].includes(bucket)
      ? bucket as CandidateObject["bucket"]
      : "claimable",
  };
}

export async function parseRecruiterInputParts(
  parts: RecruiterInputPart[],
  mode: RecruiterIntakeMode,
): Promise<Partial<PackageObject> | Partial<CandidateObject>> {
  const prompt = mode === "package"
    ? "Extract a healthcare pay package from this recruiter input. Preserve only visible facts."
    : "Extract a clinician candidate profile from this recruiter or Nova input. Preserve only visible facts.";

  const result = await getAiClient().models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `${prompt}\n` +
              "Return JSON that matches the schema. Use null for missing fields. Do not invent values.",
          },
          ...parts,
        ],
      },
    ],
    config: {
      systemInstruction:
        "You are a Recruiter Operations Parser. Output structured JSON only. No prose. Be factual.",
      responseMimeType: "application/json",
      responseSchema: mode === "package" ? packageSchema : candidateSchema,
      temperature: 0.1,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
      ],
    },
  });

  const parsed = parseJsonObject(result.text || "{}");
  return mode === "package" ? normalizePackage(parsed) : normalizeCandidate(parsed);
}

export async function parseRecruiterInput(
  content: string,
  mode: RecruiterIntakeMode,
): Promise<Partial<PackageObject> | Partial<CandidateObject>> {
  return parseRecruiterInputParts([{ text: content }], mode);
}

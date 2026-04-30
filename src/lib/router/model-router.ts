// ── Model Router ────────────────────────────────────────────────
// Decides which model handles each request based on task type.
//
// Routing rules (Auto mode):
//   Gemini Flash-Lite = speed-sensitive extraction, live grounding, and vision
//   Gemini Pro High   = AyaOps, code, and general reasoning
//
// Manual override: user picks exact model from the toggle.

// The 2 available Gemini lanes
export type ModelId = "flash" | "pro";

// Which provider family a model belongs to
export type ModelProvider = "gemini";

export const MODEL_META: Record<ModelId, { provider: ModelProvider; label: string }> = {
  flash:  { provider: "gemini", label: "Flash-Lite" },
  pro:    { provider: "gemini", label: "Pro High" },
};

export interface RouteDecision {
  model: ModelId;
  provider: ModelProvider;
  reason: string;
}

export interface RouteInput {
  mode: string;
  hasImage: boolean;
  hasInternalRecord: boolean;
}

// ── Auto routing ────────────────────────────────────────────────
export function routeRequest(input: RouteInput): RouteDecision {
  // Vision → Gemini Flash-Lite (multimodal native)
  if (input.hasImage) {
    return { model: "flash", provider: "gemini", reason: "vision_multimodal" };
  }

  // Live sports/world cup → Gemini Flash-Lite (needs Google Search grounding)
  if (input.mode === "sports" || input.mode === "worldcup") {
    return { model: "flash", provider: "gemini", reason: "live_search_grounding" };
  }

  // AyaOps (with or without internal record) → Gemini Pro High
  // Pro has better reasoning/tool adherence for recruiter workflows.
  // Must route here BEFORE the generic internal-record check.
  if (input.mode === "ayaops") {
    return { model: "pro", provider: "gemini", reason: "ayaops_db_tools" };
  }

  // Internal candidate record (non-ayaops) → Gemini Pro High
  if (input.hasInternalRecord) {
    return { model: "pro", provider: "gemini", reason: "internal_record_reasoning" };
  }

  // Healthcare general → Gemini Pro High
  if (input.mode === "healthcare") {
    return { model: "pro", provider: "gemini", reason: "healthcare_reasoning" };
  }

  // Code mode → Gemini Pro (reasoning-heavy code work)
  if (input.mode === "code") {
    return { model: "pro", provider: "gemini", reason: "code_reasoning" };
  }

  // Default → Gemini Pro High
  return { model: "pro", provider: "gemini", reason: "default_reasoning" };
}

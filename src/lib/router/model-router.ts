// ── Model Router ────────────────────────────────────────────────
// Decides which model handles each request based on task type.
//
// Routing rules (Auto mode):
//   Claude Sonnet = default user-facing reasoning, synthesis, internal records
//   Gemini Flash  = live web search, grounding, code execution, vision
//
// Manual override: user picks exact model from the toggle.

// The 4 available models
export type ModelId = "sonnet" | "opus" | "flash" | "pro";

// Which provider family a model belongs to
export type ModelProvider = "claude" | "gemini";

export const MODEL_META: Record<ModelId, { provider: ModelProvider; label: string }> = {
  sonnet: { provider: "claude", label: "Sonnet" },
  opus:   { provider: "claude", label: "Opus" },
  flash:  { provider: "gemini", label: "Flash" },
  pro:    { provider: "gemini", label: "Pro" },
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
  // Vision → always Gemini Flash (multimodal native)
  if (input.hasImage) {
    return { model: "flash", provider: "gemini", reason: "vision_multimodal" };
  }

  // Live sports/world cup → Gemini Flash (needs Google Search grounding)
  if (input.mode === "sports" || input.mode === "worldcup") {
    return { model: "flash", provider: "gemini", reason: "live_search_grounding" };
  }

  // AyaOps (with or without internal record) → Gemini Pro
  // Pro has better tool adherence than Flash, and DB tools are Gemini-only.
  // Must route here BEFORE the generic internal-record check.
  if (input.mode === "ayaops") {
    return { model: "pro", provider: "gemini", reason: "ayaops_db_tools" };
  }

  // Internal candidate record (non-ayaops) → Claude Sonnet (pure reasoning, no search)
  if (input.hasInternalRecord) {
    return { model: "sonnet", provider: "claude", reason: "internal_record_reasoning" };
  }

  // Healthcare general → Claude Sonnet
  if (input.mode === "healthcare") {
    return { model: "sonnet", provider: "claude", reason: "healthcare_reasoning" };
  }

  // Code mode → Gemini Flash (code execution sandbox)
  if (input.mode === "code") {
    return { model: "flash", provider: "gemini", reason: "code_execution" };
  }

  // Default → Claude Sonnet
  return { model: "sonnet", provider: "claude", reason: "default_reasoning" };
}

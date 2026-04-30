export type ChatMode = "chat" | "grounded";

export interface RoutingResult {
  mode: ChatMode;
  backend?: "candidate_search" | "outreach" | "approvals";
  raw: string;
}

const GROUNDED_PATTERNS = {
  candidate_search: /^(find|show|search|who|any|need)\s+.+(rn|nurse|dietitian|pt|ot|rt|candidate|specialty|near|in|miles|available)/i,
  outreach: /^(draft|write|send|message|outreach)\s/i,
  approvals: /^(pending|approve|review|approval|what\s+needs)/i,
};

/**
 * Deterministic router to prevent model "decision fatigue".
 * Adheres to Ledger 740fe830 enterprise route standards.
 */
export function routeInput(input: string): RoutingResult {
  const trimmed = input.trim();

  if (GROUNDED_PATTERNS.candidate_search.test(trimmed)) {
    return { mode: "grounded", backend: "candidate_search", raw: trimmed };
  }
  if (GROUNDED_PATTERNS.outreach.test(trimmed)) {
    return { mode: "grounded", backend: "outreach", raw: trimmed };
  }
  if (GROUNDED_PATTERNS.approvals.test(trimmed)) {
    return { mode: "grounded", backend: "approvals", raw: trimmed };
  }

  return { mode: "chat", raw: trimmed };
}

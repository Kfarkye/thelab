// ── Grounded Write Interceptor ──────────────────────────────────
// Detects write intents from raw prompt text, resolves entities,
// and executes writes BEFORE the LLM runs. No tool calling needed.
// The LLM receives the result as grounded context and just narrates.

import { resolveCandidateIdentifier, type CandidateResolveResult } from "@/lib/ayaops/candidate-grounding-hub";
import { executeDbTool } from "@/lib/spanner/tools";

// ── Intent patterns ─────────────────────────────────────────────

const STATUS_ALIASES: Record<string, string> = {
  submitted: "in_pipeline",
  submit: "in_pipeline",
  pipeline: "in_pipeline",
  in_pipeline: "in_pipeline",
  active: "active",
  on_assignment: "active",
  working: "active",
  starting_soon: "pending_start",
  pending_start: "pending_start",
  completed: "completed",
  done: "completed",
  wrapped: "completed",
  cancelled: "cancelled",
  cancel: "cancelled",
};

// Extract candidate name from prompt — handles "move Anna to X", "update Anna Alfred's status", etc.
const MOVE_PATTERNS = [
  // "move Anna to submitted"
  /\b(?:move|change|update|set|put|transition|switch)\s+(.+?)\s+(?:to|as|into)\s+(\w+)\b/i,
  // "mark Anna as submitted"
  /\b(?:mark|flag)\s+(.+?)\s+(?:as|to)\s+(\w+)\b/i,
  // "submit Anna" / "cancel Anna"
  /\b(submit|cancel|complete|activate)\s+(.+?)(?:\s*$|\s*[.!?])/i,
];

// Note patterns: "add note for Anna: ..." / "note for Anna — ..."
const NOTE_PATTERNS = [
  /\b(?:add|create|save|write)\s+(?:a\s+)?note\s+(?:for|on|about|to)\s+(.+?)[\s:—–-]+(.+)/i,
  /\bnote\s+(?:for|on|about)\s+(.+?)[\s:—–-]+(.+)/i,
];

export type GroundedWriteResult = {
  intercepted: true;
  action: string;
  candidateName: string;
  candidateId: string;
  novaId: string | null;
  displayName: string;
  result: Record<string, unknown>;
  groundingText: string;
} | {
  intercepted: false;
};

/**
 * Try to detect and execute a write intent from the raw user prompt.
 * Returns { intercepted: true, ... } if a write was executed.
 * Returns { intercepted: false } if no write intent was detected.
 */
export async function interceptGroundedWrite(
  prompt: string,
  selectedCandidateId?: string | null,
): Promise<GroundedWriteResult> {
  const trimmed = (prompt || "").trim();
  if (!trimmed || trimmed.length > 500) return { intercepted: false };

  // ── Try status update patterns ────────────────────────────────
  for (const pattern of MOVE_PATTERNS) {
    const match = trimmed.match(pattern);
    if (!match) continue;

    let candidateRaw: string;
    let statusRaw: string;

    // Handle "submit Anna" pattern (verb-first)
    if (/^(submit|cancel|complete|activate)$/i.test(match[1])) {
      statusRaw = match[1];
      candidateRaw = match[2];
    } else {
      candidateRaw = match[1];
      statusRaw = match[2];
    }

    // Clean up candidate name
    candidateRaw = candidateRaw
      .replace(/['''`"]/g, "")
      .replace(/\b(status|assignment|to|the|a|an)\b/gi, "")
      .replace(/'s\b/gi, "")
      .trim();

    if (!candidateRaw || candidateRaw.length < 2) continue;

    // Normalize status
    const normalizedStatus = STATUS_ALIASES[statusRaw.toLowerCase()];
    if (!normalizedStatus) continue;

    // Resolve candidate
    const candidateInput = selectedCandidateId || candidateRaw;
    const resolution = await resolveCandidateIdentifier(candidateInput, 5);

    if (resolution.status !== "resolved") {
      // If we have a selected candidate ID, try that directly
      if (selectedCandidateId && candidateInput !== candidateRaw) {
        // Already tried selectedCandidateId, now try the name from prompt
        const nameResolution = await resolveCandidateIdentifier(candidateRaw, 5);
        if (nameResolution.status !== "resolved") continue;
        return await executeStatusUpdate(nameResolution, normalizedStatus, candidateRaw);
      }
      continue;
    }

    return await executeStatusUpdate(resolution, normalizedStatus, candidateRaw);
  }

  // ── Try note patterns ─────────────────────────────────────────
  for (const pattern of NOTE_PATTERNS) {
    const match = trimmed.match(pattern);
    if (!match) continue;

    let candidateRaw = match[1]
      .replace(/['''`"]/g, "")
      .replace(/'s\b/gi, "")
      .trim();
    const noteContent = match[2].trim();

    if (!candidateRaw || candidateRaw.length < 2 || !noteContent) continue;

    const candidateInput = selectedCandidateId || candidateRaw;
    const resolution = await resolveCandidateIdentifier(candidateInput, 5);
    if (resolution.status !== "resolved") continue;

    const toolResult = await executeDbTool("add_candidate_note", {
      candidate_id: resolution.candidate_id,
      content: noteContent,
      note_type: "general",
    });

    if (toolResult.error) continue;

    const displayName = resolution.display_name || candidateRaw;
    return {
      intercepted: true,
      action: "add_candidate_note",
      candidateName: candidateRaw,
      candidateId: resolution.candidate_id,
      novaId: resolution.nova_id,
      displayName,
      result: toolResult.result as Record<string, unknown>,
      groundingText: `[System note: GROUNDED WRITE EXECUTED — no tool calling needed.\nAction: add_candidate_note\nCandidate: ${displayName} (candidate_id="${resolution.candidate_id}"${resolution.nova_id ? `, nova_id="${resolution.nova_id}"` : ""})\nNote content: "${noteContent}"\nOutcome: Note saved successfully.\nYour job: Confirm to the user that the note was added. Do NOT call any tools.]`,
    };
  }

  return { intercepted: false };
}

async function executeStatusUpdate(
  resolution: CandidateResolveResult & { status: "resolved" },
  normalizedStatus: string,
  candidateRaw: string,
): Promise<GroundedWriteResult> {
  const toolResult = await executeDbTool("update_candidate_status", {
    candidate_id: resolution.candidate_id,
    new_status: normalizedStatus,
  });

  if (toolResult.error) {
    // Don't intercept if the write failed — let the LLM handle it
    return { intercepted: false };
  }

  const displayName = resolution.display_name || candidateRaw;
  const resultRecord = (toolResult.result || {}) as Record<string, unknown>;
  const outcome = resultRecord.outcome || "updated";
  const changedFields = resultRecord.changed_fields as Record<string, unknown> | undefined;
  const statusChange = changedFields?.status as { from?: string; to?: string } | undefined;

  return {
    intercepted: true,
    action: "update_candidate_status",
    candidateName: candidateRaw,
    candidateId: resolution.candidate_id,
    novaId: resolution.nova_id,
    displayName,
    result: resultRecord,
    groundingText: `[System note: GROUNDED WRITE EXECUTED — no tool calling needed.
Action: update_candidate_status
Candidate: ${displayName} (candidate_id="${resolution.candidate_id}"${resolution.nova_id ? `, nova_id="${resolution.nova_id}"` : ""})
Status change: ${statusChange?.from || "unknown"} → ${statusChange?.to || normalizedStatus}
Outcome: ${outcome}
Rows updated: ${resultRecord.rows_updated ?? 1}
Your job: Confirm to the user that the status was updated. Do NOT call any tools.]`,
  };
}

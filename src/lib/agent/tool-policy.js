const WRITE_INTENT_VERBS = [
  "save",
  "ingest",
  "create",
  "update",
  "upsert",
  "write",
  "add",
  "attach",
  "log",
  "change",
  "set",
  "move",
];

const READ_INTENT_VERBS = [
  "show",
  "list",
  "find",
  "get",
  "pull",
  "lookup",
  "look up",
  "bring up",
  "open",
  "check",
  "review",
  "rank",
  "sort",
  "filter",
];

const READ_ENTITY_PATTERN =
  /\b(candidate|candidates|dietitian|dietitians|nurse|nurses|traveler|travelers|facility|facilities|job|jobs|submittal|submittals|contract|contracts|prestart|prestarts)\b/i;

const READ_LIST_QUALIFIER_PATTERN =
  /\b(all|working|active|prestart|pending|pipeline|submitted|completed|cold|replied|top|match|matches|ending|expiring|next)\b/i;
const LOOKUP_OPENING_PATTERN =
  /^\s*(show|list|find|get|pull|lookup|look up|bring up|open|check|who|which|what|how many)\b/i;
const COPY_TASK_PATTERN =
  /\b(draft|write|compose|rewrite|reword|format|message|email|sms|text)\b/i;

const EXPLICIT_DRAFT_PERSIST_PATTERNS = [
  /\b(save|store|persist|log|insert|upsert)\b[\s\w]{0,80}\bdraft\b/i,
  /\bdraft\b[\s\w]{0,80}\b(save|store|persist|log|insert|upsert)\b/i,
  /\bcreate_com_draft_email\b/i,
];

const COPY_ONLY_DRAFT_PATTERNS = [
  /\b(draft|rewrite|reword|compose|prep|prepare|format|fix)\b[\s\w]{0,40}\b(text|sms|message|reply|follow[\s-]?up|note|email|formatting|outlook)\b/i,
  /\b(write)\b[\s\w]{0,24}\b(text|sms|message|reply|follow[\s-]?up)\b/i,
];

const STATUS_INTENT_PATTERNS = [
  /\b(has|got|received)\s+(an?\s+)?offer\b/i,
  /\bmove\b[\s\w]{0,24}\bto\b[\s\w]{0,24}\boffer\b/i,
  /\b(mark|set|update|change)\b[\s\w]{0,24}\boffer\b/i,
  /\bmove\b[\s\w]{0,24}\bsubmitted\b/i,
  /\b(mark|set|update|change)\b[\s\w]{0,24}\bsubmitted\b/i,
];

const NON_WRITE_ADD_PATTERNS = [
  /\badd\b[\s\w]{0,40}\b(detail|details|context|insight|insights|information|info)\b/i,
  /\b(can|could|able)\s+you\s+add\b[\s\w]{0,40}\b(detail|details|context|insight|insights|information|info)\b/i,
];

const SIMULATED_TOOL_PATTERNS = [
  /\bconceptual representation\b/i,
  /\bi would emit\b/i,
  /\bi would call\b/i,
  /\bwould invoke\b/i,
  /\btool call\b/i,
  /\bpseudo-?code\b/i,
];

export const STRICT_TOOL_CALL_SYSTEM_MESSAGE =
  "You must not describe or simulate tool usage. Return only a real tool call or a structured error.";

/**
 * @param {{prompt: string, availableToolNames?: string[], mode?: string}} input
 */
export function classifyToolRequirement({ prompt, availableToolNames = [], mode = "" }) {
  const normalizedPrompt = String(prompt || "").toLowerCase();
  const matchedVerb =
    WRITE_INTENT_VERBS.find((verb) => new RegExp(`\\b${verb}\\b`, "i").test(normalizedPrompt)) || null;
  const statusIntent = STATUS_INTENT_PATTERNS.some((pattern) => pattern.test(normalizedPrompt));
  const nonWriteAddIntent = matchedVerb === "add" && NON_WRITE_ADD_PATTERNS.some((pattern) => pattern.test(normalizedPrompt));
  const explicitDraftPersistIntent = EXPLICIT_DRAFT_PERSIST_PATTERNS.some((pattern) =>
    pattern.test(normalizedPrompt),
  );
  const copyOnlyDraftIntent =
    COPY_ONLY_DRAFT_PATTERNS.some((pattern) => pattern.test(normalizedPrompt)) &&
    !explicitDraftPersistIntent &&
    !statusIntent;
  const writeIntent = copyOnlyDraftIntent
    ? false
    : Boolean(((matchedVerb || statusIntent) && !nonWriteAddIntent) || explicitDraftPersistIntent);
  const readIntentVerb = READ_INTENT_VERBS.some((verb) => new RegExp(`\\b${verb}\\b`, "i").test(normalizedPrompt));
  const readEntityMention = READ_ENTITY_PATTERN.test(normalizedPrompt);
  const readQualifierMention = READ_LIST_QUALIFIER_PATTERN.test(normalizedPrompt);
  const shortEntityQuery =
    normalizedPrompt.split(/\s+/).filter(Boolean).length <= 6 && readEntityMention;
  const lookupWithoutEntity =
    LOOKUP_OPENING_PATTERN.test(normalizedPrompt) &&
    !COPY_TASK_PATTERN.test(normalizedPrompt);
  const readGroundingIntent =
    mode === "ayaops" &&
    !writeIntent &&
    ((readEntityMention && (readIntentVerb || readQualifierMention)) ||
      shortEntityQuery ||
      lookupWithoutEntity);

  const normalizedToolNames = availableToolNames
    .map((name) => String(name || "").trim())
    .filter(Boolean);

  const matchingWriteTools = normalizedToolNames.filter((toolName) => {
    const lower = toolName.toLowerCase();
    return (
      lower.startsWith("update_") ||
      lower.startsWith("add_") ||
      lower.startsWith("create_") ||
      lower.startsWith("ingest_") ||
      lower.startsWith("save_") ||
      lower.startsWith("upsert_") ||
      lower.startsWith("write_") ||
      lower.includes("_note")
    );
  });

  const hasMatchingWriteTool = matchingWriteTools.length > 0;
  const hasMatchingReadTool = normalizedToolNames.some(
    (toolName) => toolName.toLowerCase() === "access_hub",
  );
  const requiredToolKind = writeIntent ? "write" : readGroundingIntent ? "read" : "none";
  const toolRequired = mode === "ayaops" && requiredToolKind !== "none";
  const hasMatchingRequiredTool =
    requiredToolKind === "write"
      ? hasMatchingWriteTool
      : requiredToolKind === "read"
        ? hasMatchingReadTool
        : true;

  return {
    mode,
    writeIntent,
    readGroundingIntent,
    toolRequired,
    requiredToolKind,
    matchedVerb,
    statusIntent,
    hasMatchingWriteTool,
    hasMatchingReadTool,
    hasMatchingRequiredTool,
    matchingWriteTools,
    availableToolNames: normalizedToolNames,
  };
}

/**
 * @param {string} text
 */
export function detectSimulatedToolText(text) {
  const candidate = String(text || "");
  if (!candidate.trim()) return false;
  return SIMULATED_TOOL_PATTERNS.some((pattern) => pattern.test(candidate));
}

/**
 * @param {{
 *  toolRequired: boolean,
 *  hasFunctionCalls: boolean,
 *  hasText: boolean,
 *  simulatedToolTextDetected: boolean,
 *  hasExecutedTool: boolean,
 *  retryCount: number,
 *  maxRetries?: number
 * }} input
 */
export function evaluateToolRequiredTurn({
  toolRequired,
  hasFunctionCalls,
  hasText,
  simulatedToolTextDetected,
  hasExecutedTool,
  retryCount,
  maxRetries = 1,
}) {
  if (!toolRequired) {
    if (hasFunctionCalls) return { action: "execute_tools" };
    if (hasText) return { action: "emit_text" };
    return { action: "error", code: "EMPTY_RESPONSE" };
  }

  if (hasFunctionCalls) return { action: "execute_tools" };

  if (hasText) {
    if (!hasExecutedTool || simulatedToolTextDetected) {
      if (retryCount < maxRetries) return { action: "retry_strict", code: "TOOL_NOT_CALLED_WHEN_REQUIRED" };
      return { action: "error", code: "TOOL_NOT_CALLED_WHEN_REQUIRED" };
    }
    return { action: "emit_text" };
  }

  if (retryCount < maxRetries) return { action: "retry_strict", code: "EMPTY_RESPONSE" };
  return { action: "error", code: "EMPTY_RESPONSE" };
}

/**
 * @param {Array<{ok: boolean, name: string, error?: string}>} results
 */
export function summarizeToolExecution(results) {
  const outcomes = Array.isArray(results) ? results : [];
  const failed = outcomes.filter((item) => item && item.ok === false);
  return {
    ok: failed.length === 0,
    failed,
  };
}

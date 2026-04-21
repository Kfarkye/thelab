import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyToolRequirement,
  detectSimulatedToolText,
  evaluateToolRequiredTurn,
  summarizeToolExecution,
} from "../../src/lib/agent/tool-policy.js";

const READ_ONLY_TOOLS = [
  "get_candidate_by_id",
  "list_candidates_by_status",
  "search_candidates",
  "get_candidate_profile_link",
];

const READ_AND_WRITE_TOOLS = [
  ...READ_ONLY_TOOLS,
  "ingest_nova_profile",
  "update_candidate_status",
  "add_candidate_note",
  "create_com_draft_email",
];

test("real tool call success path is allowed", () => {
  const decision = evaluateToolRequiredTurn({
    toolRequired: true,
    hasFunctionCalls: true,
    hasText: false,
    simulatedToolTextDetected: false,
    hasExecutedTool: false,
    retryCount: 0,
    maxRetries: 1,
  });
  assert.equal(decision.action, "execute_tools");
});

test("explanatory text without tool call retries once, then accepts tool call", () => {
  const first = evaluateToolRequiredTurn({
    toolRequired: true,
    hasFunctionCalls: false,
    hasText: true,
    simulatedToolTextDetected: true,
    hasExecutedTool: false,
    retryCount: 0,
    maxRetries: 1,
  });
  assert.equal(first.action, "retry_strict");
  assert.equal(first.code, "TOOL_NOT_CALLED_WHEN_REQUIRED");

  const second = evaluateToolRequiredTurn({
    toolRequired: true,
    hasFunctionCalls: true,
    hasText: false,
    simulatedToolTextDetected: false,
    hasExecutedTool: false,
    retryCount: 1,
    maxRetries: 1,
  });
  assert.equal(second.action, "execute_tools");
});

test("write intent with no matching write tool is classified as unavailable", () => {
  const classification = classifyToolRequirement({
    prompt: "Please update this candidate and save the note",
    availableToolNames: READ_ONLY_TOOLS,
    mode: "ayaops",
  });
  assert.equal(classification.toolRequired, true);
  assert.equal(classification.writeIntent, true);
  assert.equal(classification.hasMatchingWriteTool, false);
});

test("write intent with update tool available is classified as executable", () => {
  const classification = classifyToolRequirement({
    prompt: "Please update this candidate to active",
    availableToolNames: READ_AND_WRITE_TOOLS,
    mode: "ayaops",
  });
  assert.equal(classification.toolRequired, true);
  assert.equal(classification.writeIntent, true);
  assert.equal(classification.hasMatchingWriteTool, true);
  assert.equal(classification.matchingWriteTools.includes("update_candidate_status"), true);
});

test("save note intent is executable when add_candidate_note is available", () => {
  const classification = classifyToolRequirement({
    prompt: "Please save a follow up note for this candidate",
    availableToolNames: ["search_candidates", "add_candidate_note"],
    mode: "ayaops",
  });
  assert.equal(classification.toolRequired, true);
  assert.equal(classification.writeIntent, true);
  assert.equal(classification.hasMatchingWriteTool, true);
  assert.equal(classification.matchingWriteTools.includes("add_candidate_note"), true);
});

test("draft email intent is executable when create_com_draft_email is available", () => {
  const classification = classifyToolRequirement({
    prompt: "Draft an email for this candidate and save it",
    availableToolNames: READ_AND_WRITE_TOOLS,
    mode: "ayaops",
  });
  assert.equal(classification.toolRequired, true);
  assert.equal(classification.writeIntent, true);
  assert.equal(classification.hasMatchingWriteTool, true);
  assert.equal(classification.matchingWriteTools.includes("create_com_draft_email"), true);
});

test("draft wording request without persist language stays read-only", () => {
  const classification = classifyToolRequirement({
    prompt: "Can you draft a text that vibes with her and keeps it short?",
    availableToolNames: READ_AND_WRITE_TOOLS,
    mode: "ayaops",
  });
  assert.equal(classification.writeIntent, false);
  assert.equal(classification.toolRequired, false);
});

test("write-a-text wording request stays read-only unless persist is explicit", () => {
  const classification = classifyToolRequirement({
    prompt: "Can you write a text message to her about the rate increase?",
    availableToolNames: READ_AND_WRITE_TOOLS,
    mode: "ayaops",
  });
  assert.equal(classification.writeIntent, false);
  assert.equal(classification.toolRequired, false);
});

test("ingest intent is executable when ingest_nova_profile is available", () => {
  const classification = classifyToolRequirement({
    prompt: "Ingest this nova candidate profile and save it",
    availableToolNames: ["search_candidates", "ingest_nova_profile"],
    mode: "ayaops",
  });
  assert.equal(classification.toolRequired, true);
  assert.equal(classification.writeIntent, true);
  assert.equal(classification.hasMatchingWriteTool, true);
  assert.equal(classification.matchingWriteTools.includes("ingest_nova_profile"), true);
});

test("offer-status phrasing is treated as write intent without explicit verbs", () => {
  const classification = classifyToolRequirement({
    prompt: "Ryan Jensen has an offer",
    availableToolNames: READ_AND_WRITE_TOOLS,
    mode: "ayaops",
  });
  assert.equal(classification.toolRequired, true);
  assert.equal(classification.writeIntent, true);
  assert.equal(classification.statusIntent, true);
  assert.equal(classification.hasMatchingWriteTool, true);
});

test("copy-cleanup request is not forced into tool-required write flow", () => {
  const classification = classifyToolRequirement({
    prompt: "can you clean this up for clinician facing",
    availableToolNames: READ_AND_WRITE_TOOLS,
    mode: "ayaops",
  });
  assert.equal(classification.writeIntent, false);
  assert.equal(classification.toolRequired, false);
});

test("add more details phrasing stays read-only in ayaops", () => {
  const classification = classifyToolRequirement({
    prompt: "Are you able to grounded web search to add even more details?",
    availableToolNames: READ_AND_WRITE_TOOLS,
    mode: "ayaops",
  });
  assert.equal(classification.writeIntent, false);
  assert.equal(classification.toolRequired, false);
});

test("backend tool failure is surfaced as structured failure state", () => {
  const summary = summarizeToolExecution([
    { ok: true, name: "search_candidates" },
    { ok: false, name: "update_candidate_status", error: "permission denied" },
  ]);
  assert.equal(summary.ok, false);
  assert.equal(summary.failed.length, 1);
  assert.equal(summary.failed[0].name, "update_candidate_status");
});

test("simulated tool text is detected and blocked on tool-required flow", () => {
  const simulated =
    'Here is a conceptual representation of the tool call:\\n```python\\nupdate_candidate_status(...)\\n```';
  assert.equal(detectSimulatedToolText(simulated), true);

  const decision = evaluateToolRequiredTurn({
    toolRequired: true,
    hasFunctionCalls: false,
    hasText: true,
    simulatedToolTextDetected: true,
    hasExecutedTool: true,
    retryCount: 1,
    maxRetries: 1,
  });
  assert.equal(decision.action, "error");
  assert.equal(decision.code, "TOOL_NOT_CALLED_WHEN_REQUIRED");
});

test("plain JSON/code-fenced confirmation is not treated as simulated tool text", () => {
  const confirmation = "```json\\n{\\n  \\\"rows_updated\\\": 1\\n}\\n```";
  assert.equal(detectSimulatedToolText(confirmation), false);
});

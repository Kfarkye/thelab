"use client";

import { useReducer, useRef, useEffect, useCallback, useState, useMemo, FormEvent } from "react";
import { Send, Copy, Check, Plus, ChevronDown, ChevronRight, X, Paperclip, Mic, Search, Phone, MoreHorizontal, PanelLeft } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import type { CommitAction, SandboxPanelMode, SandboxPreview, SandboxTask } from "@/lib/types/sandbox";
import { SandboxPanel } from "@/components/SandboxPanel";

// --- Types ---
interface Citation { title: string; uri: string; }
interface CodeBlock {
  code: string;
  language: string;
  outcome?: string;
  output?: string;
}

type WriteOutcome = "updated" | "inserted" | "no_change" | "failed";

interface WriteResultMeta {
  outcome: WriteOutcome;
  action?: string;
  objectType?: string;
  rowsUpdated?: number | null;
  code?: string | null;
  payload?: Record<string, unknown>;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  workspaceScope?: string | null;
  citations?: Citation[];
  queries?: string[];
  codeBlocks?: CodeBlock[];
  timestamp: Date;
  isStreaming?: boolean;
  durationMs?: number;
  imageUrl?: string;
  modelProvider?: string;
  modelId?: string;
  writeResult?: WriteResultMeta;
}

interface SavedImage {
  imageId: string;
  candidateId: string | null;
  candidateName: string | null;
  sourceType: string;
  screenType: string | null;
  mode: string | null;
  createdAt: string;
  isPinned: boolean;
  tags: string[];
  previewUrl: string;
}

interface SelectedCandidateContextPayload {
  candidate_id: string | null;
  nova_id: string | null;
  candidate_name: string | null;
  candidate_email: string | null;
  current_bucket: string | null;
  source: "left_rail_selected" | "left_rail_inferred";
}

interface SelectedMarginContextPayload {
  candidate_name: string | null;
  profession: string | null;
  specialty: string | null;
  facility_name: string | null;
  facility_city: string | null;
  facility_state: string | null;
  assignment_start: string | null;
  assignment_end: string | null;
  weekly_gross: number | null;
  actual_margin_pct: number | null;
  target_margin_pct: number | null;
  base_pay_rate: number | null;
  weekly_stipends: number | null;
  weekly_hours: number | null;
  shift_type: string | null;
  shift_start: string | null;
  shift_end: string | null;
}

type ConsoleMode =
  | "healthcare"
  | "sports"
  | "code"
  | "worldcup"
  | "ayaops"
  | "facility"
  | "margins";
type ModelOverride = "auto" | "sonnet" | "opus" | "flash" | "pro";

interface ModeConfig {
  id: ConsoleMode;
  label: string;
  suggestions: string[];
  placeholder: string;
}

const MODES: Record<ConsoleMode, ModeConfig> = {
  healthcare: {
    id: "healthcare",
    label: "Healthcare",
    suggestions: [
      "What are the current BLS certification requirements?",
      "Which states are in the nursing compact?",
      "ACLS renewal — what CE hours do I need?",
    ],
    placeholder: "Ask a question...",
  },
  sports: {
    id: "sports",
    label: "Sports",
    suggestions: [
      "Who's injured for tonight's NBA games?",
      "Dallas Stars playoff schedule and odds",
      "Best MLB DFS value plays today",
    ],
    placeholder: "Ask a question...",
  },
  code: {
    id: "code",
    label: "Code",
    suggestions: [
      "Debug this error — what's the root cause and fix?",
      "Review this function for edge cases and performance",
      "How should I architect this feature?",
    ],
    placeholder: "Paste code, describe a bug, or ask anything...",
  },
  worldcup: {
    id: "worldcup",
    label: "World Cup",
    suggestions: [
      "What if Argentina draws Mexico 1-1?",
      "Show me Group D standings and path to knockout",
      "Which teams have the highest travel fatigue index?",
    ],
    placeholder: "Ask about the 2026 World Cup...",
  },
  ayaops: {
    id: "ayaops",
    label: "AyaOps",
    suggestions: [
      "Who's finishing up in the next 30 days?",
      "Where are we thin on coverage right now?",
      "Any travelers flagged for credential gaps?",
    ],
    placeholder: "Ask about your team...",
  },
  facility: {
    id: "facility",
    label: "Facility",
    suggestions: [
      "Which facilities submit without references?",
      "Which facilities give quick offers?",
      "Which facilities have the best pay-to-cost-of-living setup?",
      "Which facilities extend travelers most?",
      "Which facilities cancel most?",
    ],
    placeholder: "Ask about facilities...",
  },
  margins: {
    id: "margins",
    label: "Margins",
    suggestions: [
      "What's the read on this margin?",
      "Where's the risk in this package?",
      "What should I lock before submit?",
    ],
    placeholder: "What's the risk here?",
  },
};

const CLEAN_COPY_MODES = new Set<ConsoleMode>([
  "healthcare",
  "sports",
  "worldcup",
  "ayaops",
  "facility",
  "margins",
]);

const MODE_CONTEXT_HINTS: Record<ConsoleMode, string> = {
  healthcare: "Ask about state licensing steps, fees, timelines, and required documents.",
  sports: "Ask about injuries, lines, matchup context, and slate priorities.",
  code: "Ask for architecture, debugging, implementation, or reviews.",
  worldcup: "Ask about matches, tactical reads, line movement, and today’s slate.",
  ayaops: "Ask about candidates, facilities, rates, deadlines, and message threads.",
  facility: "Ask about submittal rules, cancellation risk, extensions, and facility load.",
  margins: "Ask for the margin read, execution risk, and next best action.",
};

const CAPABILITY_OPTIONS: { value: ModelOverride; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "routes for you" },
  { value: "flash", label: "Quick", hint: "fast lookups" },
  { value: "sonnet", label: "Standard", hint: "everyday" },
  { value: "opus", label: "Deep", hint: "heavy analysis" },
  { value: "pro", label: "Extended", hint: "long research" },
];

// --- State Machine ---
interface ChatState {
  messages: Message[];
  input: string;
  loading: boolean;
  copiedId: string | null;
  pendingImage: string | null;
  mode: ConsoleMode;
  selectedCandidate: { id: string; name: string; candidate: Record<string, unknown>; contextText: string } | null;
}

type ChatAction =
  | { type: "SET_INPUT"; payload: string }
  | { type: "SET_PENDING_IMAGE"; payload: string | null }
  | { type: "ADD_USER_MESSAGE"; payload: { text: string; id: string; imageUrl?: string; workspaceScope?: string | null } }
  | { type: "ADD_ASSISTANT_MESSAGE"; payload: { text: string; id: string; workspaceScope?: string | null } }
  | { type: "START_ASSISTANT_STREAM"; payload: { id: string; workspaceScope?: string | null } }
  | { type: "APPEND_ASSISTANT_CHUNK"; payload: { id: string; textChunk: string } }
  | { type: "SET_ASSISTANT_WRITE_RESULT"; payload: { id: string; writeResult: WriteResultMeta } }
  | { type: "SET_ASSISTANT_GROUNDING"; payload: { id: string; citations: Citation[]; queries: string[] } }
  | { type: "FINISH_ASSISTANT_STREAM"; payload: { id: string; durationMs: number; modelProvider?: string; modelId?: string } }
  | { type: "ERROR_ASSISTANT_STREAM"; payload: { id: string; error: string; code?: string } }
  | { type: "ADD_CODE_BLOCK"; payload: { id: string; code: string; language: string } }
  | { type: "SET_CODE_RESULT"; payload: { id: string; outcome: string; output: string } }
  | { type: "SET_COPIED"; payload: string | null }
  | { type: "CLEAR_CHAT" }
  | { type: "SET_MODE"; payload: ConsoleMode }
  | { type: "SET_SELECTED_CANDIDATE"; payload: ChatState["selectedCandidate"] }
  | { type: "HYDRATE"; payload: Message[] };

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_INPUT":
      return { ...state, input: action.payload };
    case "SET_PENDING_IMAGE":
      return { ...state, pendingImage: action.payload };
    case "ADD_USER_MESSAGE":
      return {
        ...state, input: "", pendingImage: null,
        messages: [
          ...state.messages,
          {
            id: action.payload.id,
            role: "user",
            text: action.payload.text,
            timestamp: new Date(),
            imageUrl: action.payload.imageUrl,
            workspaceScope: action.payload.workspaceScope || null,
          },
        ]
      };
    case "ADD_ASSISTANT_MESSAGE":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: action.payload.id,
            role: "assistant",
            text: action.payload.text,
            timestamp: new Date(),
            isStreaming: false,
            workspaceScope: action.payload.workspaceScope || null,
          },
        ],
      };
    case "START_ASSISTANT_STREAM":
      return {
        ...state, loading: true,
        messages: [
          ...state.messages,
          {
            id: action.payload.id,
            role: "assistant",
            text: "",
            timestamp: new Date(),
            isStreaming: true,
            workspaceScope: action.payload.workspaceScope || null,
          },
        ]
      };
    case "APPEND_ASSISTANT_CHUNK":
      return {
        ...state, loading: false,
        messages: state.messages.map((m) => {
          if (m.id !== action.payload.id) return m;
          const nextText = m.text + action.payload.textChunk;
          const inferred = !m.writeResult ? inferWriteResultFromText(nextText) : null;
          return {
            ...m,
            text: nextText,
            writeResult: m.writeResult || inferred || undefined,
          };
        })
      };
    case "SET_ASSISTANT_WRITE_RESULT":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.payload.id
            ? { ...m, writeResult: action.payload.writeResult }
            : m
        ),
      };
    case "SET_ASSISTANT_GROUNDING":
      return {
        ...state,
        messages: state.messages.map(m => m.id === action.payload.id ? { ...m, citations: action.payload.citations, queries: action.payload.queries } : m)
      };
    case "FINISH_ASSISTANT_STREAM":
      return {
        ...state, loading: false,
        messages: state.messages.map((m) => {
          if (m.id !== action.payload.id) return m;
          const inferred = !m.writeResult ? inferWriteResultFromText(m.text) : null;
          return {
            ...m,
            isStreaming: false,
            durationMs: action.payload.durationMs,
            modelProvider: action.payload.modelProvider,
            modelId: action.payload.modelId,
            writeResult: m.writeResult || inferred || undefined,
          };
        })
      };
    case "ERROR_ASSISTANT_STREAM":
      return {
        ...state, loading: false,
        messages: state.messages.map((m) =>
          m.id === action.payload.id
            ? {
              ...m,
              isStreaming: false,
              text: humanizeStreamError(action.payload.error, action.payload.code),
              writeResult: {
                outcome: "failed",
                code: action.payload.code || "STREAM_ERROR",
              },
            }
            : m
        )
      };
    case "ADD_CODE_BLOCK":
      return {
        ...state,
        messages: state.messages.map(m => m.id === action.payload.id ? {
          ...m, codeBlocks: [...(m.codeBlocks || []), { code: action.payload.code, language: action.payload.language }]
        } : m)
      };
    case "SET_CODE_RESULT":
      return {
        ...state,
        messages: state.messages.map(m => {
          if (m.id !== action.payload.id || !m.codeBlocks?.length) return m;
          const blocks = [...m.codeBlocks];
          blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], outcome: action.payload.outcome, output: action.payload.output };
          return { ...m, codeBlocks: blocks };
        })
      };
    case "SET_COPIED":
      return { ...state, copiedId: action.payload };
    case "CLEAR_CHAT":
      return { ...state, messages: [], input: "", loading: false, pendingImage: null };
    case "SET_MODE":
      return { ...state, mode: action.payload, selectedCandidate: null };
    case "SET_SELECTED_CANDIDATE":
      return { ...state, selectedCandidate: action.payload };
    case "HYDRATE":
      return { ...state, messages: action.payload };
    default:
      return state;
  }
}

// --- Helpers ---
const uid = () => Math.random().toString(36).slice(2, 10);

const extractDomain = (url: string) => {
  try { return new URL(url).hostname.replace("www.", ""); } catch { return url; }
};

const WRITE_ACTION_NAMES = [
  "update_candidate_status",
  "add_candidate_note",
  "create_com_draft_email",
];

const isWriteOutcome = (value: unknown): value is WriteOutcome =>
  value === "updated" || value === "inserted" || value === "no_change" || value === "failed";

function inferWriteResultFromText(text: string): WriteResultMeta | null {
  const value = String(text || "");
  const lower = value.toLowerCase();
  const hasWriteSignals =
    /rows[_\s]?updated|outcome|object_type|tool_execution_failed|internal lookup failed/.test(lower) ||
    WRITE_ACTION_NAMES.some((name) => lower.includes(name));
  if (!hasWriteSignals) return null;

  const rowsMatch = lower.match(/rows[_\s]?updated["\s:]*([0-9]+)/);
  const rowsUpdated = rowsMatch ? Number(rowsMatch[1]) : null;

  if (/\btool_execution_failed\b/.test(lower) || /internal lookup failed/.test(lower)) {
    return { outcome: "failed", rowsUpdated, code: "TOOL_EXECUTION_FAILED" };
  }
  if (/\boutcome["\s:_-]*no[_\s-]?change\b/.test(lower) || /\bno change\b/.test(lower)) {
    return { outcome: "no_change", rowsUpdated };
  }
  if (/\boutcome["\s:_-]*inserted\b/.test(lower)) {
    return { outcome: "inserted", rowsUpdated };
  }
  if (/\boutcome["\s:_-]*updated\b/.test(lower)) {
    return { outcome: "updated", rowsUpdated };
  }

  return null;
}

function humanizeStreamError(error: string, code?: string): string {
  const raw = String(error || "").trim();
  const lowered = raw.toLowerCase();
  if (!raw) return "I couldn’t complete that request. Please try again.";

  if (lowered.includes("internal lookup failed")) {
    return "I couldn’t complete that lookup. Try candidate name or ID and retry.";
  }
  if (lowered.includes("tool-required request was not executed") || lowered.includes("internal lookup loop limit")) {
    return "I couldn’t finish that lookup yet. Try the candidate name or ID and I’ll retry.";
  }
  if (lowered.includes("unsupported built-in function") || lowered.includes("unimplemented")) {
    return "That lookup is temporarily unavailable. Please retry in a moment.";
  }
  if (lowered.includes("permission_denied") || lowered.includes("unauthenticated")) {
    return "I couldn’t access that record right now. Please retry.";
  }
  if (lowered.includes("deadline_exceeded") || lowered.includes("timeout")) {
    return "That request timed out. Please retry.";
  }
  if (lowered.includes("to_email is required")) {
    return "I couldn’t draft that yet because the candidate email is missing.";
  }
  if (lowered.includes("connection failed")) {
    return "I lost connection while fetching that. Try again in a moment.";
  }
  if (lowered.includes("malformed nova payload")) {
    return "I couldn’t read that payload format. Paste the full JSON block and I’ll process it.";
  }
  if (code === "STREAM_ERROR") {
    return "I ran into a temporary stream issue. Please retry.";
  }
  return "I couldn’t complete that request. Please try again.";
}

const writeOutcomeLabel = (outcome: WriteOutcome) => {
  if (outcome === "updated") return "Saved";
  if (outcome === "inserted") return "Saved";
  if (outcome === "no_change") return "Saved";
  return "Retry";
};

const writePayloadForDisplay = (writeResult: WriteResultMeta): Record<string, unknown> => {
  if (writeResult.payload && typeof writeResult.payload === "object") return writeResult.payload;
  const fallback: Record<string, unknown> = { outcome: writeResult.outcome };
  if (writeResult.action) fallback.action = writeResult.action;
  if (writeResult.objectType) fallback.objectType = writeResult.objectType;
  if (typeof writeResult.rowsUpdated === "number") fallback.rowsUpdated = writeResult.rowsUpdated;
  if (writeResult.code) fallback.code = writeResult.code;
  return fallback;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeSandboxCommitAction(
  chunkType: string,
  payload: Record<string, unknown>,
): CommitAction | null {
  const direct = asRecord(payload.commitAction);
  if (direct && typeof direct.type === "string") {
    return direct as CommitAction;
  }

  if (chunkType === "sandbox_document") {
    const fixtureId = String(payload.fixtureId || payload.fixture_id || "").trim();
    const writeupUrl = String(payload.writeupUrl || payload.writeup_url || "").trim();
    const writeupTitle = String(payload.title || "").trim() || null;
    if (!fixtureId || !writeupUrl) return null;
    return {
      type: "publish_preview",
      fixtureId,
      writeupUrl,
      writeupTitle,
    };
  }

  if (chunkType === "sandbox_db_write") {
    const table = String(payload.table || "").trim();
    const operation = String(payload.operation || "").trim().toUpperCase();
    const params = asRecord(payload.params) || {};
    const database = String(payload.database || "recruitingdb");
    if (!table || !operation) return null;
    return {
      type: "spanner_write",
      database,
      table,
      operation: operation as "INSERT" | "UPDATE" | "DELETE",
      params,
    };
  }

  if (chunkType === "sandbox_api_call") {
    const method = String(payload.method || "GET").trim().toUpperCase();
    const url = String(payload.url || "").trim();
    if (!url) return null;
    const headers = asRecord(payload.headers) || {};
    const normalizedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      normalizedHeaders[key] = String(value);
    }
    return {
      type: "api_fetch",
      method,
      url,
      headers: normalizedHeaders,
      body: payload.body,
    };
  }

  if (chunkType === "sandbox_email_draft") {
    const templateId = String(payload.templateId || payload.template_id || "initial_outreach").trim();
    const candidateId = String(payload.candidateId || payload.candidate_id || "").trim();
    const jobId = String(payload.jobId || payload.job_id || "").trim() || undefined;
    const toEmail = String(payload.toEmail || payload.to_email || "").trim();
    const ccRaw = Array.isArray(payload.cc) ? payload.cc : [];
    const cc = ccRaw.map((entry) => String(entry).trim()).filter(Boolean);
    const subject = String(payload.subject || "").trim();
    const body = String(payload.body || "").trim();
    const noteContent = String(payload.noteContent || payload.note_content || "").trim() || undefined;
    if (!candidateId || !toEmail || !subject || !body) return null;
    return {
      type: "create_email_draft",
      templateId,
      candidateId,
      jobId,
      toEmail,
      cc,
      subject,
      body,
      noteContent,
    };
  }

  if (chunkType === "sandbox_agent_handoff") {
    const targetUrl = String(payload.targetUrl || payload.target_url || "").trim();
    const goal = String(payload.goal || "").trim();
    const sourceSurface = String(payload.sourceSurface || payload.source_surface || "nova").trim() || "nova";
    const instructionsRaw = Array.isArray(payload.instructions) ? payload.instructions : [];
    const instructions = instructionsRaw.map((entry) => String(entry || "").trim()).filter(Boolean);
    const expectedReturnSchema = asRecord(payload.expectedReturnSchema || payload.expected_return_schema) || {};
    const context = asRecord(payload.context);
    const autoLaunchRaw = payload.autoLaunch ?? payload.auto_launch;
    const autoLaunch =
      typeof autoLaunchRaw === "boolean"
        ? autoLaunchRaw
        : typeof autoLaunchRaw === "string"
          ? autoLaunchRaw.toLowerCase() === "true"
          : false;
    if (!targetUrl || !goal || instructions.length === 0) return null;
    return {
      type: "create_agent_handoff_task",
      targetUrl,
      sourceSurface,
      goal,
      instructions,
      expectedReturnSchema,
      context,
      autoLaunch,
    };
  }

  return null;
}

function normalizeSandboxPreview(
  chunkType: string,
  payload: Record<string, unknown>,
): SandboxPreview | null {
  if (chunkType === "sandbox_document") {
    const markdown = String(payload.markdown || "");
    const renderedHtml = typeof payload.renderedHtml === "string" ? payload.renderedHtml : undefined;
    return { type: "document", markdown, renderedHtml };
  }
  if (chunkType === "sandbox_db_write") {
    const table = String(payload.table || "unknown_table");
    const operation = String(payload.operation || "UPDATE").toUpperCase() as "INSERT" | "UPDATE" | "DELETE";
    const before = asRecord(payload.before);
    const after = asRecord(payload.after) || {};
    return { type: "db_write", table, operation, before, after };
  }
  if (chunkType === "sandbox_api_call") {
    const method = String(payload.method || "GET").toUpperCase();
    const url = String(payload.url || "");
    const headers = asRecord(payload.headers) || {};
    const normalizedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      normalizedHeaders[key] = String(value);
    }
    return { type: "api_call", method, url, headers: normalizedHeaders, body: payload.body };
  }
  if (chunkType === "sandbox_email_draft") {
    const templateId = String(payload.templateId || payload.template_id || "initial_outreach").trim();
    const toEmail = String(payload.toEmail || payload.to_email || "").trim();
    const ccRaw = Array.isArray(payload.cc) ? payload.cc : [];
    const cc = ccRaw.map((entry) => String(entry).trim()).filter(Boolean);
    const subject = String(payload.subject || "").trim();
    const body = String(payload.body || "").trim();
    const candidateId = String(payload.candidateId || payload.candidate_id || "").trim() || undefined;
    const jobId = String(payload.jobId || payload.job_id || "").trim() || undefined;
    const noteContent = String(payload.noteContent || payload.note_content || "").trim() || undefined;
    const allowSendRaw = payload.allowSendNow ?? payload.allow_send_now;
    const allowSendNow =
      typeof allowSendRaw === "boolean"
        ? allowSendRaw
        : typeof allowSendRaw === "string"
          ? allowSendRaw.toLowerCase() !== "false"
          : true;
    return {
      type: "email_draft",
      templateId,
      toEmail,
      cc,
      subject,
      body,
      candidateId,
      jobId,
      noteContent,
      allowSendNow,
    };
  }
  if (chunkType === "sandbox_agent_handoff") {
    const targetUrl = String(payload.targetUrl || payload.target_url || "").trim();
    const goal = String(payload.goal || "").trim();
    const sourceSurface = String(payload.sourceSurface || payload.source_surface || "nova").trim() || "nova";
    const instructionsRaw = Array.isArray(payload.instructions) ? payload.instructions : [];
    const instructions = instructionsRaw.map((entry) => String(entry || "").trim()).filter(Boolean);
    const expectedReturnSchema = asRecord(payload.expectedReturnSchema || payload.expected_return_schema) || {};
    const context = asRecord(payload.context);
    const autoLaunchRaw = payload.autoLaunch ?? payload.auto_launch;
    const autoLaunch =
      typeof autoLaunchRaw === "boolean"
        ? autoLaunchRaw
        : typeof autoLaunchRaw === "string"
          ? autoLaunchRaw.toLowerCase() === "true"
          : false;
    return {
      type: "agent_handoff",
      targetUrl,
      sourceSurface,
      goal,
      instructions,
      expectedReturnSchema,
      context,
      autoLaunch,
    };
  }
  return null;
}

// --- Markdown renderer ---
function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatMarkdown(text: string): string {
  const escaped = escapeHtml(text);
  let html = escaped
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
      return `<pre class="c-code"><code>${code}</code></pre>`;
    })
    .replace(/^>\s?(.*$)/gm, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (_match, prefix, url) => {
      return `${prefix}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    })
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, '<code class="c-inline-code">$1</code>')
    .replace(/^#### (.*$)/gm, '<h4>$1</h4>')
    .replace(/^### (.*$)/gm, '<h4>$1</h4>')
    .replace(/^## (.*$)/gm, '<h3>$1</h3>')
    .replace(/^# (.*$)/gm, '<h3>$1</h3>')
    .replace(/^\* (.*$)/gm, '<li>$1</li>')
    .replace(/^- (.*$)/gm, '<li>$1</li>')
    .replace(/^\d+\.\s(.*$)/gm, '<li>$1</li>')
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br/>");

  html = html.replace(/((<li>.*?<\/li>)(\s*<br\/>)?)+/g, (match) => `<ul>${match.replace(/<br\/>/g, "")}</ul>`);
  return `<p>${html}</p>`;
}

function formatCopyReadyText(markdown: string): string {
  if (!markdown) return "";
  return markdown
    .replace(/```[\w-]*\n([\s\S]*?)```/g, (_match, block) => `${String(block || "").trim()}\n\n`)
    .replace(/^>\s?/gm, "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^"\s*/gm, "")
    .replace(/\s*"$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const COPY_READY_FENCE_LANGS = new Set(["", "text", "txt", "plain", "plaintext"]);

function isCopyReadyFenceLanguage(language: string): boolean {
  return COPY_READY_FENCE_LANGS.has(String(language || "").trim().toLowerCase());
}

function isLikelyRawPayloadBlock(code: string, language: string): boolean {
  const normalizedLang = String(language || "").trim().toLowerCase();
  const trimmed = String(code || "").trim();
  if (!trimmed) return false;
  if (trimmed.length < 220) return false;

  const looksJsonLike =
    (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
    /\"[A-Za-z0-9_ -]+\"\s*:/.test(trimmed);
  const rawPayloadSignals =
    /\"(candidate_id|visible_messages|participants|unknowns|latest_inbound_message|latest_outbound_message|profile_status_tags|source|thread_source|raw_payload|event_id|object_id)\"\s*:/.test(
      trimmed,
    );

  const looksHtmlLike =
    /<\/?[a-z][\s\S]*?>/i.test(trimmed) &&
    /<(div|section|article|header|main|aside|span|p|h[1-6]|table|tbody|tr|td|ul|li|a|img)(\s|>)/i.test(trimmed);
  const htmlLang = normalizedLang === "html" || normalizedLang === "xml" || normalizedLang === "jsx" || normalizedLang === "tsx";

  if (normalizedLang === "json" && (looksJsonLike || rawPayloadSignals)) return true;
  if (looksJsonLike && rawPayloadSignals) return true;
  if ((htmlLang || normalizedLang === "markdown" || normalizedLang === "md") && looksHtmlLike) return true;
  if (looksHtmlLike && trimmed.length > 380) return true;
  return false;
}

function buildCopyOnlyMarkdown(markdown: string): string | null {
  const lines = String(markdown || "").split(/\r?\n/);
  if (lines.length === 0) return null;

  const segments: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = lines[i].match(/^```([\w-]*)\s*$/);
    if (!open) continue;
    const lang = String(open[1] || "").trim().toLowerCase();
    const startIndex = i;
    const blockLines: string[] = [lines[i]];
    i += 1;
    while (i < lines.length) {
      blockLines.push(lines[i]);
      if (/^```\s*$/.test(lines[i])) break;
      i += 1;
    }
    if (!isCopyReadyFenceLanguage(lang)) continue;

    let label: string | null = null;
    for (let j = startIndex - 1; j >= 0; j -= 1) {
      const candidate = lines[j].trim();
      if (!candidate) break;
      if (candidate.startsWith("```")) break;
      const normalized = candidate.replace(/^>\s*/, "").replace(/^[-*]\s+/, "").trim();
      if (!normalized) continue;
      if (normalized.startsWith("{") || normalized.startsWith("[")) continue;
      if (normalized.length > 140) continue;
      label = normalized;
      break;
    }

    const block = blockLines.join("\n").trim();
    if (!block) continue;
    if (label) segments.push(`**${label}**\n${block}`);
    else segments.push(block);
  }

  if (segments.length === 0) return null;
  return segments.join("\n\n").trim();
}

type AssistantDisplayContent = {
  visibleMarkdown: string;
  visibleMarkdownWithoutPrimaryCopyBlock: string;
  hiddenPayloadBlocks: string[];
  primaryCopyBlock: string | null;
  hasCopyBlocks: boolean;
};

function buildAssistantDisplayContent(markdown: string, mode: ConsoleMode): AssistantDisplayContent {
  const raw = String(markdown || "");
  if (!raw.trim()) {
    return {
      visibleMarkdown: "",
      visibleMarkdownWithoutPrimaryCopyBlock: "",
      hiddenPayloadBlocks: [],
      primaryCopyBlock: null,
      hasCopyBlocks: false,
    };
  }

  const cleanMode = CLEAN_COPY_MODES.has(mode);
  if (!cleanMode) {
    const primaryCopyBlock = extractPrimaryCopyBlock(raw);
    return {
      visibleMarkdown: raw,
      visibleMarkdownWithoutPrimaryCopyBlock: primaryCopyBlock ? stripFirstCopyReadyFence(raw) : raw,
      hiddenPayloadBlocks: [],
      primaryCopyBlock,
      hasCopyBlocks: Boolean(primaryCopyBlock),
    };
  }

  const hiddenPayloadBlocks: string[] = [];
  const fencePattern = /```([\w-]*)\n([\s\S]*?)```/g;
  let cursor = 0;
  let visible = "";
  let match: RegExpExecArray | null = null;

  while ((match = fencePattern.exec(raw)) !== null) {
    const full = String(match[0] || "");
    const lang = String(match[1] || "");
    const code = String(match[2] || "");
    visible += raw.slice(cursor, match.index);
    if (isLikelyRawPayloadBlock(code, lang)) {
      hiddenPayloadBlocks.push(code.trim());
    } else {
      visible += full;
    }
    cursor = match.index + full.length;
  }
  visible += raw.slice(cursor);

  const copyOnly = buildCopyOnlyMarkdown(visible);
  const visibleMarkdown = (copyOnly || visible).trim() || raw.trim();
  const primaryCopyBlock = extractPrimaryCopyBlock(visibleMarkdown);
  const visibleMarkdownWithoutPrimaryCopyBlock = primaryCopyBlock
    ? stripFirstCopyReadyFence(visibleMarkdown)
    : visibleMarkdown;

  return {
    visibleMarkdown,
    visibleMarkdownWithoutPrimaryCopyBlock,
    hiddenPayloadBlocks,
    primaryCopyBlock,
    hasCopyBlocks: Boolean(primaryCopyBlock),
  };
}

type UserDisplayContent = {
  previewText: string;
  hiddenText: string | null;
  collapsed: boolean;
  charCount: number;
  lineCount: number;
};

const USER_COLLAPSE_CHAR_LIMIT = 1200;
const USER_COLLAPSE_LINE_LIMIT = 18;

function buildUserDisplayContent(text: string): UserDisplayContent {
  const raw = String(text || "");
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      previewText: "",
      hiddenText: null,
      collapsed: false,
      charCount: 0,
      lineCount: 0,
    };
  }

  const lines = raw.split(/\r?\n/);
  const lineCount = lines.length;
  const charCount = raw.length;
  const hasFence = /```/.test(raw);
  const shouldCollapse =
    charCount > USER_COLLAPSE_CHAR_LIMIT ||
    lineCount > USER_COLLAPSE_LINE_LIMIT ||
    (hasFence && charCount > 600);

  if (!shouldCollapse) {
    return {
      previewText: raw,
      hiddenText: null,
      collapsed: false,
      charCount,
      lineCount,
    };
  }

  const lead = lines
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("```"));
  const leadText =
    !lead || lead.startsWith("{") || lead.startsWith("[")
      ? "Structured payload attached."
      : lead.length > 180
        ? `${lead.slice(0, 180).trimEnd()}…`
        : lead;
  const contextLine = hasFence
    ? "Payload details are hidden to keep this thread readable."
    : "Long request details are hidden to keep this thread readable.";
  const previewText = `${leadText}\n\n${contextLine}`;

  return {
    previewText,
    hiddenText: raw,
    collapsed: true,
    charCount,
    lineCount,
  };
}

function formatMessageTimestamp(value: Date): string {
  const safeDate = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date();
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(safeDate);
}

function extractPrimaryCopyBlock(markdown: string): string | null {
  if (!markdown) return null;
  const fencePattern = /```([\w-]*)\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null = null;
  while ((match = fencePattern.exec(markdown)) !== null) {
    const lang = String(match[1] || "").trim().toLowerCase();
    if (!isCopyReadyFenceLanguage(lang)) continue;
    const content = String(match[2] || "").trim();
    if (content) return content;
  }
  return null;
}

function stripFirstCopyReadyFence(markdown: string): string {
  if (!markdown) return "";
  const fencePattern = /```([\w-]*)\n([\s\S]*?)```/gi;
  let stripped = false;
  const withoutFirstFence = markdown.replace(fencePattern, (full: string, language: string) => {
    if (stripped) return full;
    const lang = String(language || "").trim().toLowerCase();
    if (!isCopyReadyFenceLanguage(lang)) return full;
    stripped = true;
    return "";
  });
  if (!stripped) return markdown;
  return withoutFirstFence.replace(/\n{3,}/g, "\n\n").trim();
}

// --- Persistence ---
const storageKey = (mode: ConsoleMode) => `chat-${mode}`;
const MODE_KEY = "chat-mode";

function saveToStorage(mode: ConsoleMode, messages: Message[]) {
  try {
    const serializable = messages.map(m => ({ ...m, timestamp: m.timestamp.toISOString() }));
    localStorage.setItem(storageKey(mode), JSON.stringify(serializable));
  } catch { /* quota or SSR */ }
}

function loadFromStorage(mode: ConsoleMode): Message[] {
  try {
    const raw = localStorage.getItem(storageKey(mode));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return parsed.map((m: Record<string, unknown>) => ({
      ...m,
      timestamp: new Date(m.timestamp as string),
      isStreaming: false,
      workspaceScope: typeof m.workspaceScope === "string" ? m.workspaceScope : null,
    }));
  } catch { return []; }
}

function workspaceScopeFor(mode: ConsoleMode, item: PanelItem | null): string | null {
  if ((mode !== "facility" && mode !== "margins") || !item?.id) return null;
  return `${mode}:${item.id}`;
}

function getSavedMode(): ConsoleMode {
  try {
    const raw = localStorage.getItem(MODE_KEY);
    if (
      raw === "healthcare" ||
      raw === "sports" ||
      raw === "code" ||
      raw === "worldcup" ||
      raw === "ayaops" ||
      raw === "facility" ||
      raw === "margins"
    ) {
      return raw;
    }
  } catch { /* SSR */ }
  return "sports";
}

function readStringSafe(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function readNumberSafe(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(readStringSafe(value).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function readPercentDecimal(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(value) > 1 ? value / 100 : value;
  }
  const raw = readStringSafe(value);
  if (!raw) return null;
  const hasPercent = raw.includes("%");
  const parsed = Number(raw.replace(/[$,%\s,]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return hasPercent || Math.abs(parsed) > 1 ? parsed / 100 : parsed;
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "--";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(parsed);
}

function formatLongDate(value: string | null | undefined): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--";
  return parsed.toLocaleString();
}

function marginDeltaPoints(actual: number | null | undefined, target: number | null | undefined): number | null {
  if (typeof actual !== "number" || !Number.isFinite(actual)) return null;
  if (typeof target !== "number" || !Number.isFinite(target)) return null;
  return (actual - target) * 100;
}

function formatMarginDelta(deltaPoints: number | null | undefined): string {
  if (typeof deltaPoints !== "number" || !Number.isFinite(deltaPoints)) return "Target n/a";
  const rounded = Math.round(deltaPoints * 100) / 100;
  if (Math.abs(rounded) < 0.01) return "On target";
  if (rounded > 0) return `+${rounded.toFixed(2)} over target`;
  return `${rounded.toFixed(2)} below target`;
}

function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--";
  const diffMs = parsed.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  const formatter = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  for (const [unit, size] of units) {
    if (absMs >= size || unit === "minute") {
      const amount = Math.round(diffMs / size);
      return formatter.format(amount, unit);
    }
  }
  return "--";
}

function formatShiftWindow(
  shiftType: string | null | undefined,
  shiftStart: string | null | undefined,
  shiftEnd: string | null | undefined,
): string {
  const type = readStringSafe(shiftType);
  const start = readStringSafe(shiftStart);
  const end = readStringSafe(shiftEnd);
  const window = start || end ? `${start || "--"}-${end || "--"}` : "";
  if (type && window) return `${type} ${window}`;
  if (window) return window;
  if (type) return type;
  return "--";
}

function parseTimeToMinutes(value: string | null | undefined): number | null {
  const raw = readStringSafe(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatShiftCadence(
  weeklyHours: number | null | undefined,
  shiftType: string | null | undefined,
  shiftStart: string | null | undefined,
  shiftEnd: string | null | undefined,
): string {
  const hours = typeof weeklyHours === "number" && Number.isFinite(weeklyHours) ? weeklyHours : null;
  const type = readStringSafe(shiftType).toLowerCase();
  const startMins = parseTimeToMinutes(shiftStart);
  const endMins = parseTimeToMinutes(shiftEnd);
  let shiftLengthHours: number | null = null;
  if (startMins != null && endMins != null) {
    const span = endMins >= startMins ? endMins - startMins : (24 * 60 - startMins) + endMins;
    if (span > 0) shiftLengthHours = span / 60;
  }
  const normalizedType =
    type === "day" ? "days" :
      type === "night" ? "nights" :
        type ? type : "shifts";

  if (hours != null && shiftLengthHours != null && shiftLengthHours > 0) {
    const shifts = hours / shiftLengthHours;
    const roundedShifts = Math.round(shifts);
    if (Math.abs(shifts - roundedShifts) <= 0.15 && roundedShifts > 0) {
      const roundedShiftLength = Math.round(shiftLengthHours * 10) / 10;
      const shiftLengthLabel = Number.isInteger(roundedShiftLength)
        ? String(roundedShiftLength)
        : roundedShiftLength.toFixed(1);
      return `${roundedShifts}×${shiftLengthLabel}s ${normalizedType}`;
    }
  }
  if (hours != null) return `${Math.round(hours)} hrs/week`;
  if (shiftLengthHours != null) {
    const roundedShiftLength = Math.round(shiftLengthHours * 10) / 10;
    const shiftLengthLabel = Number.isInteger(roundedShiftLength)
      ? String(roundedShiftLength)
      : roundedShiftLength.toFixed(1);
    return `${shiftLengthLabel}h ${normalizedType}`;
  }
  if (type) return normalizedType;
  return "--";
}

function formatAssignmentWindow(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return "Assignment dates not set";
  if (start && end) {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const hasValidRange =
      !Number.isNaN(startDate.getTime()) &&
      !Number.isNaN(endDate.getTime()) &&
      endDate.getTime() >= startDate.getTime();
    if (hasValidRange) {
      const msPerWeek = 7 * 24 * 60 * 60 * 1000;
      const weeks = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / msPerWeek));
      return `${weeks} weeks · ${formatLongDate(start)} – ${formatLongDate(end)}`;
    }
    return `${formatLongDate(start)} – ${formatLongDate(end)}`;
  }
  if (start) return `Starts ${formatLongDate(start)}`;
  return `Through ${formatLongDate(end)}`;
}

function assignmentProgress(start: string | null | undefined, end: string | null | undefined): { pct: number; label: string } | null {
  if (!start || !end) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) return null;
  const total = endDate.getTime() - startDate.getTime();
  const elapsed = Date.now() - startDate.getTime();
  const pct = Math.max(0, Math.min(100, (elapsed / total) * 100));
  return {
    pct,
    label: `${Math.round(pct)}% through assignment`,
  };
}


function formatTouchPriorityReason(value: string | null | undefined): string | null {
  const raw = readStringSafe(value);
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  if (lowered.includes("fallback timing signal") || lowered.includes("no explicit priority score")) {
    return "Priority inferred from current status and timing.";
  }
  return raw;
}

function formatSubmissionDifficulty(value: "easy" | "moderate" | "hard" | null | undefined): string {
  if (value === "easy") return "Easy submittal";
  if (value === "moderate") return "Moderate submittal";
  if (value === "hard") return "Hard submittal";
  return "Not configured";
}

function formatTournamentStage(value?: string | null): string {
  const map: Record<string, string> = {
    r32: "Round of 32",
    qf: "Quarterfinal",
    sf: "Semifinal",
    final: "Final",
    r16: "Round of 16",
    third_place: "Third Place",
  };
  return map[value || ""] || value || "";
}

function inferHealthcareContextFromPrompt(prompt: string): { state: string | null; profession: string | null } {
  const input = String(prompt || "").trim();
  if (!input) return { state: null, profession: null };

  const tellMatch = input.match(/tell me about the\s+(.+?)\s+license in\s+(.+)$/i);
  if (tellMatch) {
    return {
      profession: readStringSafe(tellMatch[1]) || null,
      state: readStringSafe(tellMatch[2]) || null,
    };
  }

  const licenseInMatch = input.match(/license in\s+(.+?)\s+for\s+(.+)$/i);
  if (licenseInMatch) {
    return {
      state: readStringSafe(licenseInMatch[1]) || null,
      profession: readStringSafe(licenseInMatch[2]) || null,
    };
  }

  const efficiencyGuideMatch = input.match(/([A-Za-z][A-Za-z\s]+?)\s+([A-Za-z][A-Za-z\-/\s]+?)\s+Efficiency Guide/i);
  if (efficiencyGuideMatch) {
    return {
      state: readStringSafe(efficiencyGuideMatch[1]) || null,
      profession: readStringSafe(efficiencyGuideMatch[2]) || null,
    };
  }

  const licenseHeaderMatch = input.match(/([A-Za-z][A-Za-z\s]+?)\s+([A-Za-z][A-Za-z\-/\s]+?)\s+license/i);
  if (licenseHeaderMatch) {
    return {
      state: readStringSafe(licenseHeaderMatch[1]) || null,
      profession: readStringSafe(licenseHeaderMatch[2]) || null,
    };
  }

  return { state: null, profession: null };
}

function inferHealthcareContextFromLabel(label: string): { state: string | null; profession: string | null } {
  const input = String(label || "").trim();
  if (!input) return { state: null, profession: null };
  const byDash = input.match(/^([A-Za-z][A-Za-z\s]+?)\s*[—-]\s*(.+)$/);
  if (byDash) {
    return {
      state: readStringSafe(byDash[1]) || null,
      profession: readStringSafe(byDash[2]) || null,
    };
  }
  return { state: null, profession: null };
}

function normalizeTextToken(value: string | null | undefined): string {
  return readStringSafe(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildLicensingReferenceUrl(slugOrId: string | null | undefined): string | null {
  const slug = readStringSafe(slugOrId).replace(/^\/+|\/+$/g, "");
  if (!slug) return null;
  return `https://www.statelicensingreference.com/${encodeURIComponent(slug)}`;
}

type HealthcareResolvedEntity = {
  id: string;
  label: string;
  state: string | null;
  profession: string | null;
  url: string;
};

function resolveHealthcareEntityFromPrompt(
  prompt: string,
  items: PanelItem[],
  selectedItem: PanelItem | null,
): HealthcareResolvedEntity | null {
  const normalizedPrompt = normalizeTextToken(prompt);
  if (!normalizedPrompt) return null;
  const rawPrompt = String(prompt || "").toLowerCase();

  const toEntity = (item: PanelItem): HealthcareResolvedEntity | null => {
    const id = readStringSafe(item.id);
    const url = buildLicensingReferenceUrl(id);
    if (!id || !url) return null;
    return {
      id,
      label: readStringSafe(item.label) || id,
      state: readStringSafe(item.state) || null,
      profession: readStringSafe(item.profession) || null,
      url,
    };
  };

  const selected = selectedItem ? toEntity(selectedItem) : null;
  if (selected && selectedItem) {
    const selectedState = normalizeTextToken(selectedItem.state || "");
    const selectedProfession = normalizeTextToken(selectedItem.profession || "");
    const selectedLabel = normalizeTextToken(selectedItem.label || "");
    const inferredFromPrompt = inferHealthcareContextFromPrompt(prompt);
    const inferredState = normalizeTextToken(inferredFromPrompt.state || "");
    const inferredProfession = normalizeTextToken(inferredFromPrompt.profession || "");
    const selectedMentioned =
      (selectedLabel && normalizedPrompt.includes(selectedLabel)) ||
      (selectedState &&
        selectedProfession &&
        normalizedPrompt.includes(selectedState) &&
        normalizedPrompt.includes(selectedProfession)) ||
      (selectedState &&
        selectedProfession &&
        inferredState === selectedState &&
        (inferredProfession === selectedProfession ||
          selectedProfession.includes(inferredProfession) ||
          inferredProfession.includes(selectedProfession)));

    if (selectedMentioned) return selected;
  }

  for (const item of items) {
    const slug = readStringSafe(item.id).toLowerCase();
    if (slug && rawPrompt.includes(slug)) {
      const entity = toEntity(item);
      if (entity) return entity;
    }
  }

  for (const item of items) {
    const label = normalizeTextToken(item.label);
    if (label && normalizedPrompt.includes(label)) {
      const entity = toEntity(item);
      if (entity) return entity;
    }
  }

  const inferred = inferHealthcareContextFromPrompt(prompt);
  const inferredState = normalizeTextToken(inferred.state || "");
  const inferredProfession = normalizeTextToken(inferred.profession || "");
  if (!inferredState || !inferredProfession) return null;

  for (const item of items) {
    const state = normalizeTextToken(item.state || "");
    const profession = normalizeTextToken(item.profession || "");
    const stateMatches =
      Boolean(state) && (state === inferredState || state.includes(inferredState) || inferredState.includes(state));
    const professionMatches =
      Boolean(profession) &&
      (profession === inferredProfession ||
        profession.includes(inferredProfession) ||
        inferredProfession.includes(profession));
    if (stateMatches && professionMatches) {
      const entity = toEntity(item);
      if (entity) return entity;
    }
  }

  return null;
}

// --- Summary types ---
interface PanelItem {
  id: string;
  label: string;
  candidateName?: string | null;
  candidateId?: string | null;
  candidateEmail?: string | null;
  description?: string;
  state?: string;
  profession?: string;
  fee?: number;
  renewalFee?: number;
  board?: string;
  compact?: boolean;
  home?: string;
  away?: string;
  homeLogo?: string;
  awayLogo?: string;
  date?: string;
  startTime?: string;
  status?: string;
  venue?: string;
  league?: string;
  homeRecord?: string | null;
  awayRecord?: string | null;
  spread?: number | null;
  total?: number | null;
  // World Cup fields
  homeName?: string;
  awayName?: string;
  homeFlag?: string;
  awayFlag?: string;
  groupLetter?: string;
  kickoff?: string;
  stage?: string;
  writeupUrl?: string | null;
  publishedAt?: string | null;
  city?: string | null;
  // AyaOps fields
  novaId?: string | null;
  novaUrl?: string | null;
  specialty?: string;
  homeState?: string;
  rcThreadUrl?: string | null;
  outlookThreadUrl?: string | null;
  complianceRisk?: string | null;
  source?: string;
  assignmentStatus?: string | null;
  derivedCurrentStatus?: string | null;
  assignmentStart?: string | null;
  assignmentEnd?: string | null;
  weeklyGross?: number | null;
  hourlyRate?: number | null;
  facilityName?: string | null;
  facilityCity?: string | null;
  facilityState?: string | null;
  vmsPlatform?: string | null;
  facilityBeds?: number | null;
  phone?: string | null;
  facilityId?: string | null;
  facilitySystemName?: string | null;
  facilityProfileUrl?: string | null;
  facilityNovaUrl?: string | null;
  acceptsLocals?: boolean | null;
  requiresCompact?: boolean | null;
  submittalRules?: string | null;
  submissionDifficulty?: "easy" | "moderate" | "hard" | null;
  payVsLocalCol?: string | null;
  parkingCost?: string | null;
  cancelRatePct?: number | null;
  extensionRatePct?: number | null;
  closedAssignments?: number | null;
  touchPriorityScore?: number | null;
  touchPriorityLevel?: string | null;
  touchPriorityBand?: "today" | "this_week" | "monitor" | null;
  touchPriorityReason?: string | null;
  touchDaysToEnd?: number | null;
  touchNoteSeed?: string | null;
  lastTouchAt?: string | null;
  unansweredCount?: number | null;
  // Facility mode fields
  activeAssignments?: number | null;
  pendingStartAssignments?: number | null;
  pipelineAssignments?: number | null;
  totalAssignments?: number | null;
  // Margins mode fields
  marginObjectId?: string | null;
  marginId?: string | null;
  jobId?: string | null;
  targetMarginPct?: number | null;
  actualMarginPct?: number | null;
  basePayRate?: number | null;
  weeklyStipends?: number | null;
  grossWeeklyPayComputed?: number | null;
  shiftType?: string | null;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  weeklyHours?: number | null;
  lastSeenAt?: string | null;
  isLocal?: boolean | null;
  isCompact?: boolean | null;
}

interface SummaryData {
  pulse: Record<string, number>;
  items: PanelItem[];
  supportedLeagues?: { key: string; label: string }[];
  topProfessions?: { name: string; count: number }[];
}

interface TodayCard {
  id: string;
  title: string;
  detail: string;
  prompt: string;
  actionLabel: string;
  tone?: "default" | "attention" | "positive";
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function buildTodayCards(mode: ConsoleMode, summary: SummaryData | null): TodayCard[] {
  if (!summary || !Array.isArray(summary.items) || summary.items.length === 0) return [];
  const now = new Date();

  if (mode === "worldcup") {
    const worldCupItems = summary.items.filter((item) => Boolean(item.homeName || item.home) && Boolean(item.awayName || item.away));
    if (worldCupItems.length === 0) return [];

    const sortable = worldCupItems
      .map((item) => {
        const kickoffValue = item.kickoff || item.date || null;
        const kickoff = kickoffValue ? new Date(kickoffValue) : null;
        return { item, kickoff };
      })
      .filter((entry) => entry.kickoff && !Number.isNaN(entry.kickoff.getTime()))
      .sort((a, b) => a.kickoff!.getTime() - b.kickoff!.getTime());

    const nextMatch = sortable.find((entry) => entry.kickoff!.getTime() >= now.getTime() - 2 * 60 * 60 * 1000) || sortable[0];
    const todayMatches = sortable.filter((entry) => isSameLocalDay(entry.kickoff!, now));

    const cards: TodayCard[] = [];
    if (nextMatch) {
      const home = nextMatch.item.homeName || nextMatch.item.home || "Home";
      const away = nextMatch.item.awayName || nextMatch.item.away || "Away";
      cards.push({
        id: "wc-next",
        title: `${home} vs ${away} is up next`,
        detail: `${formatRelativeTime(nextMatch.kickoff!.toISOString())} · ${nextMatch.item.venue || formatTournamentStage(nextMatch.item.stage) || "Match preview ready"}`,
        prompt: `Give me the betting read for ${home} vs ${away}.`,
        actionLabel: "View preview",
        tone: "attention",
      });
    }

    cards.push({
      id: "wc-slate",
      title: `${todayMatches.length || sortable.length} matches in focus`,
      detail:
        todayMatches.length > 0
          ? `${todayMatches.slice(0, 2).map(({ item }) => `${item.homeName || item.home} vs ${item.awayName || item.away}`).join(" · ")}`
          : `${sortable.slice(0, 2).map(({ item }) => `${item.homeName || item.home} vs ${item.awayName || item.away}`).join(" · ")}`,
      prompt: "What are the top three World Cup matches I should prioritize right now?",
      actionLabel: "See priorities",
    });

    cards.push({
      id: "wc-ledger",
      title: `${Math.round(summary.pulse.previews || 0)} previews available`,
      detail: "Check what moved since your last slate review.",
      prompt: "What changed since my last World Cup review?",
      actionLabel: "Show changes",
      tone: "positive",
    });

    return cards.slice(0, 3);
  }

  if (mode === "ayaops") {
    const candidates = summary.items.filter((item) => Boolean(item.label));
    if (candidates.length === 0) return [];
    const ranked = [...candidates].sort((a, b) => {
      const aScore = typeof a.touchPriorityScore === "number" ? a.touchPriorityScore : -1;
      const bScore = typeof b.touchPriorityScore === "number" ? b.touchPriorityScore : -1;
      if (aScore !== bScore) return bScore - aScore;
      const aDays = typeof a.touchDaysToEnd === "number" ? a.touchDaysToEnd : Number.POSITIVE_INFINITY;
      const bDays = typeof b.touchDaysToEnd === "number" ? b.touchDaysToEnd : Number.POSITIVE_INFINITY;
      return aDays - bDays;
    });

    const top = ranked[0];
    const dueSoon =
      ranked.find((item) => typeof item.touchDaysToEnd === "number" && item.touchDaysToEnd <= 3) ||
      ranked.find((item) => typeof item.touchDaysToEnd === "number");
    const offers =
      ranked.find((item) => {
        const status = String(item.assignmentStatus || item.derivedCurrentStatus || "").toLowerCase();
        return status.includes("offer");
      }) || null;

    const cards: TodayCard[] = [
      {
        id: "ops-priority",
        title: `${top.label} needs attention`,
        detail: top.touchPriorityReason || `${top.specialty || top.profession || "Traveler"} · ${top.facilityName || "Facility not set"}`,
        prompt: `Prep the follow-up message for ${top.label}.`,
        actionLabel: "Draft follow-up",
        tone: "attention",
      },
    ];

    if (dueSoon) {
      cards.push({
        id: "ops-deadline",
        title: `${dueSoon.label} has a near-term deadline`,
        detail:
          typeof dueSoon.touchDaysToEnd === "number"
            ? `${dueSoon.touchDaysToEnd} day${dueSoon.touchDaysToEnd === 1 ? "" : "s"} to assignment end`
            : dueSoon.touchPriorityReason || "Deadline risk detected",
        prompt: `What is blocking ${dueSoon.label} and what should I do next?`,
        actionLabel: "Open plan",
      });
    }

    cards.push({
      id: "ops-pulse",
      title: `${Math.round(summary.pulse.submittals || 0)} in pipeline · ${Math.round(summary.pulse.active || 0)} active`,
      detail: offers ? `Offer watch: ${offers.label} · ${offers.facilityName || "facility pending"}` : "Review open pipeline movement before end of day.",
      prompt: "Give me today’s AyaOps priorities with risk and next actions.",
      actionLabel: "Review day plan",
      tone: "positive",
    });

    return cards.slice(0, 3);
  }

  return [];
}

// --- Left Panel ---
function LeftPanel({
  mode,
  summary,
  error,
  loading,
  filter,
  selectedItemId,
  onFilterChange,
  onItemClick,
  onModeSwitch,
  onRetry,
  onRefreshData,
  marginSubTab,
  onMarginSubTabChange,
  chatLoading,
  mobileOpen,
  onMobileClose,
}: {
  mode: ConsoleMode;
  summary: SummaryData | null;
  error: string | null;
  loading: boolean;
  filter: string;
  selectedItemId: string | null;
  onFilterChange: (v: string) => void;
  onItemClick: (item: PanelItem) => void;
  onModeSwitch: (m: ConsoleMode) => void;
  onRetry: () => void;
  onRefreshData: () => void;
  marginSubTab: "jobs" | "margins";
  onMarginSubTabChange: (tab: "jobs" | "margins") => void;
  chatLoading: boolean;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const pulse = summary?.pulse;
  const items = summary?.items || [];
  const supportedLeagues = summary?.supportedLeagues || [];
  const itemsScrollRef = useRef<HTMLDivElement>(null);
  const hasScrolledToday = useRef(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedSpecialty, setSelectedSpecialty] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [dotsOpen, setDotsOpen] = useState(false);
  const dotsRef = useRef<HTMLDivElement>(null);
  const [statusFilter, setStatusFilter] = useState<string>("prospect");
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [professionFilter, setProfessionFilter] = useState<string | null>(null);
  const [attachJobId, setAttachJobId] = useState<string | null>(null);
  const [attachName, setAttachName] = useState("");
  const [attachLoading, setAttachLoading] = useState(false);
  const [copiedHcUrl, setCopiedHcUrl] = useState<string | null>(null);
  const topProfessions = summary?.topProfessions || [];

  const normalizedFilter = filter.trim().toLowerCase();
  const filtered = normalizedFilter
    ? items.filter((item) => {
      const searchable = [
        item.label,
        item.description,
        item.candidateName,
        item.profession,
        item.specialty,
        item.facilityName,
        item.facilityCity,
        item.facilityState,
        item.state,
        item.jobId,
        item.marginId,
        item.marginObjectId,
      ];
      return searchable.some((value) => String(value || "").toLowerCase().includes(normalizedFilter));
    })
    : items;

  // Auto-scroll to today's date in Sports + World Cup modes
  useEffect(() => {
    if ((mode !== "sports" && mode !== "worldcup") || loading || filtered.length === 0 || hasScrolledToday.current) return;
    const container = itemsScrollRef.current;
    if (!container) return;

    // Get today in YYYY-MM-DD (local time)
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Find today's day separator, or the nearest future day
    const allDaySeps = container.querySelectorAll<HTMLElement>('[data-date]');
    let target: HTMLElement | null = null;
    for (const el of allDaySeps) {
      const d = el.getAttribute('data-date') || '';
      if (d >= todayStr) { target = el; break; }
    }
    // Fallback: last available day if all are in the past
    if (!target && allDaySeps.length > 0) {
      target = allDaySeps[allDaySeps.length - 1];
    }

    if (target) {
      requestAnimationFrame(() => {
        target!.scrollIntoView({ block: 'start', behavior: 'instant' });
      });
      hasScrolledToday.current = true;
    }
  }, [mode, loading, filtered]);

  // Reset scroll anchor when mode changes
  useEffect(() => {
    hasScrolledToday.current = false;
  }, [mode]);

  useEffect(() => {
    if (!dotsOpen) return;
    const close = (event: MouseEvent) => {
      if (dotsRef.current && !dotsRef.current.contains(event.target as Node)) {
        setDotsOpen(false);
      }
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [dotsOpen]);

  const pulseLabels: Record<ConsoleMode, { keys: string[]; labels: string[] }> = {
    healthcare: { keys: ["states", "professions", "total"], labels: ["States", "Professions", "Licenses"] },
    sports: { keys: ["games", "slates", "previews"], labels: ["Games", "Slates", "Previews"] },
    code: { keys: ["tools", "capabilities"], labels: ["Tools", "Features"] },
    worldcup: { keys: ["matches", "groups", "previews"], labels: ["Matches", "Groups", "Previews"] },
    ayaops: { keys: ["candidates", "facilities", "active", "submittals"], labels: ["Travelers", "Facilities", "Active", "In Pipeline"] },
    facility: { keys: ["facilities", "active", "pipeline", "tracked"], labels: ["Facilities", "Active", "Pipeline", "Tracked"] },
    margins: marginSubTab === "jobs"
      ? { keys: ["total_jobs", "specialties", "facilities"], labels: ["Jobs", "Specialties", "Facilities"] }
      : { keys: ["avg_margin_pct"], labels: ["Avg Margin"] },
  };

  const cfg = pulseLabels[mode];
  const formatPulseValue = (key: string, value: number) => {
    if (mode === "margins" && key === "avg_margin_pct") return `${value.toFixed(2)}%`;
    return Number.isFinite(value) ? value.toLocaleString("en-US") : "0";
  };

  const formatStage = (stage?: string | null) => {
    const map: Record<string, string> = {
      r32: "Round of 32",
      qf: "Quarterfinal",
      sf: "Semifinal",
      final: "Final",
      r16: "Round of 16",
      third_place: "Third Place",
    };
    return map[stage || ""] || stage || "";
  };

  // --- Resize handle logic ---
  const shellRef = useRef<HTMLElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    handleRef.current?.classList.add("ws-resizing");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const shell = shellRef.current?.closest(".ws-shell") as HTMLElement | null;
      if (!shell) return;
      const width = Math.min(600, Math.max(280, ev.clientX));
      shell.style.setProperty("--left-width", `${width}px`);
    };

    const onUp = () => {
      dragging.current = false;
      handleRef.current?.classList.remove("ws-resizing");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  return (
    <aside className={`lp-shell ${mobileOpen ? "lp-shell-mobile-open" : ""}`} ref={shellRef} style={{ position: "relative" }}>
      {/* Drag resize handle */}
      <div
        ref={handleRef}
        className="ws-resize-handle"
        onMouseDown={onResizeStart}
      />
      {/* Mode selector + progressive disclosure search */}
      <div className="lp-mode-area">
        <div className="lp-title-row">
          <div className="lp-dots-wrap" ref={dotsRef}>
            <button
              type="button"
              className="lp-mode-selector-btn"
              onClick={(event) => {
                event.stopPropagation();
                setDotsOpen((open) => !open);
              }}
              aria-expanded={dotsOpen}
              aria-label="Switch workspace"
            >
              <span className="lp-active-label">{MODES[mode].label}</span>
              <ChevronDown size={14} className="lp-mode-chevron" />
            </button>
            {dotsOpen && (
              <div className="lp-dots-menu">
                {(Object.keys(MODES) as ConsoleMode[]).map((modeKey) => (
                  <button
                    key={modeKey}
                    type="button"
                    className={`lp-dots-item ${mode === modeKey ? "active" : ""}`}
                    onClick={() => {
                      onModeSwitch(modeKey);
                      setDotsOpen(false);
                    }}
                    disabled={chatLoading}
                  >
                    {mode === modeKey && <span className="lp-dots-dot" />}
                    {MODES[modeKey].label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className="lp-mobile-close"
            onClick={onMobileClose}
            aria-label="Close workspace panel"
          >
            <X size={14} />
          </button>
          <button
            type="button"
            className={`lp-search-toggle ${searchOpen ? "active" : ""}`}
            onClick={() => { setSearchOpen(!searchOpen); if (!searchOpen) setTimeout(() => searchRef.current?.focus(), 60); }}
            aria-label="Toggle search"
          >
            {searchOpen ? <X size={14} /> : <Search size={14} />}
          </button>
        </div>

        {searchOpen && (
          <div className="lp-search-inline">
            <Search size={13} className="lp-search-inline-icon" />
            <input
              ref={searchRef}
              className="lp-search-inline-input"
              placeholder={`Search ${MODES[mode].label.toLowerCase()}...`}
              value={filter}
              onChange={(e) => onFilterChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setSearchOpen(false); onFilterChange(""); } }}
            />
          </div>
        )}
      </div>

      {mode === "ayaops" && (
        <div className="aya-ops-links-rail" aria-label="AyaOps Quick Links">
          <div className="aya-ops-link-group">
            <span className="aya-ops-group-label">Communications</span>
            <div className="aya-ops-group-items">
              <a href="https://app.ringcentral.com/sms/direct/all" target="_blank" rel="noopener noreferrer" className="aya-ops-link-chip">
                RingCentral SMS<span className="sr-only">URL: https://app.ringcentral.com/sms/direct/all</span>
              </a>
              <a href="https://teams.microsoft.com/v2/" target="_blank" rel="noopener noreferrer" className="aya-ops-link-chip">
                Microsoft Teams<span className="sr-only">URL: https://teams.microsoft.com/v2/</span>
              </a>
              <a href="https://outlook.cloud.microsoft/mail/AAMkADA5OTc3NDAxLWM2ZWQtNGNmMC04YzAzLThkOWMwMjk0MjBiMgAuAAAAAAALwSBcifhYRJ2lBsq4Iy%2B0AQAEE5rXW9aUTreCVwiNgefzAAPN4aivAAA%3D" target="_blank" rel="noopener noreferrer" className="aya-ops-link-chip">
                Outlook Mail<span className="sr-only">URL: https://outlook.cloud.microsoft/mail/...</span>
              </a>
            </div>
          </div>

          <div className="aya-ops-link-divider" />

          <div className="aya-ops-link-group">
            <span className="aya-ops-group-label">Recruiting Infrastructure</span>
            <div className="aya-ops-group-items">
              <a href="https://nova.ayahealthcare.com/#/recruiting/live-nurses-new" target="_blank" rel="noopener noreferrer" className="aya-ops-link-chip">
                Live List<span className="sr-only">URL: https://nova.ayahealthcare.com/#/recruiting/live-nurses-new</span>
              </a>
              <a href="https://ssrsreports-ayahealthcare.msappproxy.net/Reports/report/Recruiting/MyAya%20Interested%20Clicks" target="_blank" rel="noopener noreferrer" className="aya-ops-link-chip">
                Interested Clicks<span className="sr-only">URL: https://ssrsreports-ayahealthcare.msappproxy.net/...</span>
              </a>
              <a href="https://nova.ayahealthcare.com/#/recruiting/prestart-candidates" target="_blank" rel="noopener noreferrer" className="aya-ops-link-chip">
                Prestart<span className="sr-only">URL: https://nova.ayahealthcare.com/#/recruiting/prestart-candidates</span>
              </a>
              <a href="https://nova.ayahealthcare.com/#/recruiting/working-candidates" target="_blank" rel="noopener noreferrer" className="aya-ops-link-chip">
                Working<span className="sr-only">URL: https://nova.ayahealthcare.com/#/recruiting/working-candidates</span>
              </a>
              <a href="https://nova.ayahealthcare.com/#/recruiting/margins" target="_blank" rel="noopener noreferrer" className="aya-ops-link-chip">
                Margins<span className="sr-only">URL: https://nova.ayahealthcare.com/#/recruiting/margins</span>
              </a>
              <a href="https://nova.ayahealthcare.com/#/recruiting/facilities" target="_blank" rel="noopener noreferrer" className="aya-ops-link-chip">
                Facilities<span className="sr-only">URL: https://nova.ayahealthcare.com/#/recruiting/facilities</span>
              </a>
              <a href="https://thepulse.ayahealthcare.com/" target="_blank" rel="noopener noreferrer" className="aya-ops-link-chip">
                The Pulse<span className="sr-only">URL: https://thepulse.ayahealthcare.com/</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {cfg.keys.length > 0 && mode !== "ayaops" && mode !== "facility" && mode !== "margins" && (
        <div
          className="lp-pulse-strip"
          aria-label={`${MODES[mode].label} pulse`}
          style={{ gridTemplateColumns: `repeat(${Math.max(cfg.keys.length, 1)}, minmax(0, 1fr))` }}
        >
          {cfg.keys.map((key, idx) => (
            <div key={key} className="lp-pulse-cell">
              <span className="lp-pulse-num">{formatPulseValue(key, Number(pulse?.[key] ?? 0))}</span>
              <span className="lp-pulse-k">{cfg.labels[idx] || key}</span>
            </div>
          ))}
        </div>
      )}

      {mode === "healthcare" && topProfessions.length > 0 && (
        <div className="lp-hc-filter-rail" aria-label="Filter by profession">
          <button
            type="button"
            className={`lp-hc-filter-chip ${professionFilter === null ? "active" : ""}`}
            onClick={() => setProfessionFilter(null)}
          >
            All
          </button>
          {topProfessions.map((prof) => (
            <button
              key={prof.name}
              type="button"
              className={`lp-hc-filter-chip ${professionFilter === prof.name ? "active" : ""}`}
              onClick={() => setProfessionFilter(professionFilter === prof.name ? null : prof.name)}
            >
              {prof.name}
              <span className="lp-hc-filter-count">{prof.count}</span>
            </button>
          ))}
        </div>
      )}

      {mode === "sports" && items.length > 0 && (() => {
        // Build today's league list from actual items
        const nowLocal = new Date();
        const todayStr = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, '0')}-${String(nowLocal.getDate()).padStart(2, '0')}`;
        const leagueLogoMap: Record<string, string> = {
          "MLB": "https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/mlb.png&w=40&h=40",
          "NBA": "https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/nba.png&w=40&h=40",
          "NHL": "https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/nhl.png&w=40&h=40",
          "EPL": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/23.png&w=40&h=40",
          "La Liga": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/15.png&w=40&h=40",
          "Bundesliga": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/10.png&w=40&h=40",
          "Serie A": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/12.png&w=40&h=40",
          "Ligue 1": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/9.png&w=40&h=40",
          "MLS": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/19.png&w=40&h=40",
          "Champions League": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/2.png&w=40&h=40",
          "Europa League": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/2310.png&w=40&h=40",
          "Liga MX": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/26.png&w=40&h=40",
          "Brasileirao": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/85.png&w=40&h=40",
          "Primeira Liga": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/14.png&w=40&h=40",
          "Eredivisie": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/11.png&w=40&h=40",
          "Scottish Premiership": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/24.png&w=40&h=40",
          "Super Lig": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/18.png&w=40&h=40",
          "Belgian Pro League": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/144.png&w=40&h=40",
          "Argentina Primera": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/1.png&w=40&h=40",
        };
        // Collect leagues that have games today
        const todayLeagues: { name: string; count: number; logo: string | null }[] = [];
        const seen = new Set<string>();
        const counts = new Map<string, number>();
        for (const item of items) {
          const d = item.startTime ? item.startTime.slice(0, 10) : item.date || "";
          if (d !== todayStr) continue;
          const league = item.league || "Other";
          counts.set(league, (counts.get(league) || 0) + 1);
        }
        for (const [name, count] of counts) {
          todayLeagues.push({ name, count, logo: leagueLogoMap[name] || null });
        }
        if (todayLeagues.length === 0) return null;
        return (
          <div className="lp-league-nav" aria-label="Quick league navigation">
            {todayLeagues.map((lg) => (
              <button
                key={lg.name}
                type="button"
                className="lp-league-chip"
                onClick={() => {
                  const el = itemsScrollRef.current?.querySelector(`[data-league-id="${todayStr}-${lg.name}"]`);
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                {lg.logo && <img src={lg.logo} alt="" className="lp-league-chip-logo" />}
                <span className="lp-league-chip-label">{lg.name}</span>
                <span className="lp-league-chip-count">{lg.count}</span>
              </button>
            ))}
          </div>
        );
      })()}

      {/* Item list */}
      <div className="lp-items" ref={itemsScrollRef}>
        {error ? (
          <div className="lp-items-empty">
            <div>{error}</div>
            <button
              type="button"
              className="c-new-btn"
              style={{ marginTop: 10 }}
              onClick={onRetry}
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <>
            {mode === "margins" && (
              <div className="margin-sub-tabs">
                <button
                  className={`margin-sub-tab ${marginSubTab === "jobs" ? "active" : ""}`}
                  onClick={() => onMarginSubTabChange("jobs")}
                >
                  Jobs
                </button>
                <button
                  className={`margin-sub-tab ${marginSubTab === "margins" ? "active" : ""}`}
                  onClick={() => onMarginSubTabChange("margins")}
                >
                  Margins
                </button>
              </div>
            )}
            <div className="lp-items-loading">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="lp-item-skeleton" />
              ))}
            </div>
          </>
        ) : filtered.length === 0 ? (
          <>
            {mode === "margins" && (
              <div className="margin-sub-tabs">
                <button
                  className={`margin-sub-tab ${marginSubTab === "jobs" ? "active" : ""}`}
                  onClick={() => onMarginSubTabChange("jobs")}
                >
                  Jobs
                </button>
                <button
                  className={`margin-sub-tab ${marginSubTab === "margins" ? "active" : ""}`}
                  onClick={() => onMarginSubTabChange("margins")}
                >
                  Margins
                </button>
              </div>
            )}
            <div className="lp-items-empty">
              {filter
                ? "No matches"
                : mode === "margins"
                  ? marginSubTab === "jobs"
                    ? "No open jobs yet. Upload job data to populate this board."
                    : "No saved margins yet. Attach candidates to jobs to create margins."
                  : mode === "facility"
                    ? "No facility records available."
                    : "No data yet"}
            </div>
          </>
        ) : (
          (() => {
            // Sports mode: group by date with day separators
            if (mode === "sports") {
              // Group by date first
              const grouped: { date: string; label: string; items: PanelItem[] }[] = [];
              let lastDate = "";
              for (const item of filtered) {
                const d = item.startTime ? item.startTime.slice(0, 10) : item.date || "";
                if (d !== lastDate) {
                  const dateObj = new Date(d + "T12:00:00Z");
                  grouped.push({
                    date: d,
                    label: dateObj.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
                    items: [],
                  });
                  lastDate = d;
                }
                if (grouped.length > 0) grouped[grouped.length - 1].items.push(item);
              }

              const nowLocal = new Date();
              const todayISO = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, '0')}-${String(nowLocal.getDate()).padStart(2, '0')}`;

              // League logo map (shared with nav rail above)
              const leagueLogoMap: Record<string, string> = {
                "MLB": "https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/mlb.png&w=40&h=40",
                "NBA": "https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/nba.png&w=40&h=40",
                "NHL": "https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/nhl.png&w=40&h=40",
                "EPL": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/23.png&w=40&h=40",
                "La Liga": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/15.png&w=40&h=40",
                "Bundesliga": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/10.png&w=40&h=40",
                "Serie A": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/12.png&w=40&h=40",
                "Ligue 1": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/9.png&w=40&h=40",
                "MLS": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/19.png&w=40&h=40",
                "Champions League": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/2.png&w=40&h=40",
                "Europa League": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/2310.png&w=40&h=40",
                "Liga MX": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/26.png&w=40&h=40",
                "Brasileirao": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/85.png&w=40&h=40",
                "Primeira Liga": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/14.png&w=40&h=40",
                "Eredivisie": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/11.png&w=40&h=40",
                "Scottish Premiership": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/24.png&w=40&h=40",
                "Super Lig": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/18.png&w=40&h=40",
                "Belgian Pro League": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/144.png&w=40&h=40",
                "Argentina Primera": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/1.png&w=40&h=40",
              };

              return grouped.map((group) => {
                const isToday = group.date === todayISO;
                const isPast = group.date < todayISO;

                // Sub-group by league within each date
                const leagueOrder: string[] = [];
                const leagueMap = new Map<string, PanelItem[]>();
                for (const item of group.items) {
                  const league = item.league || "Other";
                  if (!leagueMap.has(league)) {
                    leagueOrder.push(league);
                    leagueMap.set(league, []);
                  }
                  leagueMap.get(league)!.push(item);
                }

                return (
                  <div key={group.date} data-date={group.date}>
                    <div className={`lp-day-separator ${isToday ? 'lp-day-today' : ''} ${isPast ? 'lp-day-past' : ''}`}>
                      <span className="lp-day-label">{isToday ? 'Today' : group.label}</span>
                      <span className="lp-day-count">{group.items.length}</span>
                    </div>
                    {leagueOrder.map((league) => {
                      const leagueItems = leagueMap.get(league)!;
                      const leagueLogo = leagueLogoMap[league] || null;
                      return (
                        <div key={`${group.date}-${league}`} data-league-id={`${group.date}-${league}`}>
                          {/* League section header */}
                          <div className="lp-league-header">
                            {leagueLogo && (
                              <img src={leagueLogo} alt="" className="lp-league-logo" />
                            )}
                            <span className="lp-league-name">{league}</span>
                            <span className="lp-league-count">{leagueItems.length}</span>
                          </div>
                          {leagueItems.map((item) => {
                            const hasWriteup = Boolean(item.writeupUrl);
                            return (
                              <div
                                key={item.id}
                                className={`lp-item lp-item-game ${hasWriteup ? "sp-match-linked" : ""}`}
                                onClick={() => {
                                  if (hasWriteup) {
                                    window.open(item.writeupUrl!, "_blank");
                                  } else {
                                    onItemClick(item);
                                  }
                                }}
                              >
                                <div className="sp-card">
                                  {/* Team rows */}
                                  <div className="sp-matchup">
                                    <div className="sp-team-row">
                                      {item.awayLogo && <img src={item.awayLogo} alt="" className="sp-team-icon" />}
                                      <span className="sp-team-name">{item.away || "TBD"}</span>
                                      {item.awayRecord && <span className="sp-team-rec">{item.awayRecord}</span>}
                                      {item.spread != null && (
                                        <span className="sp-line">{item.spread > 0 ? "+" : ""}{item.spread}</span>
                                      )}
                                    </div>
                                    <div className="sp-team-row">
                                      {item.homeLogo && <img src={item.homeLogo} alt="" className="sp-team-icon" />}
                                      <span className="sp-team-name">{item.home || "TBD"}</span>
                                      {item.homeRecord && <span className="sp-team-rec">{item.homeRecord}</span>}
                                      {item.total != null && (
                                        <span className="sp-line sp-line-ou">o/u {item.total}</span>
                                      )}
                                    </div>
                                  </div>
                                  {/* Footer: time + venue */}
                                  <div className="sp-card-foot">
                                    <span className="sp-foot-time">
                                      {item.startTime
                                        ? new Date(item.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                                        : "TBD"}
                                    </span>
                                    {item.venue && (
                                      <>
                                        <span className="sp-foot-sep">·</span>
                                        <span className="sp-foot-venue">{item.venue}</span>
                                      </>
                                    )}
                                    <span
                                      className={`sp-status-dot ${hasWriteup ? "sp-dot-ready" : "sp-dot-pending"}`}
                                      title={hasWriteup ? "Writeup published" : "No writeup yet"}
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              });
            }

            if (mode === "worldcup") {
              const grouped: { date: string; label: string; items: PanelItem[] }[] = [];
              let lastDate = "";

              for (const item of filtered) {
                const dateKey = item.kickoff ? item.kickoff.slice(0, 10) : "";
                if (dateKey !== lastDate) {
                  const dateObj = dateKey ? new Date(`${dateKey}T12:00:00Z`) : null;
                  grouped.push({
                    date: dateKey,
                    label: dateObj
                      ? dateObj.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
                      : "TBD",
                    items: [],
                  });
                  lastDate = dateKey;
                }
                if (grouped.length > 0) grouped[grouped.length - 1].items.push(item);
              }

              const nowLocal = new Date();
              const todayISO = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, "0")}-${String(nowLocal.getDate()).padStart(2, "0")}`;

              return grouped.map((group) => {
                const isToday = group.date === todayISO;
                return (
                  <div key={group.date || "tbd"} data-date={group.date}>
                    <div className={`lp-day-separator ${isToday ? "lp-day-today" : ""}`}>
                      <span className="lp-day-label">{isToday ? "Today" : group.label}</span>
                      <span className="lp-day-count">{group.items.length}</span>
                    </div>
                    {group.items.map((item) => {
                      const hasWriteup = Boolean(item.writeupUrl);
                      return (
                        <div
                          key={item.id}
                          className={`lp-item lp-item-game ${hasWriteup ? "wc-match-linked" : ""}`}
                          onClick={() => {
                            if (hasWriteup) {
                              window.open(item.writeupUrl!, "_blank");
                            } else {
                              onItemClick(item);
                            }
                          }}
                        >
                          <div className="lp-game-row">
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                              {item.homeFlag && <img src={item.homeFlag} alt="" className="lp-team-logo" />}
                              <div style={{ minWidth: 0 }}>
                                <p
                                  className="lp-item-label"
                                  style={{ margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                                >
                                  {item.homeName || "TBD"} vs {item.awayName || "TBD"}
                                </p>
                                <p className="lp-pitcher-names" style={{ margin: "2px 0 0" }}>
                                  {item.groupLetter
                                    ? `Group ${item.groupLetter} · ${item.venue || "Venue TBD"}`
                                    : `${formatStage(item.stage)} · ${item.venue || "Venue TBD"}`}
                                </p>
                              </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                              <span className="lp-game-time">
                                {item.kickoff
                                  ? new Date(item.kickoff).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                                  : "TBD"}
                              </span>
                              <span
                                className={`wc-status-dot ${hasWriteup ? "wc-dot-ready" : "wc-dot-pending"}`}
                                title={hasWriteup ? "Writeup published" : "No writeup yet"}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              });
            }

            if (mode === "facility") {
              const byState: Array<{ state: string; items: PanelItem[] }> = [];
              const stateMap = new Map<string, PanelItem[]>();
              for (const item of filtered) {
                const stateKey = String(item.facilityState || item.state || "UNSPECIFIED").toUpperCase();
                if (!stateMap.has(stateKey)) {
                  stateMap.set(stateKey, []);
                  byState.push({ state: stateKey, items: stateMap.get(stateKey)! });
                }
                stateMap.get(stateKey)!.push(item);
              }
              byState.sort((a, b) => a.state.localeCompare(b.state));

              return byState.map((group) => (
                <div key={group.state}>
                  <div className="lp-day-sep fac-state-header">
                    <span className="lp-day-label">{group.state}</span>
                    <span className="lp-day-count">{group.items.length}</span>
                  </div>
                  <div>
                    {group.items.map((item) => {
                      const active = Number(item.activeAssignments || 0);
                      const pending = Number(item.pendingStartAssignments || 0);
                      const pipeline = Number(item.pipelineAssignments || 0);
                      const hasStats = active > 0 || pending > 0 || pipeline > 0;
                      const isEasy = item.submissionDifficulty === "easy";
                      const rules = item.submittalRules || "";
                      const hasCompact = /compact/i.test(rules);
                      const hasLocals = /local/i.test(rules);
                      return (
                        <button
                          type="button"
                          key={item.id}
                          className={`lp-item lp-item-facility ${selectedItemId === item.id ? "lp-item-active" : ""}`}
                          onClick={() => onItemClick(item)}
                          aria-label={`Open facility ${item.facilityName || item.label}`}
                        >
                          <div className="fac-card-row">
                            <div className="fac-card-info">
                              <span className="fac-card-name">{item.facilityName || item.label}</span>
                              <span className="fac-card-loc">
                                {(item.facilityCity || "--")}{item.facilityState ? `, ${item.facilityState}` : ""}
                                {item.vmsPlatform ? ` · ${item.vmsPlatform}` : ""}
                              </span>
                              {(item.facilityProfileUrl || item.facilityNovaUrl || item.novaUrl) && (
                                <>
                                  <span className="sr-only">URL: {item.facilityProfileUrl || item.facilityNovaUrl || item.novaUrl}</span>
                                  <span className="aya-card-url" aria-hidden="true">
                                    {(item.facilityProfileUrl || item.facilityNovaUrl || item.novaUrl)?.replace(/^https?:\/\/(www\.)?/, '') || `nova/facility/${(item.facilityId || item.id).split('-').pop()}`}
                                  </span>
                                </>
                              )}
                              {!(item.facilityProfileUrl || item.facilityNovaUrl || item.novaUrl) && (
                                <>
                                  <span className="sr-only">URL: nova/facility/{item.facilityId || item.id}</span>
                                  <span className="aya-card-url" aria-hidden="true">
                                    nova/facility/{(item.facilityId || item.id).split('-').pop()}
                                  </span>
                                </>
                              )}
                            </div>
                            <div className="fac-card-icons">
                              {isEasy && <span className="fac-icon" title="Easy submittal">⚡</span>}
                              {hasCompact && <span className="fac-icon" title="Compact optional">🛡️</span>}
                              {hasLocals && <span className="fac-icon" title="Locals accepted">📍</span>}
                            </div>
                            {hasStats && (
                              <div className="fac-card-stats">
                                {active > 0 && <span className="fac-stat fac-stat-active">{active} Active</span>}
                                {pending > 0 && <span className="fac-stat fac-stat-pending">{pending} Pending</span>}
                                {pipeline > 0 && <span className="fac-stat fac-stat-pipeline">{pipeline} Pipeline</span>}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ));
            }

            if (mode === "margins") {
              const formatCurrency = (value: number | null | undefined) =>
                typeof value === "number" && Number.isFinite(value)
                  ? new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: "USD",
                    maximumFractionDigits: 0,
                  }).format(value)
                  : "--";
              const formatPercent = (value: number | null | undefined) =>
                typeof value === "number" && Number.isFinite(value)
                  ? `${(value * 100).toFixed(2)}%`
                  : "--";

              const handleSubTabChange = (tab: "jobs" | "margins") => {
                onMarginSubTabChange(tab);
              };

              const handleAttach = async (jobObjectId: string) => {
                if (!attachName.trim()) return;
                setAttachLoading(true);
                try {
                  const res = await fetch("/api/ayaops/jobs/attach", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      margin_object_id: jobObjectId,
                      candidate_name: attachName.trim(),
                    }),
                  });
                  if (!res.ok) {
                    const err = await res.json();
                    alert(err.error || "Failed to attach");
                    return;
                  }
                  setAttachJobId(null);
                  setAttachName("");
                  // Re-fetch to refresh the list
                  handleSubTabChange(marginSubTab);
                } catch {
                  alert("Network error");
                } finally {
                  setAttachLoading(false);
                }
              };

              return (
                <>
                  {/* Jobs / Margins tab toggle */}
                  <div className="margin-sub-tabs">
                    <button
                      className={`margin-sub-tab ${marginSubTab === "jobs" ? "active" : ""}`}
                      onClick={() => handleSubTabChange("jobs")}
                    >
                      Jobs
                    </button>
                    <button
                      className={`margin-sub-tab ${marginSubTab === "margins" ? "active" : ""}`}
                      onClick={() => handleSubTabChange("margins")}
                    >
                      Margins
                    </button>
                  </div>

                  {/* Job cards */}
                  {marginSubTab === "jobs" && filtered.map((item) => (
                    <div
                      key={item.id}
                      className={`lp-item lp-item-job ${selectedItemId === item.id ? "lp-item-active" : ""}`}
                    >
                      <button
                        type="button"
                        className="lp-job-body"
                        onClick={() => onItemClick(item)}
                      >
                        <div className="lp-flex-col">
                          <p className="lp-item-label">
                            {item.specialty || item.profession || "Role"}
                            {item.shiftType ? ` · ${item.shiftType.charAt(0).toUpperCase() + item.shiftType.slice(1)}` : ""}
                          </p>
                          <p className="lp-item-meta lp-margin-meta">
                            {item.facilityName || "--"}
                          </p>
                          {(item.assignmentStart || item.assignmentEnd) && (
                            <p className="lp-item-meta lp-margin-dates">
                              {formatShortDate(item.assignmentStart)} {item.assignmentEnd ? `→ ${formatShortDate(item.assignmentEnd)}` : ""}
                            </p>
                          )}
                        </div>
                        <div className="lp-margin-values">
                          {item.weeklyGross != null && (
                            <span className="lp-margin-gross">{formatCurrency(item.weeklyGross)}</span>
                          )}
                          {item.weeklyHours != null && (
                            <span className="lp-margin-pct">{item.weeklyHours}h/wk</span>
                          )}
                        </div>
                      </button>
                      {/* Attach action */}
                      {attachJobId === item.id ? (
                        <div className="lp-attach-form">
                          <input
                            type="text"
                            className="lp-attach-input"
                            placeholder="Candidate name..."
                            value={attachName}
                            onChange={(e) => setAttachName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleAttach(item.marginObjectId || item.id); }}
                            autoFocus
                          />
                          <button
                            className="lp-attach-btn"
                            disabled={attachLoading || !attachName.trim()}
                            onClick={() => handleAttach(item.marginObjectId || item.id)}
                          >
                            {attachLoading ? "..." : "Attach"}
                          </button>
                          <button
                            className="lp-attach-cancel"
                            onClick={() => { setAttachJobId(null); setAttachName(""); }}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          className="lp-attach-trigger"
                          onClick={(e) => { e.stopPropagation(); setAttachJobId(item.id); setAttachName(""); }}
                        >
                          Attach Candidate
                        </button>
                      )}
                    </div>
                  ))}

                  {/* Margin cards (existing) */}
                  {marginSubTab === "margins" && filtered.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className={`lp-item lp-item-margin ${selectedItemId === item.id ? "lp-item-active" : ""}`}
                      onClick={() => onItemClick(item)}
                      aria-label={`Open margin details for ${item.candidateName || item.label}`}
                    >
                      <div className="lp-flex-col">
                        <p className="lp-item-label">{item.candidateName || item.label}</p>
                        <p className="lp-item-meta lp-margin-meta">
                          {(item.facilityName || "--")}
                          {item.specialty ? ` · ${item.specialty}` : item.profession ? ` · ${item.profession}` : ""}
                        </p>
                        <p className="lp-item-meta lp-margin-dates">
                          {formatShortDate(item.assignmentStart)} {item.assignmentEnd ? `→ ${formatShortDate(item.assignmentEnd)}` : ""}
                        </p>
                      </div>
                      <div className="lp-margin-values">
                        <span className="lp-margin-gross">{formatCurrency(item.weeklyGross)}</span>
                        <span className="lp-margin-pct">{formatPercent(item.actualMarginPct)}</span>
                      </div>
                    </button>
                  ))}
                </>
              );
            }

            // AyaOps mode: candidates grouped by specialty (server-normalized)
            if (mode === "ayaops") {
              const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
              const fmtDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${MONTHS[+m - 1]} ${+d} '${y.slice(2)}`; };
              const workflowStates = [
                { key: "prospect", label: "Prospect" },
                { key: "working", label: "Working" },
                { key: "submitted", label: "Submitted" },
                { key: "offer", label: "Offer" },
                { key: "prestart", label: "Prestart" },
                { key: "completed", label: "Completed" },
              ] as const;
              const stateLabelMap: Record<string, string> = workflowStates.reduce((acc, state) => {
                acc[state.key] = state.label;
                return acc;
              }, {} as Record<string, string>);
              const statusMap: Record<string, string> = {
                review: "prospect",
                under_review: "prospect",
                working: "working",
                active: "working",
                on_assignment: "working",
                submitted: "submitted",
                submittal: "submitted",
                submitted_to_client: "submitted",
                in_pipeline: "submitted",
                offer: "offer",
                offered: "offer",
                offer_extended: "offer",
                prestart: "prestart",
                pre_start: "prestart",
                pending_start: "prestart",
                starting_soon: "prestart",
                restart: "prestart",
                completed: "completed",
                done: "completed",
              };
              const normalizeStatus = (item: PanelItem) => {
                const rawStatus = String(item.derivedCurrentStatus || item.assignmentStatus || "")
                  .toLowerCase()
                  .trim()
                  .replace(/[\s-]+/g, "_");
                if (!rawStatus) return "prospect";
                return statusMap[rawStatus] || "prospect";
              };

              // Stat counts
              const statCounts: Record<string, number> = {
                prospect: 0,
                working: 0,
                submitted: 0,
                offer: 0,
                prestart: 0,
                completed: 0,
              };
              for (const item of filtered) {
                const state = normalizeStatus(item);
                if (state in statCounts) statCounts[state]++;
              }

              // Apply status filter
              const statusFiltered = filtered.filter((it) => normalizeStatus(it) === statusFilter);

              // Build specialty counts for filter pills
              const specCounts = new Map<string, number>();
              for (const item of statusFiltered) {
                const s = item.specialty || "Unknown";
                specCounts.set(s, (specCounts.get(s) || 0) + 1);
              }
              const specEntries = [...specCounts.entries()].sort((a, b) => b[1] - a[1]);

              // Apply specialty filter
              const specFiltered = selectedSpecialty
                ? statusFiltered.filter(it => (it.specialty || "Unknown") === selectedSpecialty)
                : statusFiltered;

              const ranked = [...specFiltered].sort((a, b) => {
                const levelRank = (value?: string | null) => {
                  const key = String(value || "").toLowerCase();
                  if (key === "critical") return 5;
                  if (key === "high") return 4;
                  if (key === "medium") return 3;
                  if (key === "standard") return 2;
                  if (key === "low") return 1;
                  return 0;
                };
                const levelDiff = levelRank(b.touchPriorityLevel) - levelRank(a.touchPriorityLevel);
                if (levelDiff !== 0) return levelDiff;
                const scoreDiff = (b.touchPriorityScore || 0) - (a.touchPriorityScore || 0);
                if (scoreDiff !== 0) return scoreDiff;
                const aDays = a.touchDaysToEnd ?? 9999;
                const bDays = b.touchDaysToEnd ?? 9999;
                if (aDays !== bDays) return aDays - bDays;
                return (a.label || "").localeCompare(b.label || "");
              });

              return (
                <>
                  {/* Stat filter strip */}
                  <div className="lp-stat-filters">
                    {workflowStates.map((state) => (
                      <button
                        key={state.key}
                        className={`lp-sf ${statusFilter === state.key ? 'active' : ''} ${statCounts[state.key] === 0 ? 'is-zero' : ''}`}
                        onClick={() => setStatusFilter(state.key)}
                      >
                        <span className="lp-sf-num">{statCounts[state.key]}</span>
                        <span className="lp-sf-lbl">{state.label}</span>
                      </button>
                    ))}
                  </div>

                  {/* Specialty filter pills — horizontal scroll track */}
                  {specEntries.length > 1 && (
                    <div className="aya-spec-pills">
                      <button
                        className={`aya-spec-pill ${!selectedSpecialty ? 'active' : ''}`}
                        onClick={() => setSelectedSpecialty(null)}
                      >
                        All {statusFiltered.length}
                      </button>
                      {specEntries.map(([spec, count]) => (
                        <button
                          key={spec}
                          className={`aya-spec-pill ${selectedSpecialty === spec ? 'active' : ''}`}
                          onClick={() => setSelectedSpecialty(selectedSpecialty === spec ? null : spec)}
                        >
                          {spec} {count}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Flat matchup rows */}
                  {ranked.map((item) => {
                    const status = stateLabelMap[normalizeStatus(item)] || "Prospect";
                    const normalizedTouchReason = formatTouchPriorityReason(item.touchPriorityReason);
                    const score = typeof item.touchPriorityScore === "number" ? Math.round(item.touchPriorityScore) : null;
                    const scoreBadge =
                      typeof item.touchDaysToEnd === "number"
                        ? `${item.touchDaysToEnd}d`
                        : score !== null
                          ? `P${score}`
                          : null;
                    const heatBand = score !== null
                      ? score >= 80 ? "heat-urgent" : score >= 40 ? "heat-warm" : "heat-cold"
                      : item.touchPriorityBand === "today" ? "heat-urgent"
                        : item.touchPriorityBand === "this_week" ? "heat-warm"
                          : "heat-cold";
                    const tooltipText = normalizedTouchReason || (score !== null ? `Priority score: ${score}` : "");
                    return (
                      <div
                        key={item.id}
                        className="lp-item aya-candidate-card"
                      >
                        <div className="aya-card-collapsed">
                          <div className="aya-avatar">
                            {(item.label || "?").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                          </div>
                          <div className="aya-card-name-col">
                            {item.novaUrl ? (
                              <a
                                href={item.novaUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="lp-candidate-name-link"
                                onClick={e => e.stopPropagation()}
                              >{item.label}</a>
                            ) : (
                              <span className="lp-candidate-name-link">{item.label}</span>
                            )}
                            <span className="aya-card-meta">
                              {item.specialty || item.profession}
                              {item.homeState && ` · ${item.homeState}`}
                            </span>
                            {item.novaId ? (
                              <>
                                <span className="sr-only">URL: {item.novaUrl}</span>
                                <span className="aya-card-url" aria-hidden="true">
                                  nova/candidate/{item.novaId}
                                </span>
                              </>
                            ) : item.novaUrl ? (
                              <>
                                <span className="sr-only">URL: {item.novaUrl}</span>
                                <span className="aya-card-url" aria-hidden="true">
                                  nova/candidate/{item.novaUrl.split('/').pop()}
                                </span>
                              </>
                            ) : null}
                            {(item.rcThreadUrl || item.outlookThreadUrl || item.novaId) && (
                              <div className="aya-card-badges">
                                {item.novaId && (
                                  <a
                                    href={`/c/${item.novaId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="aya-hub-badge"
                                    onClick={e => e.stopPropagation()}
                                    title="Open Internal Profile"
                                  >
                                    File ↗
                                  </a>
                                )}
                                {item.rcThreadUrl && (
                                  <a
                                    href={item.rcThreadUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="aya-rc-badge"
                                    onClick={e => e.stopPropagation()}
                                    title="Open SMS Thread"
                                  >
                                    SMS ↗
                                  </a>
                                )}
                                {item.outlookThreadUrl && (
                                  <a
                                    href={item.outlookThreadUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="aya-outlook-badge"
                                    onClick={e => e.stopPropagation()}
                                    title="Open Email Thread"
                                  >
                                    Email ↗
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                          {/* Ghost action bar — visible on hover */}
                          <div className="aya-ghost-actions">
                            <button
                              type="button"
                              className="aya-ghost-btn"
                              title="Prep Note"
                              onClick={(e) => { e.stopPropagation(); onItemClick(item); }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                            </button>
                            {item.phone && (
                              <a
                                href={`rcapp://r/call?number=${encodeURIComponent(item.phone)}`}
                                className="aya-ghost-btn"
                                title="Call"
                                onClick={e => e.stopPropagation()}
                              >
                                <Phone size={14} />
                              </a>
                            )}
                            {item.novaUrl && (
                              <a
                                href={item.novaUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="aya-ghost-btn"
                                title="Open in Nova"
                                onClick={e => e.stopPropagation()}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                              </a>
                            )}
                          </div>
                          {/* Priority badge removed for demo Polish */}
                          <span className={`aya-status-dot aya-dot-${status.toLowerCase().replace(/\s+/g, '-')}`}
                            title={status}
                          />
                        </div>
                      </div>
                    );
                  })}
                </>
              );
            }

            // Healthcare: editorial licensing cards
            if (mode === "healthcare") {
              const profFiltered = professionFilter
                ? filtered.filter((item) => {
                  const p = (item.profession || "").toLowerCase();
                  return p === professionFilter.toLowerCase();
                })
                : filtered;
              return profFiltered.map((item) => {
                const slug = item.id || "";
                const refUrl = buildLicensingReferenceUrl(slug);
                const parsed = inferHealthcareContextFromLabel(item.label);
                const stateName = parsed.state || item.state || "";
                const professionName = parsed.profession || item.profession || "";
                const isActive = selectedItemId === item.id;
                const isCopied = copiedHcUrl === item.id;
                return (
                  <div
                    key={item.id}
                    className={`lp-hc-card ${isActive ? "lp-hc-active" : ""}`}
                  >
                    <button
                      className="lp-hc-body"
                      onClick={() => onItemClick(item)}
                      title={item.board || item.label}
                      type="button"
                    >
                      <div className="lp-hc-header">
                        <span className="lp-hc-state">{stateName}</span>
                        <span className="lp-hc-profession">{professionName}</span>
                      </div>
                      <div className="lp-hc-row-group">
                        {item.fee !== undefined && (
                          <div className="lp-hc-row">
                            <span className="lp-hc-row-key">{item.renewalFee ? "Initial" : "Fee"}</span>
                            <span className="lp-hc-row-val">${item.fee}</span>
                          </div>
                        )}
                        {item.renewalFee !== undefined && (
                          <div className="lp-hc-row">
                            <span className="lp-hc-row-key">Renewal</span>
                            <span className="lp-hc-row-val">${item.renewalFee}</span>
                          </div>
                        )}
                        {item.compact && (
                          <div className="lp-hc-row">
                            <span className="lp-hc-row-key">Compact</span>
                            <span className="lp-hc-row-val lp-hc-row-yes">Yes</span>
                          </div>
                        )}
                        {item.description && (
                          <div className="lp-hc-row">
                            <span className="lp-hc-row-key">Timeline</span>
                            <span className="lp-hc-row-val">{item.description}</span>
                          </div>
                        )}
                      </div>
                    </button>
                    {refUrl && (
                      <div className="lp-hc-link-row">
                        <a
                          className="lp-hc-link"
                          href={refUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title={`Open ${stateName} ${professionName} on State Licensing Reference`}
                        >
                          {refUrl.replace("https://www.", "")}
                        </a>
                        <button
                          type="button"
                          className="lp-hc-copy-btn"
                          title="Copy link"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(refUrl).then(() => {
                              setCopiedHcUrl(item.id);
                              setTimeout(() => setCopiedHcUrl(null), 1800);
                            });
                          }}
                        >
                          {isCopied ? <Check size={11} /> : <Copy size={11} />}
                        </button>
                      </div>
                    )}
                  </div>
                );
              });
            }

            if (mode === "code") {
              return filtered.map((item) => {
                const asCodeItem = item as any;
                return (
                <button
                  key={item.id}
                  className={`lp-item lp-item-code ${selectedItemId === item.id ? "lp-active" : ""}`}
                  onClick={() => onItemClick(item)}
                  title={item.label}
                >
                  <span className="lp-item-label">{item.label}</span>
                  {asCodeItem.category && <span className="lp-item-meta">{asCodeItem.category} ({item.status})</span>}

                  {/* Browser Agent Payload - Grounding Target */}
                  <div className="sr-only"
                    data-grounding-type="ARCHITECTURE_VERDICT"
                    data-verdict-id={item.id}
                    data-agent={asCodeItem.agent || ""}
                    data-status={item.status || ""}
                    data-risk-zones={(asCodeItem.riskZones || []).join(",")}
                  >
                    [VERDICT]: {item.label}
                    Agent: {asCodeItem.agent}
                    Status: {item.status}
                    Preview: {asCodeItem.preview}
                    Use the 'verdicts' tools to write or list decisions.
                  </div>
                </button>
              )});
            }

            // Other non-sports modes: flat list
            return filtered.map((item) => (
              <button
                key={item.id}
                className="lp-item"
                onClick={() => onItemClick(item)}
                title={item.board || item.label}
              >
                <span className="lp-item-label">{item.label}</span>
                {item.fee !== undefined && (
                  <span className="lp-item-meta">${item.fee}</span>
                )}
                {item.description && (
                  <span className="lp-item-desc">{item.description}</span>
                )}
              </button>
            ));
          })()
        )}
      </div>
    </aside>
  );
}

// --- Right Panel (Sources) ---
function RightPanel({
  citations,
  queries,
  recentImages,
  imagesLoading,
  onUseImage,
  onTogglePin,
  onLinkCandidate,
  selectedCandidateId,
  onClose,
}: {
  citations: Citation[];
  queries: string[];
  recentImages: SavedImage[];
  imagesLoading: boolean;
  onUseImage: (image: SavedImage) => void;
  onTogglePin: (image: SavedImage) => void;
  onLinkCandidate: (image: SavedImage) => void;
  selectedCandidateId: string | null;
  onClose: () => void;
}) {
  return (
    <aside className="rp-shell">
      <div className="rp-header">
        <h2 className="rp-title">Sources</h2>
        <button className="rp-close" onClick={onClose}>
          <X size={14} />
        </button>
      </div>

      {queries.length > 0 && (
        <div className="rp-section">
          <h3 className="rp-section-title">Search queries</h3>
          <div className="rp-queries">
            {queries.map((q, i) => (
              <span key={i} className="rp-query" title={q}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="rp-query-icon"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
                {q}
              </span>
            ))}
          </div>
        </div>
      )}

      {citations.length > 0 && (
        <div className="rp-section">
          <h3 className="rp-section-title">
            {citations.length} source{citations.length > 1 ? "s" : ""}
          </h3>
          <div className="rp-sources">
            {citations.map((c, i) => {
              const domain = extractDomain(c.uri);
              const siteName = domain.replace(/^www\./, '').split('.')[0];
              const displayName = siteName.charAt(0).toUpperCase() + siteName.slice(1);
              const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
              return (
                <a
                  key={i}
                  className="rp-source-card"
                  href={c.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img src={faviconUrl} alt="" className="rp-source-favicon" />
                  <div className="rp-source-info">
                    <span className="rp-source-title">{c.title || displayName}</span>
                    <span className="rp-source-domain">{displayName}</span>
                  </div>
                  <span className="rp-source-arrow">↗</span>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {queries.length > 0 && citations.length === 0 && (
        <div className="rp-section">
          <div className="rp-images-empty">Search ran, but no source links were returned for this answer.</div>
        </div>
      )}

      <div className="rp-section">
        <h3 className="rp-section-title">Recent screenshots</h3>
        {imagesLoading ? (
          <div className="rp-images-empty">Loading…</div>
        ) : recentImages.length === 0 ? (
          <div className="rp-images-empty">No saved screenshots yet.</div>
        ) : (
          <div className="rp-images">
            {recentImages.map((image) => {
              const created = new Date(image.createdAt);
              const timeLabel = Number.isNaN(created.getTime())
                ? image.createdAt
                : created.toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                });

              return (
                <div key={image.imageId} className="rp-image-card">
                  <button
                    className="rp-image-thumb-wrap"
                    onClick={() => onUseImage(image)}
                    title="Use this screenshot in chat"
                  >
                    <img src={image.previewUrl} alt="Saved screenshot" className="rp-image-thumb" />
                  </button>
                  <div className="rp-image-meta">
                    <div className="rp-image-top">
                      <span className="rp-image-time">{timeLabel}</span>
                      {image.isPinned && <span className="rp-image-pin">Pinned</span>}
                    </div>
                    <div className="rp-image-sub">
                      {image.candidateName || image.candidateId || "Unlinked"}
                      {image.screenType ? ` · ${image.screenType}` : ""}
                    </div>
                    <div className="rp-image-actions">
                      <button className="rp-image-action" onClick={() => onUseImage(image)}>Use in chat</button>
                      <button className="rp-image-action" onClick={() => onTogglePin(image)}>
                        {image.isPinned ? "Unpin" : "Pin"}
                      </button>
                      <a
                        className="rp-image-action"
                        href={image.previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open
                      </a>
                      <button
                        className="rp-image-action"
                        onClick={() => onLinkCandidate(image)}
                        disabled={!selectedCandidateId || image.candidateId === selectedCandidateId}
                      >
                        Link to candidate
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

function CapabilityDropdown({
  value,
  onChange,
  disabled,
  mode,
}: {
  value: ModelOverride;
  onChange: (value: ModelOverride) => void;
  disabled?: boolean;
  mode: ConsoleMode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isOpsWorkspace = mode === "ayaops" || mode === "facility" || mode === "margins";

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  const current = CAPABILITY_OPTIONS.find((option) => option.value === value) || CAPABILITY_OPTIONS[0];

  return (
    <div className="cap-dropdown" ref={ref}>
      <button
        type="button"
        className="cap-btn"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        disabled={disabled}
      >
        <span>{current.label}</span>
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="cap-menu">
          {CAPABILITY_OPTIONS.map((option) => {
            const locked = isOpsWorkspace && (option.value === "sonnet" || option.value === "opus");
            return (
              <button
                key={option.value}
                type="button"
                className={`cap-item ${value === option.value ? "active" : ""}`}
                onClick={() => {
                  if (!locked) {
                    onChange(option.value);
                    setOpen(false);
                  }
                }}
                disabled={locked}
                title={locked ? "Unavailable in this workspace" : undefined}
              >
                {value === option.value && <span className="cap-dot" />}
                <span>{option.label}</span>
                <span className="cap-hint">{option.hint}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Main Component ---
export default function ChatPage() {
  const { user } = useAuth();
  const [state, dispatch] = useReducer(chatReducer, {
    messages: [], input: "", loading: false, copiedId: null, pendingImage: null, mode: "sports" as ConsoleMode, selectedCandidate: null,
  });
  const [selectedWorkspaceItem, setSelectedWorkspaceItem] = useState<PanelItem | null>(null);

  // Workspace state
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [panelFilter, setPanelFilter] = useState("");
  const [marginSubTab, setMarginSubTab] = useState<"jobs" | "margins">("jobs");
  const [rightPanelMode, setRightPanelMode] = useState<SandboxPanelMode>("closed");
  const [sourcesMsg, setSourcesMsg] = useState<Message | null>(null);
  const [sandboxTasks, setSandboxTasks] = useState<SandboxTask[]>([]);
  const [activeSandboxId, setActiveSandboxId] = useState<string | null>(null);
  const [pendingSandboxCommitId, setPendingSandboxCommitId] = useState<string | null>(null);
  const [modelOverride, setModelOverride] = useState<ModelOverride>("auto");
  const [expandedWritePayloads, setExpandedWritePayloads] = useState<Set<string>>(new Set());
  const [recentImages, setRecentImages] = useState<SavedImage[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [pendingSavedImage, setPendingSavedImage] = useState<SavedImage | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [approvingSnapshotMessageId, setApprovingSnapshotMessageId] = useState<string | null>(null);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);

  // Artifact Canvas
  const [artifactContent, setArtifactContent] = useState<string | null>(null);
  const [artifactTitle, setArtifactTitle] = useState("");


  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRaf = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const conversationIdRef = useRef<string>("");
  const announcedSandboxTasksRef = useRef<Set<string>>(new Set());
  const lastAutoOpenedMsgIdRef = useRef<string | null>(null);

  const modeConfig = MODES[state.mode];
  const isOpsMode = state.mode === "ayaops" || state.mode === "facility" || state.mode === "margins";
  const isReadWorkspaceMode = state.mode === "facility" || state.mode === "margins";
  const activeWorkspaceScope = useMemo(
    () => workspaceScopeFor(state.mode, selectedWorkspaceItem),
    [state.mode, selectedWorkspaceItem],
  );
  const visibleMessages = useMemo(
    () => (
      activeWorkspaceScope
        ? state.messages.filter((message) => message.workspaceScope === activeWorkspaceScope)
        : state.messages
    ),
    [activeWorkspaceScope, state.messages],
  );
  const todayCards = useMemo(() => buildTodayCards(state.mode, summary), [state.mode, summary]);

  const marginTimeline = useMemo(
    () =>
      state.mode === "margins" && selectedWorkspaceItem
        ? assignmentProgress(selectedWorkspaceItem.assignmentStart, selectedWorkspaceItem.assignmentEnd)
        : null,
    [state.mode, selectedWorkspaceItem],
  );

  const formatMoney = useCallback((value: number | null | undefined) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "--";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  }, []);

  const formatPct = useCallback((value: number | null | undefined) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "--";
    return `${(value * 100).toFixed(2)}%`;
  }, []);

  const ensureConversationId = useCallback((mode: ConsoleMode) => {
    try {
      const key = `evidence-conversation-${mode}`;
      let id = localStorage.getItem(key);
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(key, id);
      }
      conversationIdRef.current = id;
    } catch {
      conversationIdRef.current = uid();
    }
  }, []);

  const fetchRecentImages = useCallback(async () => {
    setImagesLoading(true);
    try {
      const params = new URLSearchParams({
        limit: "10",
        mode: state.mode,
      });
      const res = await fetch(`/api/evidence/recent?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json() as { images?: SavedImage[] };
      setRecentImages(data.images || []);
    } catch {
      // Sources list is optional UX context.
    } finally {
      setImagesLoading(false);
    }
  }, [state.mode]);

  // Fetch summary when mode changes
  const fetchSummary = useCallback(async (mode: ConsoleMode) => {
    setSummaryLoading(true);
    setSummaryError(null);
    setPanelFilter("");
    try {
      const fetchMode = mode === "margins" ? marginSubTab : mode;
      const res = await fetch(`/api/summary?mode=${fetchMode}`);
      if (res.ok) {
        const data = await res.json() as unknown;
        if (!data || typeof data !== "object") {
          throw new Error("Invalid summary response: expected object payload.");
        }
        const payload = data as Record<string, unknown>;
        const pulseRaw =
          payload.pulse && typeof payload.pulse === "object"
            ? (payload.pulse as Record<string, unknown>)
            : {};
        const pulse = Object.fromEntries(
          Object.entries(pulseRaw).map(([k, v]) => [k, readNumberSafe(v) ?? 0]),
        ) as Record<string, number>;
        const rawItems = Array.isArray(payload.items) ? payload.items : [];

        const normalizedItems: PanelItem[] =
          mode === "facility"
            ? rawItems
              .map((entry, index) => {
                if (!entry || typeof entry !== "object") return null;
                const row = entry as Record<string, unknown>;
                const id = readStringSafe(row.id) || `facility-${index + 1}`;
                const label = readStringSafe(row.label) || readStringSafe(row.facilityName) || id;
                return {
                  id,
                  label,
                  facilityId: readStringSafe(row.facilityId) || id,
                  facilitySystemName: readStringSafe(row.facilitySystemName) || null,
                  facilityProfileUrl: readStringSafe(row.facilityProfileUrl) || null,
                  facilityName: readStringSafe(row.facilityName) || null,
                  facilityCity: readStringSafe(row.facilityCity) || null,
                  facilityState: readStringSafe(row.facilityState) || null,
                  vmsPlatform: readStringSafe(row.vmsPlatform) || null,
                  facilityBeds: readNumberSafe(row.facilityBeds),
                  acceptsLocals: row.acceptsLocals == null ? null : Boolean(row.acceptsLocals),
                  requiresCompact: row.requiresCompact == null ? null : Boolean(row.requiresCompact),
                  submittalRules: readStringSafe(row.submittalRules) || null,
                  submissionDifficulty:
                    row.submissionDifficulty === "easy" ||
                      row.submissionDifficulty === "moderate" ||
                      row.submissionDifficulty === "hard"
                      ? row.submissionDifficulty
                      : null,
                  payVsLocalCol: readStringSafe(row.payVsLocalCol) || null,
                  parkingCost: readStringSafe(row.parkingCost) || null,
                  cancelRatePct: readPercentDecimal(row.cancelRatePct),
                  extensionRatePct: readPercentDecimal(row.extensionRatePct),
                  closedAssignments: readNumberSafe(row.closedAssignments),
                  activeAssignments: readNumberSafe(row.activeAssignments),
                  pendingStartAssignments: readNumberSafe(row.pendingStartAssignments),
                  pipelineAssignments: readNumberSafe(row.pipelineAssignments),
                  totalAssignments: readNumberSafe(row.totalAssignments),
                } as PanelItem;
              })
              .filter((item): item is PanelItem => Boolean(item))
            : mode === "margins"
              ? rawItems
                .map((entry, index) => {
                  if (!entry || typeof entry !== "object") return null;
                  const row = entry as Record<string, unknown>;
                  const id = readStringSafe(row.id) || `margin-${index + 1}`;
                  const label = readStringSafe(row.label) || readStringSafe(row.candidateName) || id;
                  return {
                    id,
                    label,
                    marginObjectId: readStringSafe(row.marginObjectId) || id,
                    candidateName: readStringSafe(row.candidateName) || null,
                    candidateId: readStringSafe(row.candidateId) || null,
                    candidateEmail: readStringSafe(row.candidateEmail) || null,
                    novaUrl: readStringSafe(row.novaUrl) || null,
                    facilityName: readStringSafe(row.facilityName) || null,
                    facilityCity: readStringSafe(row.facilityCity) || null,
                    facilityState: readStringSafe(row.facilityState) || null,
                    profession: readStringSafe(row.profession) || undefined,
                    specialty: readStringSafe(row.specialty) || undefined,
                    assignmentStart: readStringSafe(row.assignmentStart) || null,
                    assignmentEnd: readStringSafe(row.assignmentEnd) || null,
                    shiftType: readStringSafe(row.shiftType) || null,
                    shiftStart: readStringSafe(row.shiftStart) || null,
                    shiftEnd: readStringSafe(row.shiftEnd) || null,
                    weeklyHours: readNumberSafe(row.weeklyHours),
                    weeklyGross: readNumberSafe(row.weeklyGross),
                    weeklyStipends: readNumberSafe(row.weeklyStipends),
                    basePayRate: readNumberSafe(row.basePayRate),
                    targetMarginPct: readPercentDecimal(row.targetMarginPct),
                    actualMarginPct: readPercentDecimal(row.actualMarginPct),
                    grossWeeklyPayComputed: readNumberSafe(row.grossWeeklyPayComputed),
                    marginId: readStringSafe(row.marginId) || null,
                    jobId: readStringSafe(row.jobId) || null,
                    source: readStringSafe(row.source) || undefined,
                    lastSeenAt: readStringSafe(row.lastSeenAt) || null,
                    isLocal: row.isLocal == null ? null : Boolean(row.isLocal),
                    isCompact: row.isCompact == null ? null : Boolean(row.isCompact),
                  } as PanelItem;
                })
                .filter((item): item is PanelItem => Boolean(item))
              : rawItems.filter((entry): entry is PanelItem => Boolean(entry && typeof entry === "object")) as PanelItem[];

        setSummary({
          pulse,
          items: normalizedItems,
          supportedLeagues: Array.isArray(payload.supportedLeagues)
            ? payload.supportedLeagues as { key: string; label: string }[]
            : undefined,
          topProfessions: Array.isArray(payload.topProfessions)
            ? payload.topProfessions as { name: string; count: number }[]
            : undefined,
        });
      } else {
        let errorMessage = `Summary request failed (${res.status})`;
        try {
          const errorPayload = await res.json() as { error?: string; code?: string };
          if (errorPayload?.error) errorMessage = errorPayload.error;
          if (errorPayload?.code) errorMessage = `${errorMessage} [${errorPayload.code}]`;
        } catch {
          // Keep status-based fallback message.
        }
        setSummaryError(errorMessage);
        setSummary(null);
      }
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : "Summary fetch failed.");
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [marginSubTab]);

  // Hydrate
  useEffect(() => {
    const savedMode = getSavedMode();
    dispatch({ type: "SET_MODE", payload: savedMode });
    const saved = loadFromStorage(savedMode);
    if (saved.length > 0) dispatch({ type: "HYDRATE", payload: saved });
    ensureConversationId(savedMode);
    fetchSummary(savedMode);
  }, [ensureConversationId, fetchSummary]);

  useEffect(() => {
    ensureConversationId(state.mode);
    void fetchRecentImages();
  }, [state.mode, ensureConversationId, fetchRecentImages]);

  // Persist
  useEffect(() => {
    if (state.messages.length > 0) saveToStorage(state.mode, state.messages);
  }, [state.messages, state.mode]);

  // Re-fetch when marginSubTab changes
  useEffect(() => {
    if (state.mode === "margins") {
      fetchSummary(state.mode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marginSubTab]);

  // Auto-open sources when latest message gets grounding
  useEffect(() => {
    const lastAssistant = [...visibleMessages].reverse().find(m => m.role === "assistant");
    if (!lastAssistant) return;

    if (
      rightPanelMode !== "sandbox" &&
      ((lastAssistant.citations && lastAssistant.citations.length > 0) ||
        (lastAssistant.queries && lastAssistant.queries.length > 0)) &&
      !lastAssistant.isStreaming &&
      lastAutoOpenedMsgIdRef.current !== lastAssistant.id
    ) {
      lastAutoOpenedMsgIdRef.current = lastAssistant.id;
      setSourcesMsg(lastAssistant);
      setRightPanelMode("sources");
    }
  }, [rightPanelMode, visibleMessages]);

  const switchMode = useCallback((newMode: ConsoleMode) => {
    if (newMode === state.mode || state.loading) return;
    saveToStorage(state.mode, state.messages);
    dispatch({ type: "SET_MODE", payload: newMode });
    setSelectedWorkspaceItem(null);
    setMobileRailOpen(false);
    localStorage.setItem(MODE_KEY, newMode);
    const saved = loadFromStorage(newMode);
    dispatch({ type: "HYDRATE", payload: saved });
    setRightPanelMode("closed");
    setSourcesMsg(null);
    setPendingSavedImage(null);
    fetchSummary(newMode);
  }, [state.mode, state.messages, state.loading, fetchSummary]);

  useEffect(() => {
    if (!isReadWorkspaceMode) {
      setSelectedWorkspaceItem(null);
      return;
    }
    const items = summary?.items || [];
    if (items.length === 0) {
      setSelectedWorkspaceItem(null);
      return;
    }
    setSelectedWorkspaceItem((current) => {
      if (!current) return items[0];
      const matched = items.find((item) => item.id === current.id);
      return matched || items[0];
    });
  }, [isReadWorkspaceMode, summary]);

  const scrollToBottom = useCallback(() => {
    if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  }, []);

  useEffect(() => { scrollToBottom(); }, [visibleMessages, state.loading, scrollToBottom]);

  const copyToClipboard = async (
    text: string,
    msgId: string,
    modeForCopy: ConsoleMode,
    options?: { primaryOnly?: boolean },
  ) => {
    try {
      const useCleanCopy = CLEAN_COPY_MODES.has(modeForCopy);
      const display = useCleanCopy ? buildAssistantDisplayContent(text, modeForCopy) : null;
      const baseText = display ? display.visibleMarkdown : text;
      const primaryBlock = useCleanCopy ? extractPrimaryCopyBlock(baseText) : null;
      const copyText =
        useCleanCopy
          ? options?.primaryOnly
            ? primaryBlock || formatCopyReadyText(baseText)
            : formatCopyReadyText(baseText)
          : text;
      await navigator.clipboard.writeText(copyText);
      dispatch({ type: "SET_COPIED", payload: msgId });
      setTimeout(() => dispatch({ type: "SET_COPIED", payload: null }), 2000);
    } catch { /* clipboard blocked */ }
  };

  // Image handling
  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    if (file.size > 10 * 1024 * 1024) { alert("Image must be under 10MB"); return; }
    const reader = new FileReader();
    reader.onloadend = async () => {
      const imageDataUrl = reader.result as string;
      dispatch({ type: "SET_PENDING_IMAGE", payload: imageDataUrl });
      setPendingSavedImage(null);
      setUploadingImage(true);
      try {
        const res = await fetch("/api/evidence/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageDataUrl,
            sourceType: isOpsMode ? "nova" : "chat_upload",
            screenType: "unknown",
            mode: state.mode,
            uploadedBy: user?.uid || null,
            conversationId: conversationIdRef.current || null,
            candidateId: state.selectedCandidate?.id || null,
            tags: [state.mode],
            isPinned: true,
          }),
        });
        if (res.ok) {
          void fetchRecentImages();
        }
      } catch {
        // Persist failure should not block immediate chat usage.
      } finally {
        setUploadingImage(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) handleFileSelect(file);
        return;
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) handleFileSelect(file);
  };

  const appendAssistantSystemMessage = useCallback((text: string) => {
    dispatch({
      type: "ADD_ASSISTANT_MESSAGE",
      payload: {
        id: uid(),
        text,
        workspaceScope: activeWorkspaceScope,
      },
    });
  }, [activeWorkspaceScope]);

  // Inject context from left panel
  const handlePanelItemClick = async (item: PanelItem) => {
    setMobileRailOpen(false);
    if (state.mode === "healthcare") {
      setSelectedWorkspaceItem(item);
      dispatch({ type: "SET_SELECTED_CANDIDATE", payload: null });
      const url = buildLicensingReferenceUrl(item.id);
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        const context = `Tell me about the ${item.profession || ""} license in ${item.state || item.label}`;
        dispatch({ type: "SET_INPUT", payload: context });
        inputRef.current?.focus();
      }
      return;
    }

    if (state.mode === "sports") {
      setSelectedWorkspaceItem(null);
      const matchup = item.away && item.home
        ? `${item.away} vs ${item.home}`
        : item.label;
      dispatch({ type: "SET_SELECTED_CANDIDATE", payload: null });
      dispatch({ type: "SET_INPUT", payload: `What's the latest on ${matchup}?` });
      inputRef.current?.focus();
      return;
    }

    if (state.mode === "worldcup") {
      setSelectedWorkspaceItem(null);
      const matchup = item.homeName && item.awayName
        ? `${item.homeName} vs ${item.awayName}`
        : item.label;
      dispatch({ type: "SET_SELECTED_CANDIDATE", payload: null });
      dispatch({ type: "SET_INPUT", payload: `What's the latest on ${matchup}?` });
      inputRef.current?.focus();
      return;
    }

    if (state.mode === "facility") {
      setSelectedWorkspaceItem(item);
      setSourcesMsg(null);
      setRightPanelMode("closed");
      dispatch({ type: "SET_SELECTED_CANDIDATE", payload: null });
      dispatch({
        type: "SET_INPUT",
        payload: `Summarize assignment pressure and operational priorities for ${item.facilityName || item.label}.`,
      });
      inputRef.current?.focus();
      return;
    }

    if (state.mode === "margins") {
      setSelectedWorkspaceItem(item);
      setSourcesMsg(null);
      setRightPanelMode("closed");
      dispatch({ type: "SET_SELECTED_CANDIDATE", payload: null });
      dispatch({
        type: "SET_INPUT",
        payload: "What's the read on this margin?",
      });
      inputRef.current?.focus();
      return;
    }

    if (state.mode === "ayaops" && item.id) {
      setSelectedWorkspaceItem(null);
      try {
        const res = await fetch(`/api/candidates/${item.id}`);
        if (res.ok) {
          const data = await res.json();
          dispatch({
            type: "SET_SELECTED_CANDIDATE",
            payload: {
              id: item.id,
              name: data.candidate.name || item.label,
              candidate: data.candidate,
              contextText: data.contextText,
            },
          });
          const scorePrefix =
            typeof item.touchPriorityScore === "number"
              ? `Priority score ${item.touchPriorityScore}/100${item.touchPriorityReason ? ` (${item.touchPriorityReason})` : ""}. `
              : "";
          const noteSeed = item.touchNoteSeed ? `Use this outreach context: ${item.touchNoteSeed}. ` : "";
          dispatch({
            type: "SET_INPUT",
            payload:
              `${scorePrefix}Summarize ${data.candidate.name || item.label}'s current status, then draft a short recruiter touch-base note I can paste into the record today. ${noteSeed}`.trim(),
          });
          inputRef.current?.focus();
          return;
        }
      } catch {
        // Fallback to simple label
      }
    }

    setSelectedWorkspaceItem(null);
    dispatch({ type: "SET_SELECTED_CANDIDATE", payload: null });
    dispatch({ type: "SET_INPUT", payload: item.description || item.label });
    inputRef.current?.focus();
  };

  const handleUseSavedImage = (image: SavedImage) => {
    dispatch({ type: "SET_PENDING_IMAGE", payload: null });
    setPendingSavedImage(image);
    inputRef.current?.focus();
  };

  const handleToggleImagePin = async (image: SavedImage) => {
    try {
      await fetch("/api/evidence/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId: image.imageId, isPinned: !image.isPinned }),
      });
      void fetchRecentImages();
    } catch {
      // Non-blocking UI action.
    }
  };

  const resolveHealthcareContextForMessage = useCallback(
    (assistantMessageId: string, assistantText: string) => {
      const selectedState = readStringSafe(selectedWorkspaceItem?.state);
      const selectedProfession = readStringSafe(selectedWorkspaceItem?.profession);
      if (selectedState && selectedProfession) {
        return { state: selectedState, profession: selectedProfession };
      }

      const selectedLabelContext = inferHealthcareContextFromLabel(
        readStringSafe(selectedWorkspaceItem?.label),
      );
      if (selectedLabelContext.state && selectedLabelContext.profession) {
        return selectedLabelContext;
      }

      const inferredFromAssistant = inferHealthcareContextFromPrompt(assistantText);
      if (inferredFromAssistant.state && inferredFromAssistant.profession) {
        return inferredFromAssistant;
      }

      const assistantIndex = state.messages.findIndex((message) => message.id === assistantMessageId);
      if (assistantIndex < 0) {
        return {
          state: selectedState || selectedLabelContext.state || null,
          profession: selectedProfession || selectedLabelContext.profession || null,
        };
      }

      for (let i = assistantIndex - 1; i >= 0; i -= 1) {
        const prior = state.messages[i];
        if (!prior) continue;
        if (prior.role === "user") {
          const inferred = inferHealthcareContextFromPrompt(prior.text);
          if (inferred.state && inferred.profession) return inferred;
        } else if (prior.role === "assistant") {
          const inferred = inferHealthcareContextFromPrompt(prior.text);
          if (inferred.state && inferred.profession) return inferred;
        }
      }

      return {
        state: selectedState || selectedLabelContext.state || null,
        profession: selectedProfession || selectedLabelContext.profession || null,
      };
    },
    [selectedWorkspaceItem?.label, selectedWorkspaceItem?.profession, selectedWorkspaceItem?.state, state.messages],
  );

  const handleApproveHealthcareSnapshot = useCallback(
    async (message: Message) => {
      const context = resolveHealthcareContextForMessage(message.id, message.text);
      if (!context.state || !context.profession) {
        appendAssistantSystemMessage(
          "Select a state/profession row in Healthcare first, then approve the snapshot.",
        );
        return;
      }

      setApprovingSnapshotMessageId(message.id);
      try {
        const approvalBody = {
          state: context.state,
          profession: context.profession,
          category: "licensing",
          answer_text: message.text,
          search_queries: message.queries || [],
          source_refs: message.citations || [],
          approved_by: user?.email || user?.uid || "local_user",
          raw_answer_json: {
            mode: "healthcare",
            message_id: message.id,
            model_provider: message.modelProvider || null,
            model_id: message.modelId || null,
            answer_text: message.text,
          },
        };

        const res = await fetch("/api/licensing/research/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(approvalBody),
        });

        const payload = await res.json().catch(() => null) as
          | { result?: Record<string, unknown>; error?: string }
          | null;
        if (!res.ok) {
          throw new Error(payload?.error || `Approval failed (${res.status})`);
        }

        const result = asRecord(payload?.result) || {};
        const isFirstVersion = Boolean(result.is_first_version);
        const hasMaterialChange = Boolean(result.has_material_change);
        const outcome: WriteOutcome = isFirstVersion
          ? "inserted"
          : hasMaterialChange
            ? "updated"
            : "no_change";
        const changedFieldNames = Array.isArray(result.changed_field_names)
          ? result.changed_field_names.map((entry) => readStringSafe(entry)).filter(Boolean)
          : [];

        dispatch({
          type: "SET_ASSISTANT_WRITE_RESULT",
          payload: {
            id: message.id,
            writeResult: {
              outcome,
              action: "approve_research_snapshot",
              objectType: "healthcare_research_snapshot",
              rowsUpdated: 1,
              code: null,
              payload: result,
            },
          },
        });

        const summaryLine = readStringSafe(result.change_summary);
        if (isFirstVersion) {
          appendAssistantSystemMessage(
            `✓ Approved snapshot saved for ${context.state} · ${context.profession}. First approved version captured.`,
          );
        } else {
          appendAssistantSystemMessage(
            `✓ Approved snapshot saved for ${context.state} · ${context.profession}. ${summaryLine || "Comparison recorded."}`,
          );
        }

        if (changedFieldNames.length > 0) {
          appendAssistantSystemMessage(
            `Changed fields: ${changedFieldNames.slice(0, 6).join(", ")}${changedFieldNames.length > 6 ? "…" : ""}`,
          );
        }
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Approval failed";
        appendAssistantSystemMessage(`✗ Snapshot approval failed: ${messageText}`);
      } finally {
        setApprovingSnapshotMessageId(null);
      }
    },
    [appendAssistantSystemMessage, resolveHealthcareContextForMessage, user?.email, user?.uid],
  );

  const handleLinkImageCandidate = async (image: SavedImage) => {
    const candidateId = state.selectedCandidate?.id;
    if (!candidateId) return;
    try {
      await fetch("/api/evidence/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId: image.imageId, candidateId }),
      });
      void fetchRecentImages();
    } catch {
      // Non-blocking UI action.
    }
  };

  const upsertSandboxTask = useCallback((task: SandboxTask) => {
    setSandboxTasks((current) => {
      const index = current.findIndex((item) => item.taskId === task.taskId);
      if (index < 0) return [...current, task];
      const next = [...current];
      next[index] = task;
      return next;
    });
    setActiveSandboxId(task.taskId);
    setRightPanelMode("sandbox");
  }, []);

  const updateSandboxTask = useCallback((taskId: string, updater: (task: SandboxTask) => SandboxTask) => {
    setSandboxTasks((current) =>
      current.map((task) => (task.taskId === taskId ? updater(task) : task)),
    );
  }, []);

  const handleApproveSandboxTask = useCallback(async (taskId: string, mode: "default" | "send_now" = "default") => {
    const task = sandboxTasks.find((item) => item.taskId === taskId);
    if (!task) return;

    let commitAction: CommitAction = task.commitAction;
    if (task.preview.type === "email_draft" && mode === "send_now") {
      commitAction = {
        type: "send_email_now",
        templateId: task.preview.templateId,
        candidateId: task.preview.candidateId || "",
        jobId: task.preview.jobId,
        toEmail: task.preview.toEmail,
        cc: task.preview.cc,
        subject: task.preview.subject,
        body: task.preview.body,
        noteContent: [
          "Email sent",
          `Template: ${task.preview.templateId}`,
          `Subject: ${task.preview.subject}`,
          `Recipient: ${task.preview.toEmail}`,
          "Status: Sent",
        ].join("\n"),
      };
    }

    setPendingSandboxCommitId(taskId);
    updateSandboxTask(taskId, (current) => ({
      ...current,
      status: "executing",
      error: null,
    }));

    try {
      const res = await fetch("/api/sandbox/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          commitAction,
        }),
      });

      const payload = await res.json() as {
        status?: string;
        error?: string;
        result?: Record<string, unknown> & { action?: string };
      };

      if (!res.ok || payload.status !== "executed") {
        const error = payload.error || `Commit failed (${res.status})`;
        updateSandboxTask(taskId, (current) => ({
          ...current,
          status: "failed",
          error,
          resolvedAt: new Date(),
        }));
        appendAssistantSystemMessage(`✗ Failed: ${error}`);
        return;
      }

      updateSandboxTask(taskId, (current) => ({
        ...current,
        status: "executed",
        error: null,
        resolvedAt: new Date(),
      }));
      const actionName = payload.result?.action || "";
      if (actionName === "send_email_now") {
        appendAssistantSystemMessage(`✓ Sent: ${task.title}`);
      } else if (actionName === "create_email_draft") {
        appendAssistantSystemMessage(`✓ Draft saved: ${task.title}`);
      } else if (actionName === "create_agent_handoff_task") {
        const handoffUrl =
          typeof payload.result?.handoff_url === "string" && payload.result.handoff_url
            ? payload.result.handoff_url
            : null;
        if (handoffUrl) {
          appendAssistantSystemMessage(`✓ Handoff ready: ${task.title}\n${handoffUrl}`);
        } else {
          appendAssistantSystemMessage(`✓ Handoff task created: ${task.title}`);
        }
      } else {
        appendAssistantSystemMessage(`✓ Published: ${task.title}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sandbox commit error";
      updateSandboxTask(taskId, (current) => ({
        ...current,
        status: "failed",
        error: message,
        resolvedAt: new Date(),
      }));
      appendAssistantSystemMessage(`✗ Failed: ${message}`);
    } finally {
      setPendingSandboxCommitId(null);
    }
  }, [appendAssistantSystemMessage, sandboxTasks, updateSandboxTask]);

  const handleRejectSandboxTask = useCallback((taskId: string, feedback: string) => {
    updateSandboxTask(taskId, (current) => ({
      ...current,
      status: "rejected",
      feedback: feedback || null,
      resolvedAt: new Date(),
    }));
    appendAssistantSystemMessage("↩ Regenerating with feedback...");
  }, [appendAssistantSystemMessage, updateSandboxTask]);

  const handleSubmit = async (e?: FormEvent, promptOverride?: string) => {
    if (e) e.preventDefault();
    const hasPendingImage = Boolean(state.pendingImage || pendingSavedImage);
    const prompt = (promptOverride ?? state.input).trim() || (hasPendingImage ? "What's in this image?" : "");
    if ((!prompt && !hasPendingImage) || state.loading) return;
    const requestWorkspaceScope = workspaceScopeFor(state.mode, selectedWorkspaceItem);

    const sentImage = state.pendingImage;
    const sentSavedImage = pendingSavedImage;
    const uId = uid();
    dispatch({
      type: "ADD_USER_MESSAGE",
      payload: {
        text: prompt,
        id: uId,
        imageUrl: sentImage || sentSavedImage?.previewUrl || undefined,
        workspaceScope: requestWorkspaceScope,
      },
    });
    setPendingSavedImage(null);

    const aId = uid();
    dispatch({
      type: "START_ASSISTANT_STREAM",
      payload: { id: aId, workspaceScope: requestWorkspaceScope },
    });
    startTimeRef.current = performance.now();

    try {
      const historyBase = requestWorkspaceScope
        ? state.messages.filter((message) => message.workspaceScope === requestWorkspaceScope)
        : state.messages;
      const history = historyBase.slice(-10).map(m => ({ role: m.role, text: m.text }));
      const healthcareEntity =
        state.mode === "healthcare"
          ? resolveHealthcareEntityFromPrompt(prompt, summary?.items || [], selectedWorkspaceItem)
          : null;
      const wasSuggested = modeConfig.suggestions.some(
        (suggestion) => normalizeTextToken(suggestion) === normalizeTextToken(prompt),
      );
      if (state.mode === "healthcare") {
        void fetch("/api/licensing/chat/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            page_url:
              typeof window !== "undefined"
                ? window.location.href
                : "https://chat.statelicensingreference.com/chat",
            user_question: prompt,
            was_suggested: wasSuggested,
            visit_timestamp: new Date().toISOString(),
            resolved_entity_id: healthcareEntity?.id || null,
          }),
        }).catch(() => undefined);
      }
      const selectedCandidateId = state.selectedCandidate?.id || null;
      const selectedContextFromSelection: SelectedCandidateContextPayload | null =
        state.selectedCandidate
          ? {
            candidate_id: state.selectedCandidate.id || null,
            nova_id:
              typeof state.selectedCandidate.candidate?.novaId === "string"
                ? String(state.selectedCandidate.candidate.novaId)
                : null,
            candidate_name: state.selectedCandidate.name || null,
            candidate_email:
              typeof (state.selectedCandidate.candidate as { email?: unknown } | undefined)?.email === "string"
                ? String((state.selectedCandidate.candidate as { email?: unknown }).email)
                : null,
            current_bucket:
              typeof state.selectedCandidate.candidate?.derivedCurrentStatus === "string"
                ? String(state.selectedCandidate.candidate.derivedCurrentStatus)
                : typeof state.selectedCandidate.candidate?.assignmentStatus === "string"
                  ? String(state.selectedCandidate.candidate.assignmentStatus)
                  : null,
            source: "left_rail_selected",
          }
          : null;

      const selectedContextFromRail: SelectedCandidateContextPayload | null =
        !selectedContextFromSelection &&
          isOpsMode &&
          Array.isArray(summary?.items)
          ? (() => {
            const promptLower = prompt.toLowerCase();
            const inferredItem = summary?.items.find(
              (item) =>
                Boolean(item?.id) &&
                Boolean(item?.label) &&
                promptLower.includes(String(item.label).toLowerCase()),
            );
            if (!inferredItem?.id) return null;
            return {
              candidate_id: String(inferredItem.id),
              nova_id: inferredItem.novaId ? String(inferredItem.novaId) : null,
              candidate_name: inferredItem.label ? String(inferredItem.label) : null,
              candidate_email:
                typeof (inferredItem as { email?: unknown }).email === "string"
                  ? String((inferredItem as { email?: unknown }).email)
                  : null,
              current_bucket:
                inferredItem.derivedCurrentStatus ||
                inferredItem.assignmentStatus ||
                inferredItem.status ||
                null,
              source: "left_rail_inferred",
            };
          })()
          : null;

      const selectedCandidateContext =
        selectedContextFromSelection || selectedContextFromRail || null;

      const selectedMarginContext: SelectedMarginContextPayload | null =
        state.mode === "margins" && selectedWorkspaceItem
          ? {
            candidate_name: selectedWorkspaceItem.candidateName || selectedWorkspaceItem.label || null,
            profession: selectedWorkspaceItem.profession || null,
            specialty: selectedWorkspaceItem.specialty || null,
            facility_name: selectedWorkspaceItem.facilityName || null,
            facility_city: selectedWorkspaceItem.facilityCity || null,
            facility_state: selectedWorkspaceItem.facilityState || null,
            assignment_start: selectedWorkspaceItem.assignmentStart || null,
            assignment_end: selectedWorkspaceItem.assignmentEnd || null,
            weekly_gross: selectedWorkspaceItem.weeklyGross ?? null,
            actual_margin_pct: selectedWorkspaceItem.actualMarginPct ?? null,
            target_margin_pct: selectedWorkspaceItem.targetMarginPct ?? null,
            base_pay_rate: selectedWorkspaceItem.basePayRate ?? null,
            weekly_stipends: selectedWorkspaceItem.weeklyStipends ?? null,
            weekly_hours: selectedWorkspaceItem.weeklyHours ?? null,
            shift_type: selectedWorkspaceItem.shiftType || null,
            shift_start: selectedWorkspaceItem.shiftStart || null,
            shift_end: selectedWorkspaceItem.shiftEnd || null,
          }
          : null;

      // Build request body with optional retrieval policy for internal records
      const chatBody: Record<string, unknown> = {
        prompt,
        history,
        image: sentImage || undefined,
        imageRecordId: sentSavedImage?.imageId,
        mode: state.mode,
        modelOverride: modelOverride !== "auto" ? modelOverride : undefined,
        selectedCandidateContext,
        selectedMarginContext,
        uiContext: {
          candidateId: selectedCandidateContext?.candidate_id || null,
          candidateName: selectedCandidateContext?.candidate_name || null,
          activeItems: state.mode === "code" ? summary?.items : undefined,
        },
      };

      if (state.selectedCandidate) {
        chatBody.retrievalPolicy = {
          source: "internal_candidate_record",
          webSearchAllowed: false,
        };
        chatBody.internalContext = {
          candidate: state.selectedCandidate.candidate,
        };
      }

      if (sentSavedImage?.imageId) {
        fetch("/api/evidence/use", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageId: sentSavedImage.imageId }),
        }).catch(() => undefined);
      }

      if (sentSavedImage?.imageId && selectedCandidateId && !sentSavedImage.candidateId) {
        fetch("/api/evidence/link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageId: sentSavedImage.imageId, candidateId: selectedCandidateId }),
        }).catch(() => undefined);
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chatBody),
      });

      if (!res.ok || !res.body) throw new Error("Connection failed");

      const modelProvider = res.headers.get("X-Model-Provider") || undefined;
      const modelId = res.headers.get("X-Model-Id") || undefined;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantTextBuffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === "[DONE]") {
            if (state.mode === "healthcare" && healthcareEntity?.url) {
              const hasReferenceLink = /statelicensingreference\.com/i.test(assistantTextBuffer);
              if (!hasReferenceLink) {
                const referenceLine = `\n\nReference page: [${healthcareEntity.label}](${healthcareEntity.url})`;
                assistantTextBuffer += referenceLine;
                dispatch({ type: "APPEND_ASSISTANT_CHUNK", payload: { id: aId, textChunk: referenceLine } });
              }
            }
            const elapsed = Math.round(performance.now() - startTimeRef.current);
            dispatch({ type: "FINISH_ASSISTANT_STREAM", payload: { id: aId, durationMs: elapsed, modelProvider, modelId } });
            continue;
          }
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.type === "text") {
              assistantTextBuffer += String(parsed.text || "");
              dispatch({ type: "APPEND_ASSISTANT_CHUNK", payload: { id: aId, textChunk: parsed.text } });
            } else if (
              parsed.type === "sandbox_document" ||
              parsed.type === "sandbox_db_write" ||
              parsed.type === "sandbox_api_call" ||
              parsed.type === "sandbox_email_draft" ||
              parsed.type === "sandbox_agent_handoff"
            ) {
              const chunkPayload = asRecord(parsed);
              if (!chunkPayload) continue;
              const preview = normalizeSandboxPreview(parsed.type, chunkPayload);
              const commitAction = normalizeSandboxCommitAction(parsed.type, chunkPayload);
              if (!preview || !commitAction) continue;

              const taskId = typeof parsed.taskId === "string" && parsed.taskId ? parsed.taskId : uid();
              const title =
                typeof parsed.title === "string" && parsed.title.trim().length > 0
                  ? parsed.title.trim()
                  : parsed.type === "sandbox_document"
                    ? "Preview"
                    : parsed.type === "sandbox_db_write"
                      ? `DB Write: ${String(chunkPayload.table || "unknown")}`
                      : parsed.type === "sandbox_email_draft"
                        ? `Email Draft: ${String(chunkPayload.templateId || chunkPayload.template_id || "template")}`
                        : parsed.type === "sandbox_agent_handoff"
                          ? `Agent Handoff: ${String(chunkPayload.sourceSurface || chunkPayload.source_surface || "nova")}`
                          : "API Call";

              upsertSandboxTask({
                taskId,
                status: "pending_review",
                outputType: preview.type,
                title,
                preview:
                  preview.type === "document"
                    ? { ...preview, renderedHtml: preview.renderedHtml || formatMarkdown(preview.markdown) }
                    : preview,
                commitAction,
                feedback: null,
                createdAt: new Date(),
                resolvedAt: null,
                error: null,
                conversationId: conversationIdRef.current || "",
                mode: state.mode,
                messageId: aId,
              });

              if (!announcedSandboxTasksRef.current.has(taskId)) {
                announcedSandboxTasksRef.current.add(taskId);
                dispatch({
                  type: "APPEND_ASSISTANT_CHUNK",
                  payload: { id: aId, textChunk: `${isOpsMode ? "\n\n" : ""}📋 Preview ready: ${title} — [Review in Sandbox →]` },
                });
              }
            } else if (parsed.type === "write_result") {
              const outcome = parsed.outcome;
              if (isWriteOutcome(outcome)) {
                const writePayload =
                  parsed.payload && typeof parsed.payload === "object"
                    ? (parsed.payload as Record<string, unknown>)
                    : undefined;
                dispatch({
                  type: "SET_ASSISTANT_WRITE_RESULT",
                  payload: {
                    id: aId,
                    writeResult: {
                      outcome,
                      action: typeof parsed.action === "string" ? parsed.action : undefined,
                      objectType: typeof parsed.objectType === "string" ? parsed.objectType : undefined,
                      rowsUpdated: typeof parsed.rowsUpdated === "number" ? parsed.rowsUpdated : null,
                      code: typeof parsed.code === "string" ? parsed.code : null,
                      payload: writePayload,
                    },
                  },
                });

                // ── Reactive left rail update ──────────────────────
                // When a status write lands, update the matching candidate
                // card in the left rail immediately — no refresh needed.
                if (
                  (parsed.action === "update_candidate_status" || parsed.action === "update_candidate_profession") &&
                  writePayload &&
                  summary
                ) {
                  const candidateId = String(writePayload.candidate_id || "");
                  const novaId = String(writePayload.nova_id || "");
                  if (candidateId || novaId) {
                    setSummary(prev => {
                      if (!prev) return prev;
                      const updatedItems = prev.items.map(item => {
                        const itemId = item.candidateId || item.id || "";
                        const itemNovaId = item.novaId || "";
                        const isMatch =
                          (candidateId && itemId === candidateId) ||
                          (novaId && itemNovaId === novaId);
                        if (!isMatch) return item;

                        const changed = writePayload.changed_fields as Record<string, { to?: string }> | undefined;
                        const newStatus = changed?.status?.to;
                        const newProfession = changed?.profession?.to;
                        const newSpecialty = changed?.specialty?.to;

                        return {
                          ...item,
                          ...(newStatus ? { assignmentStatus: newStatus, derivedCurrentStatus: newStatus } : {}),
                          ...(newProfession ? { profession: newProfession } : {}),
                          ...(newSpecialty ? { specialty: newSpecialty } : {}),
                        };
                      });
                      return { ...prev, items: updatedItems };
                    });
                  }
                }
              }
            } else if (parsed.type === "error") {
              dispatch({
                type: "ERROR_ASSISTANT_STREAM",
                payload: {
                  id: aId,
                  error: parsed.message || "No response returned. Please try again.",
                  code: typeof parsed.code === "string" ? parsed.code : undefined,
                },
              });
            } else if (parsed.type === "tool_status") {
              // Tool progress chip — append as status line to assistant message
              const statusIcon =
                parsed.status === "running" ? "🔍"
                  : parsed.status === "ok" ? "✅"
                    : "❌";
              const label = typeof parsed.label === "string" ? parsed.label : String(parsed.tool || "");
              console.log(`[tool_status] ${parsed.tool} ${parsed.status} ${parsed.latency_ms ?? ""}ms`);
              if (parsed.status === "running") {
                dispatch({
                  type: "APPEND_ASSISTANT_CHUNK",
                  payload: { id: aId, textChunk: `${statusIcon} ${label}\n` },
                });
              }
            } else if (parsed.type === "grounding") {
              dispatch({ type: "SET_ASSISTANT_GROUNDING", payload: { id: aId, citations: parsed.citations, queries: parsed.queries } });
            } else if (parsed.type === "executableCode") {
              dispatch({ type: "ADD_CODE_BLOCK", payload: { id: aId, code: parsed.code, language: parsed.language } });
            } else if (parsed.type === "codeExecutionResult") {
              dispatch({ type: "SET_CODE_RESULT", payload: { id: aId, outcome: parsed.outcome, output: parsed.output } });
            }
          } catch { /* malformed chunk */ }
        }
      }
    } catch (err) {
      dispatch({ type: "ERROR_ASSISTANT_STREAM", payload: { id: aId, error: err instanceof Error ? err.message : "Try again in a moment." } });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(e); }
  };

  const handleTodayCardAction = useCallback((prompt: string) => {
    if (!prompt || state.loading) return;
    void handleSubmit(undefined, prompt);
  }, [handleSubmit, state.loading]);

  const messageCount = visibleMessages.filter(m => m.role === "user").length;

  return (
    <div
      className={`ws-shell ${artifactContent ? "ws-artifact-open"
          : rightPanelMode === "sources" ? "ws-sources-open"
            : rightPanelMode === "sandbox" ? "ws-sandbox-open"
              : ""
        } ${mobileRailOpen ? "ws-mobile-rail-open" : ""} ${
          leftPanelCollapsed ? "ws-left-collapsed" : ""
        }`}
    >
      {/* Global Toggle Float */}
      <button
        type="button"
        className="c-rail-toggle-desktop"
        onClick={() => setLeftPanelCollapsed(!leftPanelCollapsed)}
        aria-label="Toggle workspace panel"
        title="Toggle Sidebar"
      >
        <PanelLeft size={16} />
      </button>

      {/* Left Panel */}
      <LeftPanel
        mode={state.mode}
        summary={summary}
        error={summaryError}
        loading={summaryLoading}
        filter={panelFilter}
        selectedItemId={selectedWorkspaceItem?.id || null}
        onFilterChange={setPanelFilter}
        onItemClick={handlePanelItemClick}
        onModeSwitch={switchMode}
        onRetry={() => fetchSummary(state.mode)}
        onRefreshData={() => fetchSummary(state.mode)}
        marginSubTab={marginSubTab}
        onMarginSubTabChange={setMarginSubTab}
        chatLoading={state.loading}
        mobileOpen={mobileRailOpen}
        onMobileClose={() => setMobileRailOpen(false)}
      />
      {mobileRailOpen && (
        <button
          type="button"
          className="ws-mobile-backdrop"
          aria-label="Close workspace panel"
          onClick={() => setMobileRailOpen(false)}
        />
      )}

      {/* Center: Header + Messages + Dock */}
      <div className="ws-center" style={{ position: "relative" }}>
        <header className="c-header">
          <div className="c-header-right">
            <button
              type="button"
              className="c-rail-toggle"
              onClick={() => setMobileRailOpen(true)}
              aria-label="Open workspace panel"
            >
              <PanelLeft size={15} />
            </button>
            {(state.mode === "facility" || state.mode === "margins") && (
              <button
                type="button"
                className="c-new-btn"
                onClick={() => fetchSummary(state.mode)}
                disabled={summaryLoading}
              >
                {summaryLoading ? "Refreshing..." : "Refresh"}
              </button>
            )}
            <button
              type="button"
              className="c-sources-btn"
              onClick={() => {
                const latestAssistant = [...visibleMessages].reverse().find((m) => m.role === "assistant") || null;
                setSourcesMsg(latestAssistant);
                setRightPanelMode("sources");
              }}
            >
              Sources
            </button>
            <button
              type="button"
              className={`c-sources-btn ${rightPanelMode === "sandbox" ? "is-active" : ""}`}
              onClick={() => setRightPanelMode("sandbox")}
            >
              Sandbox
              {sandboxTasks.length > 0 ? ` (${sandboxTasks.length})` : ""}
            </button>
            <Link href="/voice" className="c-voice-link" title="Voice mode">
              <Mic size={16} />
            </Link>
            {messageCount > 0 && (
              <button
                className="c-new-btn"
                onClick={() => {
                  dispatch({ type: "CLEAR_CHAT" });
                  localStorage.removeItem(storageKey(state.mode));
                  setRightPanelMode("closed");
                  setSourcesMsg(null);
                  setPendingSavedImage(null);
                  ensureConversationId(state.mode);
                }}
              >
                <Plus size={14} />
                New
              </button>
            )}
          </div>
        </header>



        {/* Today cards removed — not demo-ready */}

        {state.mode === "facility" && selectedWorkspaceItem && (
          <section className="c-workspace-detail">
            <div className="c-workspace-detail-head">
              <div className="c-workspace-detail-head-row">
                <div>
                  <h3>{selectedWorkspaceItem.facilityName || selectedWorkspaceItem.label}</h3>
                  <p>
                    {(selectedWorkspaceItem.facilityCity || "--")}
                    {selectedWorkspaceItem.facilityState ? `, ${selectedWorkspaceItem.facilityState}` : ""}
                    {selectedWorkspaceItem.vmsPlatform ? ` · ${selectedWorkspaceItem.vmsPlatform}` : ""}
                  </p>
                  {(selectedWorkspaceItem.facilityProfileUrl || selectedWorkspaceItem.facilityNovaUrl || selectedWorkspaceItem.novaUrl) && (
                    <>
                      <span className="sr-only">URL: {selectedWorkspaceItem.facilityProfileUrl || selectedWorkspaceItem.facilityNovaUrl || selectedWorkspaceItem.novaUrl}</span>
                      <span className="aya-card-url c-workspace-detail-url" aria-hidden="true">
                        {(selectedWorkspaceItem.facilityProfileUrl || selectedWorkspaceItem.facilityNovaUrl || selectedWorkspaceItem.novaUrl)?.replace(/^https?:\/\/(www\.)?/, '') || `nova/facility/${(selectedWorkspaceItem.facilityId || selectedWorkspaceItem.id).split('-').pop()}`}
                      </span>
                    </>
                  )}
                  {!(selectedWorkspaceItem.facilityProfileUrl || selectedWorkspaceItem.facilityNovaUrl || selectedWorkspaceItem.novaUrl) && (
                    <>
                      <span className="sr-only">URL: nova/facility/{selectedWorkspaceItem.facilityId || selectedWorkspaceItem.id}</span>
                      <span className="aya-card-url c-workspace-detail-url" aria-hidden="true">
                        nova/facility/{(selectedWorkspaceItem.facilityId || selectedWorkspaceItem.id).split('-').pop()}
                      </span>
                    </>
                  )}
                </div>
                <div className="c-workspace-profile-link-wrap">
                  {selectedWorkspaceItem.facilityProfileUrl ? (
                    <a
                      className="c-workspace-profile-link"
                      href={selectedWorkspaceItem.facilityProfileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open Profile ↗
                    </a>
                  ) : (
                    <span className="c-workspace-profile-link-muted">No profile</span>
                  )}
                </div>
              </div>
            </div>
            <div className="c-workspace-detail-grid">
              <div>
                <span>Submittal Rules</span>
                <strong>{selectedWorkspaceItem.submittalRules || "—"}</strong>
              </div>
              <div>
                <span>Difficulty</span>
                <strong
                  className={
                    selectedWorkspaceItem.submissionDifficulty === "easy"
                      ? "c-metric-good"
                      : selectedWorkspaceItem.submissionDifficulty === "hard"
                        ? "c-metric-bad"
                        : ""
                  }
                >
                  {formatSubmissionDifficulty(selectedWorkspaceItem.submissionDifficulty)}
                </strong>
              </div>
              <div>
                <span>Pay vs Local COL</span>
                <strong>{selectedWorkspaceItem.payVsLocalCol || "—"}</strong>
              </div>
              {typeof selectedWorkspaceItem.cancelRatePct === "number" && (
                <div>
                  <span>Cancel %</span>
                  <strong>{formatPct(selectedWorkspaceItem.cancelRatePct)}</strong>
                </div>
              )}
              {selectedWorkspaceItem.parkingCost && (
                <div>
                  <span>Parking</span>
                  <strong>{selectedWorkspaceItem.parkingCost}</strong>
                </div>
              )}
              {typeof selectedWorkspaceItem.extensionRatePct === "number" && (
                <div>
                  <span>Extension %</span>
                  <strong>{formatPct(selectedWorkspaceItem.extensionRatePct)}</strong>
                </div>
              )}
            </div>
            {(Number(selectedWorkspaceItem.activeAssignments || 0) > 0 ||
              Number(selectedWorkspaceItem.pendingStartAssignments || 0) > 0 ||
              Number(selectedWorkspaceItem.pipelineAssignments || 0) > 0 ||
              Number(selectedWorkspaceItem.totalAssignments || 0) > 0) && (
                <>
                  <div className="c-workspace-detail-subhead">Operational Load</div>
                  <div className="c-workspace-detail-grid">
                    {Number(selectedWorkspaceItem.activeAssignments || 0) > 0 && (
                      <div>
                        <span>Active</span>
                        <strong>{Number(selectedWorkspaceItem.activeAssignments)}</strong>
                      </div>
                    )}
                    {Number(selectedWorkspaceItem.pendingStartAssignments || 0) > 0 && (
                      <div>
                        <span>Pending Start</span>
                        <strong>{Number(selectedWorkspaceItem.pendingStartAssignments)}</strong>
                      </div>
                    )}
                    {Number(selectedWorkspaceItem.pipelineAssignments || 0) > 0 && (
                      <div>
                        <span>Pipeline</span>
                        <strong>{Number(selectedWorkspaceItem.pipelineAssignments)}</strong>
                      </div>
                    )}
                    {Number(selectedWorkspaceItem.totalAssignments || 0) > 0 && (
                      <div>
                        <span>Total</span>
                        <strong>{Number(selectedWorkspaceItem.totalAssignments)}</strong>
                      </div>
                    )}
                    {selectedWorkspaceItem.facilityBeds && Number(selectedWorkspaceItem.facilityBeds) > 0 && (
                      <div>
                        <span>Beds</span>
                        <strong>{selectedWorkspaceItem.facilityBeds}</strong>
                      </div>
                    )}
                  </div>
                </>
              )}
          </section>
        )}

        {state.mode === "margins" && selectedWorkspaceItem && (() => {
          const pkg = selectedWorkspaceItem;
          const copyPackageText = () => {
            const lines = [
              `📋 Pay Package — ${pkg.specialty || pkg.profession || "Assignment"}`,
              ``,
              `📍 ${pkg.facilityName || "Facility"}${(pkg.facilityCity || pkg.facilityState) ? ` · ${[pkg.facilityCity, pkg.facilityState].filter(Boolean).join(", ")}` : ""}`,
              `📅 ${formatAssignmentWindow(pkg.assignmentStart, pkg.assignmentEnd)}`,
              ``,
              `💰 ${formatMoney(pkg.weeklyGross)}/wk gross`,
              `   ${formatMoney(pkg.basePayRate)}/hr base`,
              `   ${formatMoney(pkg.weeklyStipends)}/wk stipends`,
              `⏰ ${formatShiftCadence(pkg.weeklyHours, pkg.shiftType, pkg.shiftStart, pkg.shiftEnd)}`,
              `   ${formatShiftWindow(pkg.shiftType, pkg.shiftStart, pkg.shiftEnd)}`,
              ``,
              `Interested? Reply YES and I'll get you started! 🚀`,
            ];
            navigator.clipboard.writeText(lines.join("\n"));
          };
          return (
          <section className="c-margin-premium-card" id="margin-outreach-card">
            {/* ── Action Bar: primary outreach actions ── */}
            <div className="c-margin-actions">
              <button
                type="button"
                className="c-margin-action-primary"
                onClick={() => {
                  copyPackageText();
                  const btn = document.getElementById("copy-pkg-btn");
                  if (btn) { btn.textContent = "✓ Copied!"; setTimeout(() => { btn.textContent = "Copy Package"; }, 1800); }
                }}
                id="copy-pkg-btn"
              >
                Copy Package
              </button>
              {pkg.rcThreadUrl && (
                <a
                  className="c-margin-action-secondary"
                  href={pkg.rcThreadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open SMS →
                </a>
              )}
              {pkg.outlookThreadUrl && (
                <a
                  className="c-margin-action-secondary"
                  href={pkg.outlookThreadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open Email →
                </a>
              )}
            </div>

            {/* ── Headline: Specialty + Location ── */}
            <div className="c-margin-premium-header">
              <div className="c-margin-premium-title-group">
                <h2 className="c-margin-premium-name">{pkg.specialty || pkg.profession || pkg.label}</h2>
                {(pkg.facilityCity || pkg.facilityState) && (
                  <span className="c-margin-premium-badge">
                    {[pkg.facilityCity, pkg.facilityState].filter(Boolean).join(", ")}
                  </span>
                )}
              </div>

              <div className="c-margin-premium-location">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                {pkg.facilityName || "--"}
              </div>

              <div className="c-margin-premium-dates">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                {formatAssignmentWindow(pkg.assignmentStart, pkg.assignmentEnd)}
              </div>
            </div>

            {marginTimeline && (
              <div className="c-margin-premium-timeline">
                <div className="c-margin-premium-timeline-bar">
                  <div className="c-margin-premium-timeline-fill" style={{ width: `${marginTimeline.pct}%` }} />
                </div>
                <span className="c-margin-premium-timeline-lbl">{marginTimeline.label}</span>
              </div>
            )}

            {/* ── Financial Grid: Screenshot-friendly pay layout ── */}
            <div className="c-margin-premium-financials">
              <div className="c-margin-premium-hero">
                <div className="c-margin-premium-gross">
                  <span className="c-margin-premium-gross-val">{formatMoney(pkg.weeklyGross)}</span>
                  <span className="c-margin-premium-gross-lbl">/wk gross</span>
                </div>
              </div>

              <div className="c-margin-premium-breakdown-row">
                <div className="c-margin-premium-breakdown-item">
                  <span className="c-margin-premium-kpi-lbl">Base</span>
                  <span className="c-margin-premium-kpi-val">{formatMoney(pkg.basePayRate)}<small>/hr</small></span>
                </div>
                <div className="c-margin-premium-breakdown-item">
                  <span className="c-margin-premium-kpi-lbl">Stipends</span>
                  <span className="c-margin-premium-kpi-val">{formatMoney(pkg.weeklyStipends)}<small>/wk</small></span>
                </div>
                <div className="c-margin-premium-breakdown-item">
                  <span className="c-margin-premium-kpi-lbl">Shift</span>
                  <span className="c-margin-premium-kpi-val">{formatShiftCadence(pkg.weeklyHours, pkg.shiftType, pkg.shiftStart, pkg.shiftEnd) || "--"}</span>
                </div>
              </div>
            </div>

            {/* ── Internal: Margins + Metadata (hidden by default) ── */}
            <details className="c-margin-premium-meta-details">
              <summary>Internal Details</summary>
              <div className="c-margin-premium-metadata-grid">
                <div className="c-margin-premium-meta">
                  <span>Actual TM%</span>
                  <strong>{formatPct(pkg.actualMarginPct)}</strong>
                </div>
                <div className="c-margin-premium-meta">
                  <span>Target TM%</span>
                  <strong>{formatPct(pkg.targetMarginPct)}</strong>
                </div>
                <div className="c-margin-premium-meta">
                  <span>Shift Window</span>
                  <strong>{formatShiftWindow(pkg.shiftType, pkg.shiftStart, pkg.shiftEnd)}</strong>
                </div>
                <div className="c-margin-premium-meta">
                  <span>Weekly Hours</span>
                  <strong>{pkg.weeklyHours ?? "--"}</strong>
                </div>
                <div className="c-margin-premium-meta">
                  <span>Last Synced</span>
                  <strong title={pkg.lastSeenAt || undefined}>{formatRelativeTime(pkg.lastSeenAt)}</strong>
                </div>
                <div className="c-margin-premium-meta">
                  <span>Job Ref</span>
                  <strong>{pkg.jobId || "--"}</strong>
                </div>
                <div className="c-margin-premium-meta">
                  <span>Calc Ref</span>
                  <strong>{pkg.marginId || "--"}</strong>
                </div>
                <div className="c-margin-premium-meta">
                  <span>Ledger ID</span>
                  <strong className="c-margin-mono">{pkg.marginObjectId || pkg.id}</strong>
                </div>
              </div>
            </details>
          </section>
          );
        })()}

        <div className="c-scroll">
          <div className="c-messages">
            {visibleMessages.length === 0 && (
              <div className="c-empty">
                <h2 className="c-empty-heading">What do you want to know?</h2>
                <div className="c-starters">
                  {modeConfig.suggestions.map((s) => (
                    <button
                      key={s}
                      className="c-starter"
                      onClick={() => { dispatch({ type: "SET_INPUT", payload: s }); inputRef.current?.focus(); }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {visibleMessages.map((msg) => (
              <div key={msg.id} className="c-row">
                {msg.role === "user" ? (
                  (() => {
                    const userDisplay = buildUserDisplayContent(msg.text);
                    return (
                      <div className="c-user">
                        {msg.imageUrl && (
                          <div className="c-user-img">
                            <img src={msg.imageUrl} alt="Attached" />
                          </div>
                        )}
                        <div className="c-user-text">{userDisplay.previewText}</div>
                        <div className="c-msg-time">{formatMessageTimestamp(msg.timestamp)}</div>
                      </div>
                    );
                  })()
                ) : (
                  (() => {
                    const assistantDisplay = buildAssistantDisplayContent(msg.text, state.mode);
                    const shouldRenderDraftCard =
                      CLEAN_COPY_MODES.has(state.mode) &&
                      Boolean(assistantDisplay.primaryCopyBlock);
                    const replyMarkdown = shouldRenderDraftCard
                      ? assistantDisplay.visibleMarkdownWithoutPrimaryCopyBlock
                      : assistantDisplay.visibleMarkdown;
                    const hasReplyMarkdown = Boolean(replyMarkdown.trim());
                    return (
                      <div className="c-reply">
                        {msg.text && hasReplyMarkdown ? (
                          <div
                            className="c-body"
                            dangerouslySetInnerHTML={{ __html: formatMarkdown(replyMarkdown) }}
                          />
                        ) : msg.isStreaming ? (
                          <div className="c-thinking">
                            <span className="c-thinking-dot" />
                            <span className="c-thinking-dot" />
                            <span className="c-thinking-dot" />
                          </div>
                        ) : shouldRenderDraftCard ? null : (
                          <div className="c-empty-reply">
                            No response returned. Please retry.
                          </div>
                        )}

                        {!msg.isStreaming && shouldRenderDraftCard && assistantDisplay.primaryCopyBlock && (
                          <div className="c-draft-card">
                            <pre className="c-draft-text">{assistantDisplay.primaryCopyBlock}</pre>
                            <div className="c-draft-actions">
                              <button
                                className="c-action-btn c-action-btn-primary c-draft-copy-btn"
                                onClick={() =>
                                  copyToClipboard(msg.text, msg.id, state.mode, {
                                    primaryOnly: true,
                                  })
                                }
                              >
                                {state.copiedId === msg.id ? <Check size={13} /> : <Copy size={13} />}
                                {state.copiedId === msg.id ? "Copied" : "Copy draft"}
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Code execution blocks */}
                        {msg.codeBlocks && msg.codeBlocks.length > 0 && (
                          <div className="c-exec-blocks">
                            {msg.codeBlocks.map((block, i) => (
                              <div key={i} className="c-exec">
                                <div className="c-exec-header">
                                  <span className="c-exec-lang">{block.language?.toLowerCase() || "python"}</span>
                                  <span className="c-exec-label">{block.outcome ? "ran" : "running..."}</span>
                                </div>
                                <pre className="c-exec-code"><code>{block.code}</code></pre>
                                {block.output && (
                                  <div className={`c-exec-output ${block.outcome === "OUTCOME_OK" ? "" : "c-exec-error"}`}>
                                    <div className="c-exec-output-label">{block.outcome === "OUTCOME_OK" ? "Output" : "Error"}</div>
                                    <pre>{block.output}</pre>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {msg.isStreaming && msg.text && <span className="c-cursor" />}

                        {!msg.isStreaming && msg.text && (
                          <div className="c-actions">
                            {state.mode === "healthcare" && (
                              <button
                                className="c-action-btn c-action-btn-primary"
                                onClick={() => handleApproveHealthcareSnapshot(msg)}
                                disabled={
                                  Boolean(approvingSnapshotMessageId) ||
                                  (msg.writeResult?.action === "approve_research_snapshot" &&
                                    msg.writeResult.outcome !== "failed")
                                }
                              >
                                {approvingSnapshotMessageId === msg.id
                                  ? "Saving..."
                                  : msg.writeResult?.action === "approve_research_snapshot" &&
                                    msg.writeResult.outcome !== "failed"
                                    ? "Approved"
                                    : "Approve snapshot"}
                              </button>
                            )}
                            {!shouldRenderDraftCard && (
                              <button
                                className={`c-action-btn ${CLEAN_COPY_MODES.has(state.mode) && assistantDisplay.primaryCopyBlock ? "c-action-btn-primary" : ""}`}
                                onClick={() =>
                                  copyToClipboard(msg.text, msg.id, state.mode, {
                                    primaryOnly: CLEAN_COPY_MODES.has(state.mode) && Boolean(assistantDisplay.primaryCopyBlock),
                                  })
                                }
                              >
                                {state.copiedId === msg.id ? <Check size={13} /> : <Copy size={13} />}
                                {state.copiedId === msg.id
                                  ? "Copied"
                                  : CLEAN_COPY_MODES.has(state.mode) && assistantDisplay.primaryCopyBlock
                                    ? "Copy draft"
                                    : "Copy"}
                              </button>
                            )}
                            {msg.writeResult && (
                              <span
                                className={`c-write-badge c-write-${msg.writeResult.outcome}`}
                                title={msg.writeResult.outcome === "failed" ? "Action failed" : "Saved to record"}
                              >
                                {writeOutcomeLabel(msg.writeResult.outcome)}
                              </span>
                            )}
                            {((msg.citations && msg.citations.length > 0) ||
                              (msg.queries && msg.queries.length > 0)) && (
                                <button
                                  className="c-action-btn c-sources-btn"
                                  onClick={() => {
                                    setSourcesMsg(msg);
                                    setRightPanelMode("sources");
                                  }}
                                >
                                  <ChevronDown size={13} />
                                  {msg.citations && msg.citations.length > 0
                                    ? `${msg.citations.length} source${msg.citations.length > 1 ? "s" : ""}`
                                    : `${msg.queries?.length || 0} quer${(msg.queries?.length || 0) === 1 ? "y" : "ies"}`}
                                </button>
                              )}
                            {msg.writeResult && state.mode === "code" && (
                              <button
                                type="button"
                                className="c-write-toggle"
                                onClick={() => {
                                  setExpandedWritePayloads((current) => {
                                    const next = new Set(current);
                                    if (next.has(msg.id)) next.delete(msg.id);
                                    else next.add(msg.id);
                                    return next;
                                  });
                                }}
                              >
                                {expandedWritePayloads.has(msg.id) ? "Hide details" : "Details"}
                              </button>
                            )}
                            <span className="c-msg-time">{formatMessageTimestamp(msg.timestamp)}</span>
                          </div>
                        )}
                        {!msg.isStreaming && state.mode === "code" && msg.writeResult && expandedWritePayloads.has(msg.id) && (
                          <pre className="c-write-payload">
                            {JSON.stringify(writePayloadForDisplay(msg.writeResult), null, 2)}
                          </pre>
                        )}
                      </div>
                    );
                  })()
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input dock */}
        <div className="c-dock">
          {pendingSavedImage && (
            <div className="c-img-preview">
              <img src={pendingSavedImage.previewUrl} alt="Saved source preview" />
              <button className="c-img-dismiss" onClick={() => setPendingSavedImage(null)}>
                <X size={12} />
              </button>
            </div>
          )}
          {state.pendingImage && (
            <div className="c-img-preview">
              <img src={state.pendingImage} alt="Preview" />
              <button className="c-img-dismiss" onClick={() => dispatch({ type: "SET_PENDING_IMAGE", payload: null })}>
                <X size={12} />
              </button>
            </div>
          )}
          <form
            className="c-input-form"
            onSubmit={handleSubmit}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]); e.target.value = ""; }}
            />
            <button type="button" className="c-attach-btn" onClick={() => fileInputRef.current?.click()}>
              <Paperclip size={16} />
            </button>
            <textarea
              ref={inputRef}
              value={state.input}
              onChange={(e) => {
                dispatch({ type: "SET_INPUT", payload: e.target.value });
                // Auto-expand
                const el = e.target;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 160) + "px";
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={modeConfig.placeholder}
              className="c-textarea"
              rows={1}
              disabled={state.loading}
            />
            <div className="c-capability-wrap">
              <span className="c-capability-label">Mode</span>
              <CapabilityDropdown
                value={modelOverride}
                onChange={setModelOverride}
                disabled={state.loading || uploadingImage}
                mode={state.mode}
              />
            </div>
            <button
              type="submit"
              className={`c-send-btn ${state.loading ? "c-send-loading" : ""} ${(state.input.trim() || state.pendingImage || pendingSavedImage) && !state.loading ? "c-send-ready" : ""}`}
              disabled={state.loading || uploadingImage || (!state.input.trim() && !state.pendingImage && !pendingSavedImage)}
            >
              {state.loading ? (
                <span className="c-send-spinner" />
              ) : (
                <Send size={16} />
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Right Panel (Sources) */}
      {rightPanelMode === "sources" && (
        <RightPanel
          citations={sourcesMsg?.citations || []}
          queries={sourcesMsg?.queries || []}
          recentImages={recentImages}
          imagesLoading={imagesLoading}
          onUseImage={handleUseSavedImage}
          onTogglePin={handleToggleImagePin}
          onLinkCandidate={handleLinkImageCandidate}
          selectedCandidateId={state.selectedCandidate?.id || null}
          onClose={() => {
            setRightPanelMode("closed");
            setSourcesMsg(null);
          }}
        />
      )}

      {/* Right Panel (Sandbox) */}
      {rightPanelMode === "sandbox" && (
        <SandboxPanel
          tasks={sandboxTasks}
          activeTaskId={activeSandboxId}
          onSelectTask={setActiveSandboxId}
          onApprove={handleApproveSandboxTask}
          onReject={handleRejectSandboxTask}
          onClose={() => setRightPanelMode("closed")}
          isCommitting={Boolean(pendingSandboxCommitId)}
        />
      )}

      {/* Artifact Canvas */}
      {artifactContent && (
        <aside className="artifact-canvas">
          <div className="artifact-header">
            <span className="artifact-title">{artifactTitle || "Generated Output"}</span>
            <div className="artifact-actions">
              <button
                className="artifact-action-btn"
                onClick={() => { navigator.clipboard.writeText(artifactContent); }}
              >
                Copy
              </button>
              <button
                className="artifact-close"
                onClick={() => { setArtifactContent(null); setArtifactTitle(""); }}
              >
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="artifact-body">
            <textarea
              className="artifact-editor"
              value={artifactContent}
              onChange={e => setArtifactContent(e.target.value)}
              placeholder="Generated content will appear here..."
            />
          </div>
        </aside>
      )}
    </div>
  );
}

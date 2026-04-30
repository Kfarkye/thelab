"use client";

import { useReducer, useRef, useEffect, useCallback, useState, useMemo, FormEvent } from "react";
import { Send, Copy, Check, Plus, ChevronDown, ChevronRight, X, Paperclip, Mic, Search, MoreHorizontal, PanelLeft, Loader2, CheckCircle, AlertCircle, Zap, ShieldCheck, MapPin, ExternalLink, FileText, Phone, MessageSquare, Mail, UserPlus, Calculator, Link2, Users, CirclePlus } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import type { CommitAction, SandboxPanelMode, SandboxPreview, SandboxTask } from "@/lib/types/sandbox";
import { SandboxPanel } from "@/components/SandboxPanel";


import type { 
  Citation, CodeBlock, WriteOutcome, WriteResultMeta, Message, ToolStatus, 
  SavedImage, SelectedCandidateContextPayload, SelectedMarginContextPayload, 
  BrowserStep, VisualAssertion, BrowserTask, ConsoleMode, ModelOverride, 
  ImageIntent, ChatState, ChatAction,
  PanelItem, SummaryData, TodayCard
} from "@/lib/types/chat";
import { MODES } from "@/lib/chat-modes";

import { ChatInput } from "@/components/chat/ChatInput";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { PicksPanel } from "@/components/picks/PicksPanel";
import {
  formatMarkdown, formatCopyReadyText, isCopyReadyFenceLanguage, isLikelyRawPayloadBlock,
  buildCopyOnlyMarkdown, buildAssistantDisplayContent, buildUserDisplayContent, formatMessageTimestamp,
  extractPrimaryCopyBlock, stripFirstCopyReadyFence, saveToStorage, loadFromStorage,
  workspaceScopeFor, getSavedMode, readStringSafe, readNumberSafe, readPercentDecimal, MODE_KEY, storageKey,
  formatShortDate, formatLongDate, formatDateTime, marginDeltaPoints, formatMarginDelta,
  formatRelativeTime, formatShiftWindow, parseTimeToMinutes, formatShiftCadence,
  formatAssignmentWindow, assignmentProgress, formatSubmissionDifficulty,
  formatTournamentStage, normalizeStateToCode, inferHealthcareContextFromPrompt,
  inferHealthcareContextFromLabel, normalizeTextToken, buildLicensingReferenceUrl,
  resolveHealthcareEntityFromPrompt
} from "@/lib/chat-utils";

const CLEAN_COPY_MODES = new Set<ConsoleMode>([
  "healthcare",
  "sports",
  "worldcup",
  "ayaops",
  "clicks",
  "facility",
  "margins",
  "deals",
]);

const MODE_CONTEXT_HINTS: Record<ConsoleMode, string> = {
  healthcare: "Ask about state licensing steps, fees, timelines, and required documents.",
  sports: "Ask about injuries, lines, matchup context, and slate priorities.",
  code: "Ask for architecture, debugging, implementation, or reviews.",
  worldcup: "Ask about matches, tactical reads, line movement, and today’s slate.",
  ayaops: "Ask about candidates, facilities, rates, deadlines, and message threads.",
  clicks: "Ask about interested clicks, matched candidates, and tracked listings.",
  facility: "Ask about submittal rules, cancellation risk, extensions, and facility load.",
  margins: "Ask for the margin read, execution risk, and next best action.",
  agent: "Describe a browser task. The AI will produce structured steps, selectors, and assertions.",
  deals: "Ask about high margin assignments, deals closing this week, and at-risk contracts.",
};

const CAPABILITY_OPTIONS: { value: ModelOverride; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "routes for you" },
  { value: "pro", label: "Gemini 3.1 Pro", hint: "deep reasoning" },
  { value: "flash", label: "Flash-Lite", hint: "fast extraction" },
];

const IMAGE_INTENTS: { value: ImageIntent; icon: React.ReactNode; label: string }[] = [
  { value: "add_candidate", icon: <UserPlus size={13} />, label: "Add Candidate" },
  { value: "pay_package", icon: <Calculator size={13} />, label: "Pay Package" },
  { value: "margin_approval", icon: <Calculator size={13} />, label: "Margin" },
  { value: "analyze", icon: <Search size={13} />, label: "Analyze" },
];

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_INPUT":
      return { ...state, input: action.payload };
    case "SET_PENDING_IMAGE":
      return { ...state, pendingImage: action.payload, imageIntent: action.payload ? state.imageIntent : null };
    case "SET_IMAGE_INTENT":
      return { ...state, imageIntent: action.payload };
    case "ADD_USER_MESSAGE":
      return {
        ...state, input: "", pendingImage: null, imageIntent: null,
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
            isRetryableError: false,
            retryCount: 0,
            lastFailureText: null,
            lastFailureCode: null,
            lastFailureAt: null,
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
            isRetryableError: false,
            retryCount: 0,
            requestUserMessageId: action.payload.requestUserMessageId || null,
            lastFailureText: null,
            lastFailureCode: null,
            lastFailureAt: null,
            workspaceScope: action.payload.workspaceScope || null,
          },
        ]
      };
    case "RETRY_ASSISTANT_STREAM":
      return {
        ...state,
        loading: true,
        messages: state.messages.map((m) => {
          if (m.id !== action.payload.id) return m;
          return {
            ...m,
            text: "",
            timestamp: new Date(),
            isStreaming: true,
            isRetryableError: false,
            retryCount: (typeof m.retryCount === "number" ? m.retryCount : 0) + 1,
            writeResult: undefined,
            toolStatuses: undefined,
            citations: undefined,
            queries: undefined,
            codeBlocks: undefined,
            durationMs: undefined,
            modelProvider: undefined,
            modelId: undefined,
          };
        }),
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
            isRetryableError: false,
            writeResult: m.writeResult || inferred || undefined,
          };
        })
      };
    case "ERROR_ASSISTANT_STREAM":
      {
        const failedAt = new Date().toISOString();
        return {
          ...state, loading: false,
          messages: state.messages.map((m) =>
            m.id === action.payload.id
              ? (() => {
                const errorText = humanizeStreamError(action.payload.error, action.payload.code);
                return {
                  ...m,
                  isStreaming: false,
                  isRetryableError: true,
                  text: errorText,
                  lastFailureText: errorText,
                  lastFailureCode: action.payload.code || "STREAM_ERROR",
                  lastFailureAt: failedAt,
                  writeResult: {
                    outcome: "failed",
                    code: action.payload.code || "STREAM_ERROR",
                  },
                };
              })()
              : m
          )
        };
      }
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
    case "UPSERT_TOOL_STATUS": {
      const incomingStatus = action.payload.status;
      return {
        ...state,
        messages: state.messages.map((m) => {
          if (m.id !== action.payload.id) return m;
          const currentStatuses = m.toolStatuses || [];
          const newStatuses = [...currentStatuses];
          // For "running", always append (supports duplicate tool names in one round).
          // For "ok"/"failed", find the LAST "running" entry with matching tool name and update it.
          if (incomingStatus.status === "running") {
            newStatuses.push(incomingStatus);
          } else {
            let lastRunningIdx = -1;
            for (let i = newStatuses.length - 1; i >= 0; i--) {
              if (newStatuses[i].tool === incomingStatus.tool && newStatuses[i].status === "running") {
                lastRunningIdx = i;
                break;
              }
            }
            if (lastRunningIdx >= 0) {
              newStatuses[lastRunningIdx] = { ...newStatuses[lastRunningIdx], ...incomingStatus };
            } else {
              newStatuses.push(incomingStatus);
            }
          }
          return { ...m, toolStatuses: newStatuses };
        })
      };
    }
    case "CLEAR_CHAT":
      return { ...state, messages: [], input: "", loading: false, pendingImage: null, imageIntent: null };
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
  if (!raw) return "Request could not be completed. Please try again.";

  if (lowered.includes("internal lookup failed")) {
    return "Lookup could not be completed. Try candidate name or ID and retry.";
  }
  if (lowered.includes("tool-required request was not executed") || lowered.includes("internal lookup loop limit")) {
    return "Lookup is incomplete. Try candidate name or ID and retry.";
  }
  if (lowered.includes("unsupported built-in function") || lowered.includes("unimplemented")) {
    return "That lookup is temporarily unavailable. Please retry in a moment.";
  }
  if (lowered.includes("permission_denied") || lowered.includes("unauthenticated")) {
    return "That record is unavailable right now. Please retry.";
  }
  if (lowered.includes("deadline_exceeded") || lowered.includes("timeout")) {
    return "That request timed out. Please retry.";
  }
  if (lowered.includes("to_email is required")) {
    return "Draft cannot be generated because the candidate email is missing.";
  }
  if (lowered.includes("connection failed")) {
    return "Connection dropped while fetching that. Try again in a moment.";
  }
  if (lowered.includes("malformed nova payload")) {
    return "Payload format is invalid. Paste the full JSON block and retry.";
  }
  if (code === "STREAM_ERROR") {
    return "Temporary stream issue. Please retry.";
  }
  if (code === "TOOL_EXECUTION_FAILED" && error && error.length > 5) {
    return `Tool execution failed: ${error}`;
  }
  return "Request could not be completed. Please try again.";
}

function summarizeThreadLabel(text: string, maxLength = 52): string {
  const firstLine = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) || "";
  const cleaned = firstLine
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  if (!cleaned) return "";
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function shortStableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function deriveWriteTransactionId(input: {
  action?: string | null;
  outcome?: string | null;
  rowsUpdated?: number | null;
  payload?: Record<string, unknown> | null;
}): string {
  const payload = input.payload || {};
  const changedFields =
    payload.changed_fields && typeof payload.changed_fields === "object"
      ? JSON.stringify(payload.changed_fields)
      : "";
  const signature = [
    String(input.action || payload.action || ""),
    String(input.outcome || payload.outcome || ""),
    String(input.rowsUpdated ?? payload.rows_updated ?? ""),
    String(payload.object_type || ""),
    String(payload.candidate_id || ""),
    String(payload.nova_id || ""),
    String(payload.thread_id || ""),
    String(payload.note_id || ""),
    String(payload.event_id || ""),
    String(payload.write_timestamp || payload.updated_at || payload.created_at || ""),
    changedFields,
  ].join("|");
  return `tx_${shortStableHash(signature)}`;
}

function writeMessageScore(message: Message): number {
  let score = 0;
  if (!message.isStreaming) score += 2;
  if (!message.isRetryableError) score += 2;
  if ((message.text || "").trim().length > 0) score += 2;
  const outcome = message.writeResult?.outcome;
  if (outcome === "updated" || outcome === "inserted" || outcome === "no_change") score += 3;
  if (outcome === "failed") score -= 2;
  score += Number(message.timestamp ? new Date(message.timestamp).getTime() : 0) / 1_000_000_000_000;
  return score;
}

function sanitizeToolStatusLabel(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "Working";

  const withoutEmojiPrefix = raw
    .replace(/^[\s\u200B-\u200D\uFEFF\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]+/gu, "")
    .replace(/^[\s•·\-–—:]+/g, "")
    .trim();

  return withoutEmojiPrefix || "Working";
}



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


// Utils moved to src/lib/chat-utils.ts


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
      const aDays =
        typeof a.touchDaysToEnd === "number" && Number.isFinite(a.touchDaysToEnd)
          ? a.touchDaysToEnd
          : Number.POSITIVE_INFINITY;
      const bDays =
        typeof b.touchDaysToEnd === "number" && Number.isFinite(b.touchDaysToEnd)
          ? b.touchDaysToEnd
          : Number.POSITIVE_INFINITY;
      if (aDays !== bDays) return aDays - bDays;
      return String(a.label || "").localeCompare(String(b.label || ""));
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
        detail: `${top.specialty || top.profession || "Traveler"} · ${top.facilityName || "Facility not set"}`,
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
            : "Deadline risk detected",
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

function buildAyaopsRosterDigest(summary: SummaryData | null): Record<string, unknown> | null {
  if (!summary || !Array.isArray(summary.items) || summary.items.length === 0) return null;

  const statusCounts = new Map<string, number>();
  const specialtyCounts = new Map<string, number>();

  for (const item of summary.items) {
    const rawStatus = String(item.derivedCurrentStatus || item.assignmentStatus || item.status || "")
      .trim()
      .toLowerCase();
    let statusKey = rawStatus;
    if (rawStatus.includes("pending_start") || rawStatus.includes("prestart")) statusKey = "prestart";
    else if (rawStatus === "active" || rawStatus.includes("working")) statusKey = "working";
    else if (rawStatus.includes("in_pipeline") || rawStatus.includes("submitted")) statusKey = "submitted";
    else if (rawStatus.includes("completed")) statusKey = "completed";
    else if (rawStatus.includes("cancel")) statusKey = "cancelled";
    if (statusKey) {
      statusCounts.set(statusKey, (statusCounts.get(statusKey) || 0) + 1);
    }

    const specialtyKey = String(item.specialty || item.profession || "")
      .trim()
      .toLowerCase();
    if (specialtyKey) {
      specialtyCounts.set(specialtyKey, (specialtyCounts.get(specialtyKey) || 0) + 1);
    }
  }

  const normalizeMap = (map: Map<string, number>) =>
    Object.fromEntries(
      Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12),
    );

  return {
    total: summary.items.length,
    statuses: normalizeMap(statusCounts),
    specialties: normalizeMap(specialtyCounts),
  };
}

// LeftPanel moved to src/components/chat/LeftPanel.tsx
import { LeftPanel } from "@/components/chat/LeftPanel";


// --- Right Panel (Sources) ---
function RightPanel({
  citations,
  queries,
  recentImages,
  imagesLoading,
  onUseImage,
  onTogglePin,
  onLinkCandidate,
  onProcessCredential,
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
  onProcessCredential?: (image: SavedImage) => void;
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
                    <img src={image.previewUrl} alt="Recent screenshot" className="rp-image-thumb" />
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
                      {onProcessCredential && (
                        <button
                          className="rp-image-action"
                          onClick={() => onProcessCredential(image)}
                        >
                          Verify Credential
                        </button>
                      )}
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

function PicksRightPanel({
  summary,
  onPrompt,
  onClose,
}: {
  summary: SummaryData | null;
  onPrompt: (prompt: string) => void;
  onClose: () => void;
}) {
  return (
    <aside className="rp-shell rp-shell-picks">
      <div className="rp-header">
        <h2 className="rp-title">Picks</h2>
        <button className="rp-close" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="rp-picks-body">
        <PicksPanel
          picks={summary?.sportsPicks || []}
          games={summary?.items || []}
          track={summary?.sportsTrackRecord || null}
          onPrompt={onPrompt}
        />
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
            const locked = false;
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
    messages: [], input: "", loading: false, copiedId: null, pendingImage: null, imageIntent: null, mode: "sports" as ConsoleMode, selectedCandidate: null,
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
  const [ayaAdminMode, setAyaAdminMode] = useState(false);

  // Artifact Canvas
  const [artifactContent, setArtifactContent] = useState<string | null>(null);
  const [artifactTitle, setArtifactTitle] = useState("");

  // Agent Tab state
  const [agentTasks, setAgentTasks] = useState<BrowserTask[]>([]);
  const [selectedAgentTask, setSelectedAgentTask] = useState<string | null>(null);

  const activeAgentTask = useMemo(
    () => agentTasks.find((t) => t.taskId === selectedAgentTask) || null,
    [agentTasks, selectedAgentTask],
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRaf = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const conversationIdRef = useRef<string>("");
  const announcedSandboxTasksRef = useRef<Set<string>>(new Set());
  const lastAutoOpenedMsgIdRef = useRef<string | null>(null);

  const modeConfig = useMemo(() => {
    const base = MODES[state.mode];
    if (!summary || !Array.isArray(summary.items)) return base;
    const sg = [...base.suggestions];

    if (state.mode === "sports") {
      const items = summary.items;
      const picks = Array.isArray(summary.sportsPicks) ? summary.sportsPicks : [];

      const readLivePayload = (item: PanelItem): Record<string, unknown> | null => {
        if (item.live && typeof item.live === "object" && !Array.isArray(item.live)) {
          return item.live;
        }
        return null;
      };

      const readLiveNumber = (payload: Record<string, unknown> | null, key: string): number | null => {
        if (!payload) return null;
        const value = payload[key];
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };

      const readLiveString = (payload: Record<string, unknown> | null, key: string): string => {
        if (!payload) return "";
        const value = payload[key];
        return typeof value === "string" ? value.trim() : "";
      };

      const liveGames = items.filter((item) => {
        const status = typeof item.status === "string" ? item.status.toLowerCase() : "";
        if (item.is_live_stale) return false;
        if (status.includes("final") || status.includes("post") || status.includes("scheduled")) return false;
        if (status.includes("live")) return true;
        return readLivePayload(item) != null;
      });

      if (liveGames.length > 0) {
        const g = liveGames[0];
        const livePayload = readLivePayload(g);
        const title = g.label || g.display || `${g.awayName || g.away || "Away"} vs ${g.homeName || g.home || "Home"}`;
        const inning = readLiveNumber(livePayload, "inning");
        const half = readLiveString(livePayload, "half").toUpperCase();
        const periodStr = inning != null ? `${half === "TOP" ? "Top" : "Bot"} ${inning}` : "";
        let scoreStr = "";
        if (g.awayScore != null && g.homeScore != null) {
          scoreStr = `${g.awayScore}-${g.homeScore}`;
        } else {
          const balls = readLiveNumber(livePayload, "balls");
          const strikes = readLiveNumber(livePayload, "strikes");
          if (balls != null && strikes != null) scoreStr = `${balls}-${strikes}`;
        }
        const contextParts = [periodStr, scoreStr].filter(Boolean);
        const contextStr = contextParts.length > 0 ? ` — ${contextParts.join(", ")}` : "";
        sg[0] = `${title} is live${contextStr}. What's the situation?`;
      }

      const nowLocal = new Date();
      const todayStr = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, '0')}-${String(nowLocal.getDate()).padStart(2, '0')}`;
      
      const todayUpcomingGames = items.filter((i) => {
        const d = i.startTime ? String(i.startTime).slice(0, 10) : (i.date ? String(i.date).slice(0, 10) : "");
        if (d !== todayStr) return false;
        const statusStr = String(i.status || "").toLowerCase();
        return !liveGames.includes(i) && !statusStr.includes("final");
      });
      
      if (todayUpcomingGames.length > 0) {
        sg[1] = `${todayUpcomingGames.length} games are upcoming today. Show me the lines.`;
      }

      const pendingPicks = picks.filter((p) => p.grading_status === "pending" || !p.result);
      if (pendingPicks.length > 0) {
        sg[2] = `You have ${pendingPicks.length} pending picks. Review grading status.`;
      }
      return { ...base, suggestions: sg };
    }

    if (state.mode === "ayaops") {
      const items = summary.items;
      let monthEndedCount = 0;
      let credentialGapsCount = 0;
      
      for (const i of items) {
        if (typeof i.touchDaysToEnd === "number" && i.touchDaysToEnd > -30 && i.touchDaysToEnd <= 30) {
          monthEndedCount++;
        }
        const status = String(i.derivedCurrentStatus || i.assignmentStatus || i.status || "").toLowerCase();
        if (status.includes("credential") || status.includes("pending")) {
          credentialGapsCount++;
        }
      }
      
      if (monthEndedCount > 0) {
        sg[0] = `${monthEndedCount} contracts ended this month — review pipeline impact`;
      }
      if (credentialGapsCount > 0) {
        sg[2] = `${credentialGapsCount} travelers flagged for credential gaps.`;
      }
      return { ...base, suggestions: sg };
    }

    return base;
  }, [state.mode, summary]);
  const isOpsMode =
    state.mode === "ayaops" ||
    state.mode === "facility" ||
    state.mode === "margins" ||
    state.mode === "deals";
  const isReadWorkspaceMode = state.mode === "facility" || state.mode === "margins";
  const activeWorkspaceScope = useMemo(
    () => workspaceScopeFor(state.mode, selectedWorkspaceItem),
    [state.mode, selectedWorkspaceItem],
  );
  const visibleMessages = useMemo(() => {
    const scoped = activeWorkspaceScope
      ? state.messages.filter((message) => message.workspaceScope === activeWorkspaceScope)
      : state.messages;

    const deduped: Message[] = [];
    const txIndex = new Map<string, number>();

    for (const message of scoped) {
      if (message.role !== "assistant") {
        deduped.push(message);
        continue;
      }

      const transactionId = readStringSafe(message.writeResult?.transactionId || "");
      if (!transactionId) {
        deduped.push(message);
        continue;
      }

      const existingIndex = txIndex.get(transactionId);
      if (existingIndex == null) {
        txIndex.set(transactionId, deduped.length);
        deduped.push(message);
        continue;
      }

      const current = deduped[existingIndex];
      if (writeMessageScore(message) >= writeMessageScore(current)) {
        deduped[existingIndex] = message;
      }
    }

    return deduped;
  }, [activeWorkspaceScope, state.messages]);
  const todayCards = useMemo(() => buildTodayCards(state.mode, summary), [state.mode, summary]);

  const marginTimeline = useMemo(
    () =>
      state.mode === "margins" && selectedWorkspaceItem
        ? assignmentProgress(selectedWorkspaceItem.assignmentStart, selectedWorkspaceItem.assignmentEnd)
        : null,
    [state.mode, selectedWorkspaceItem],
  );

  const [marginDistance, setMarginDistance] = useState<{ distance: string; duration: string } | null>(null);
  useEffect(() => {
    if (state.mode !== "margins" || !selectedWorkspaceItem) {
      setMarginDistance(null);
      return;
    }
    const pkg = selectedWorkspaceItem;
    const origin = pkg.homeState || null;
    const dest = [pkg.facilityCity, pkg.facilityState].filter(Boolean).join(", ");
    if (!origin || !dest) {
      setMarginDistance(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/distance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ origin, destination: dest }),
        });
        if (!res.ok || cancelled) return;
        const data = await res.json() as { status: string; distance?: string; duration?: string };
        if (!cancelled && data.status === "ok") {
          setMarginDistance({ distance: data.distance || "--", duration: data.duration || "--" });
        }
      } catch {
        // Distance is supplementary — silent failure is acceptable.
      }
    })();
    return () => { cancelled = true; };
  }, [state.mode, selectedWorkspaceItem]);

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
                    objectType: readStringSafe(row.objectType) || null,
                    recordPhase: readStringSafe(row.recordPhase) || null,
                    payPackageId: readStringSafe(row.payPackageId) || null,
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

        const sportsPicksRaw = Array.isArray(payload.sportsPicks) ? payload.sportsPicks : [];
        const sportsPicks: PanelItem[] = sportsPicksRaw
          .map((entry, index) => {
            if (!entry || typeof entry !== "object") return null;
            const row = entry as Record<string, unknown>;
            const id = readStringSafe(row.id) || `pick-${index + 1}`;
            const display = readStringSafe(row.display) || readStringSafe(row.label) || id;
            return {
              id,
              label: display,
              display,
              gameId: readStringSafe(row.game_id) || null,
              marketType: readStringSafe(row.market_type) || null,
              sideToken: readStringSafe(row.side) || null,
              line: readNumberSafe(row.line),
              priority: readStringSafe(row.priority) || null,
              kicker: readStringSafe(row.kicker) || null,
              rationale: readStringSafe(row.rationale) || null,
              event_status: readStringSafe(row.event_status) || null,
              grading_status: readStringSafe(row.grading_status) || null,
              result: readNumberSafe(row.result),
              settlementValue: readNumberSafe(row.settlement_value),
              live: row.live && typeof row.live === "object" && !Array.isArray(row.live)
                ? row.live as Record<string, unknown>
                : null,
              is_live_stale: Boolean(row.is_live_stale),
              ticker: readStringSafe(row.ticker) || null,
              oddsAmerican: readNumberSafe(row.odds_american),
              lineObservedAt: readStringSafe(row.line_observed_at) || null,
              closingLine: readNumberSafe(row.closing_line),
              hubUrl: readStringSafe(row.hub_url) || null,
              apiUrl: readStringSafe(row.api_url) || null,
              publicUrl: readStringSafe(row.public_url) || null,
            } as PanelItem;
          })
          .filter((item): item is PanelItem => Boolean(item));

        const sportsTrackRecordRaw =
          payload.sportsTrackRecord && typeof payload.sportsTrackRecord === "object"
            ? payload.sportsTrackRecord as Record<string, unknown>
            : null;

        setSummary({
          pulse,
          items: normalizedItems,
          supportedLeagues: Array.isArray(payload.supportedLeagues)
            ? payload.supportedLeagues as { key: string; label: string }[]
            : undefined,
          topProfessions: Array.isArray(payload.topProfessions)
            ? payload.topProfessions as { name: string; count: number }[]
            : undefined,
          sportsPicks,
          sportsTrackRecord: sportsTrackRecordRaw
            ? {
              sample_size: readNumberSafe(sportsTrackRecordRaw.sample_size) || 0,
              wins: readNumberSafe(sportsTrackRecordRaw.wins) || 0,
              losses: readNumberSafe(sportsTrackRecordRaw.losses) || 0,
              pushes: readNumberSafe(sportsTrackRecordRaw.pushes) || 0,
              voids: readNumberSafe(sportsTrackRecordRaw.voids) || 0,
              units: readNumberSafe(sportsTrackRecordRaw.units) || 0,
              record: readStringSafe(sportsTrackRecordRaw.record) || "0 to 0 to 0",
              matured: Boolean(sportsTrackRecordRaw.matured),
            }
            : null,
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
    setRightPanelMode(savedMode === "sports" ? "picks" : "closed");
    setSourcesMsg(null);
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
      rightPanelMode !== "picks" &&
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
    setRightPanelMode(newMode === "sports" ? "picks" : "closed");
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
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") return;
    if (file.size > 10 * 1024 * 1024) { alert("File must be under 10MB"); return; }
    const reader = new FileReader();
    reader.onloadend = async () => {
      const imageDataUrl = reader.result as string;
      dispatch({ type: "SET_PENDING_IMAGE", payload: imageDataUrl });
      if (state.mode === "margins") {
        dispatch({ type: "SET_IMAGE_INTENT", payload: "pay_package" });
      }
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
      if (item.type.startsWith("image/") || item.type === "application/pdf") {
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
    if (file && (file.type.startsWith("image/") || file.type === "application/pdf")) handleFileSelect(file);
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
      dispatch({ type: "SET_SELECTED_CANDIDATE", payload: null });
      const canonicalGameUrl = item.publicUrl || (item.id ? `/sports/games/${encodeURIComponent(item.id)}` : "");
      if (canonicalGameUrl) {
        window.location.assign(canonicalGameUrl);
      } else {
        const matchup = item.away && item.home
          ? `${item.away} vs ${item.home}`
          : item.label;
        dispatch({ type: "SET_INPUT", payload: `What's the latest on ${matchup}?` });
        inputRef.current?.focus();
      }
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
      const isPayPackage = item.objectType === "pay_package" || item.recordPhase === "job";
      dispatch({
        type: "SET_INPUT",
        payload: isPayPackage
          ? "Draft outreach from this pay package."
          : "What's the read on this margin approval?",
      });
      inputRef.current?.focus();
      return;
    }

    if (state.mode === "ayaops" && item.id) {
      setSelectedWorkspaceItem(item);
      if (!item.id || !item.label) throw new Error("AYA_OPS_INVARIANT: Candidate lacks minimum identity for Top Bar hydration.");
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
          dispatch({
            type: "SET_INPUT",
            payload:
              `Summarize ${data.candidate.name || item.label}'s current status, then draft a short recruiter touch-base note I can paste into the record today.`,
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
    if (state.mode === "margins") {
      dispatch({ type: "SET_IMAGE_INTENT", payload: "pay_package" });
    }
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
          state: normalizeStateToCode(context.state) || context.state,
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
              transactionId: deriveWriteTransactionId({
                action: "approve_research_snapshot",
                outcome,
                rowsUpdated: 1,
                payload: result,
              }),
              payload: result,
            },
          },
        });

        const summaryLine = readStringSafe(result.change_summary);
        if (isFirstVersion) {
          appendAssistantSystemMessage(
            `Approved snapshot recorded for ${context.state} · ${context.profession}. First approved version captured.`,
          );
        } else {
          appendAssistantSystemMessage(
            `Approved snapshot recorded for ${context.state} · ${context.profession}. ${summaryLine || "Comparison recorded."}`,
          );
        }

        if (changedFieldNames.length > 0) {
          appendAssistantSystemMessage(
            `Changed fields: ${changedFieldNames.slice(0, 6).join(", ")}${changedFieldNames.length > 6 ? "…" : ""}`,
          );
        }
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Approval failed";
        appendAssistantSystemMessage(`Snapshot approval failed: ${messageText}`);
      } finally {
        setApprovingSnapshotMessageId(null);
      }
    },
    [appendAssistantSystemMessage, resolveHealthcareContextForMessage, user?.email, user?.uid],
  );

  // ── Add Candidate to System (from screenshot extraction) ──────
  const [ingestingCandidateMessageId, setIngestingCandidateMessageId] = useState<string | null>(null);

  const handleAddCandidateToSystem = useCallback(
    async (message: Message) => {
      const text = message.text || "";
      const normalizeTextField = (value: string | null | undefined, maxLength: number): string | null => {
        const normalized = String(value || "")
          .replace(/^(?:[-•]\s*)?(?:name|candidate|candidate name|display name|full name|profile)\s*:\s*/i, "")
          .replace(/\s+/g, " ")
          .trim();
        if (!normalized) return null;
        return normalized.slice(0, maxLength);
      };

      const cleanExtractedName = (value: string | null): string | null => {
        const normalized = normalizeTextField(value, 160)
          ?.replace(/\s*[•|].*$/, "")
          .replace(/\s+-\s+.*$/, "")
          .trim();
        if (!normalized) return null;
        const nameMatch = normalized.match(/[A-Z][A-Za-z.'`-]+(?:\s+[A-Z][A-Za-z.'`-]+){1,4}/);
        return nameMatch ? nameMatch[0] : null;
      };

      const parseCityStateFromSnapshot = (
        snapshotText: string,
      ): { city: string | null; stateCode: string | null } => {
        const lines = snapshotText
          .split("\n")
          .map((line) => line.replace(/[*_]/g, "").trim())
          .filter(Boolean);

        const locationLines = lines.filter((line) =>
          /^(?:[-•]\s*)?(?:home address|address|location|city\/state|city|home city)\s*:/i.test(line),
        );

        const candidateSources: string[] = [];
        for (const locationLine of locationLines) {
          candidateSources.push(
            locationLine.replace(/^(?:[-•]\s*)?(?:home address|address|location|city\/state|city|home city)\s*:\s*/i, ""),
          );
        }

        for (const source of candidateSources) {
          const cityStateMatch = source.match(/\b([A-Za-z .'-]{2,60}?)\s*,\s*([A-Z]{2})(?:\b|[^A-Z])/);
          if (!cityStateMatch) continue;
          const parsedCity = normalizeTextField(cityStateMatch[1], 60);
          const parsedState = normalizeTextField(cityStateMatch[2], 2)?.toUpperCase() || null;
          if (parsedCity && parsedState && !/^(unknown|n\/a|none)$/i.test(parsedCity)) {
            return { city: parsedCity, stateCode: parsedState };
          }
        }

        return { city: null, stateCode: null };
      };

      // Parse structured candidate fields from the AI's markdown output
      const extract = (pattern: RegExp): string | null => {
        const m = text.match(pattern);
        return m ? m[1].trim() : null;
      };

      // Extract candidate name — try specific heading patterns first
      let fullName = cleanExtractedName(extract(/Candidate Profile:\s*\*?\*?\s*(.+)/i))
        || cleanExtractedName(extract(/Candidate:\s*\*?\*?\s*([^\n*]+)/i))
        || cleanExtractedName(extract(/^Name\s*:\s*([^\n*]+)/im))
        || extract(/details for\s+\*?\*?([\w][\w\s]+[\w])\*?\*?\s/i)
        || cleanExtractedName(extract(/\*\*?(?:Name|Candidate)[:\s]*\*?\*?\s*(.+)/i));

      if (!fullName) {
        const lines = text
          .split("\n")
          .map((line) => line.replace(/[*_]/g, "").trim())
          .filter(Boolean)
          .slice(0, 12);
        for (const line of lines) {
          if (
            /^(record loaded|profile metadata|specialty|status|recent|email|address|emergency contact|last submitted|last profile update|initial docs uploaded progress|recruiter|team leader)/i.test(
              line,
            )
          ) {
            continue;
          }
          const candidateLine = line.replace(/\s*[•|].*$/, "").trim();
          if (/^[A-Z][A-Za-z.'`-]+(?:\s+[A-Z][A-Za-z.'`-]+){1,3}$/.test(candidateLine)) {
            fullName = candidateLine;
            break;
          }
        }
      }

      if (!fullName) {
        appendAssistantSystemMessage("Could not extract candidate name from this message.");
        return;
      }

      // Strip markdown formatting and stray label prefixes
      fullName = cleanExtractedName(fullName);

      if (!fullName) {
        appendAssistantSystemMessage("Could not extract a clean candidate name from this message.");
        return;
      }

      const nameParts = fullName.split(/\s+/);
      const firstName = normalizeTextField(nameParts[0] || "", 100) || "";
      const lastName = normalizeTextField(nameParts.slice(1).join(" "), 100) || "";

      const novaId = normalizeTextField(extract(/(?:Aya ID|Nova ID)[:\s]*(\d+)/i), 32);
      const email = normalizeTextField(extract(/(?:Email)[:\s]*([^\s*]+@[^\s*]+)/i), 320);
      const phone = normalizeTextField(extract(/(?:Primary Phone)[:\s]*([\d().\-\s+]+)/i), 40);
      const profession = normalizeTextField(
        extract(/(?:Profession)[:\s]*([^\n*]+)/i)?.replace(/:\s*$/, ""),
        100,
      );
      const specialty = normalizeTextField(
        extract(/(?:Specialty)[:\s]*([^\n*]+)/i)?.replace(/:\s*$/, ""),
        100,
      );
      const experienceRaw = extract(/(?:Experience)[:\s]*(\d+)/i);
      const employmentType = normalizeTextField(extract(/(?:Employment Type)[:\s]*([^\n*]+)/i), 60);

      // Parse city/state from line-safe address/location fields.
      const { city, stateCode } = parseCityStateFromSnapshot(text);

      setIngestingCandidateMessageId(message.id);
      try {
        const res = await fetch("/api/candidates/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            first_name: firstName,
            last_name: lastName,
            email: email || undefined,
            phone: phone || undefined,
            profession: profession || undefined,
            specialty: specialty || undefined,
            years_experience: experienceRaw ? parseFloat(experienceRaw) : undefined,
            current_city: city || undefined,
            current_state: stateCode || undefined,
            employment_type: employmentType || undefined,
            nova_id: novaId || undefined,
            ingested_by: user?.email || user?.uid || "local_user",
            notes: `Ingested from screenshot at ${new Date().toISOString()}`,
          }),
        });

        const payload = await res.json().catch(() => null) as
          | { result?: Record<string, unknown>; error?: string }
          | null;
        if (!res.ok) {
          throw new Error(payload?.error || `Ingest failed (${res.status})`);
        }

        const result = payload?.result || {};
        const outcome = String(result.outcome || "inserted");

        dispatch({
          type: "SET_ASSISTANT_WRITE_RESULT",
          payload: {
            id: message.id,
            writeResult: {
              outcome: outcome as "inserted" | "updated" | "no_change",
              action: "candidate_ingest",
              objectType: "candidate",
              rowsUpdated: 1,
              code: null,
              transactionId: deriveWriteTransactionId({
                action: "candidate_ingest",
                outcome,
                rowsUpdated: 1,
                payload: result as Record<string, unknown>,
              }),
              payload: result,
            },
          },
        });

        appendAssistantSystemMessage(
          outcome === "already_exists"
            ? `Candidate already exists: ${result.name} (${result.candidate_id})`
            : `Added to system: ${result.name} (${result.candidate_id})`,
        );
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Ingest failed";
        appendAssistantSystemMessage(`Failed to add candidate: ${messageText}`);
      } finally {
        setIngestingCandidateMessageId(null);
      }
    },
    [appendAssistantSystemMessage, user?.email, user?.uid],
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

  const handleProcessCredential = async (image: SavedImage) => {
    dispatch({
      type: "ADD_ASSISTANT_MESSAGE",
      payload: { id: String(Date.now()), text: `Processing credential OCR for image: ${image.imageId}...` }
    });
    try {
      const res = await fetch("/api/credentials/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId: image.imageId }),
      });
      const data = await res.json();
      if (res.ok) {
        dispatch({
          type: "ADD_ASSISTANT_MESSAGE",
          payload: { id: String(Date.now() + 1), text: `[Credential Verified]:\n\`\`\`json\n${JSON.stringify(data.extracted, null, 2)}\n\`\`\`` }
        });
      } else {
        throw new Error(data.error || "Failed to process");
      }
    } catch (e: unknown) {
      dispatch({
        type: "ADD_ASSISTANT_MESSAGE",
        payload: { id: String(Date.now() + 1), text: `[Credential Processing Failed]: ${e instanceof Error ? e.message : "Unknown error"}` }
      });
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
        appendAssistantSystemMessage(`Commit failed: ${error}`);
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
        appendAssistantSystemMessage(`Sent: ${task.title}`);
      } else if (actionName === "create_email_draft") {
        appendAssistantSystemMessage(`Draft created: ${task.title}`);
      } else if (actionName === "create_agent_handoff_task") {
        const handoffUrl =
          typeof payload.result?.handoff_url === "string" && payload.result.handoff_url
            ? payload.result.handoff_url
            : null;
        if (handoffUrl) {
          appendAssistantSystemMessage(`Handoff ready: ${task.title}\n${handoffUrl}`);
        } else {
          appendAssistantSystemMessage(`Handoff task created: ${task.title}`);
        }
      } else {
        appendAssistantSystemMessage(`Published: ${task.title}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sandbox commit error";
      updateSandboxTask(taskId, (current) => ({
        ...current,
        status: "failed",
        error: message,
        resolvedAt: new Date(),
      }));
      appendAssistantSystemMessage(`Commit failed: ${message}`);
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
    appendAssistantSystemMessage("Regenerating with feedback...");
  }, [appendAssistantSystemMessage, updateSandboxTask]);

  const handleEditSandboxEmailDraft = useCallback((
    taskId: string,
    draft: { toEmail: string; cc: string[]; subject: string; body: string },
  ) => {
    updateSandboxTask(taskId, (current) => {
      if (current.preview.type !== "email_draft") return current;

      const normalizedTo = String(draft.toEmail || "").trim();
      const normalizedCc = Array.isArray(draft.cc)
        ? draft.cc.map((entry) => String(entry || "").trim()).filter(Boolean)
        : [];
      const normalizedSubject = String(draft.subject || "");
      const normalizedBody = String(draft.body || "");

      const previewChanged =
        current.preview.toEmail !== normalizedTo ||
        current.preview.subject !== normalizedSubject ||
        current.preview.body !== normalizedBody ||
        current.preview.cc.join(",") !== normalizedCc.join(",");

      if (!previewChanged) return current;

      const nextPreview = {
        ...current.preview,
        toEmail: normalizedTo,
        cc: normalizedCc,
        subject: normalizedSubject,
        body: normalizedBody,
      };

      let nextCommitAction = current.commitAction;
      if (current.commitAction.type === "create_email_draft" || current.commitAction.type === "send_email_now") {
        nextCommitAction = {
          ...current.commitAction,
          toEmail: normalizedTo,
          cc: normalizedCc,
          subject: normalizedSubject,
          body: normalizedBody,
        };
      }

      return {
        ...current,
        preview: nextPreview,
        commitAction: nextCommitAction,
      };
    });
  }, [updateSandboxTask]);

  type RunAssistantStreamParams = {
    prompt: string;
    assistantMessageId: string;
    requestWorkspaceScope: string | null;
    sentImage: string | null;
    sentSavedImage: SavedImage | null;
    sentImageIntent: ImageIntent;
    historySeedMessages: Message[];
  };

  const runAssistantStream = async ({
    prompt,
    assistantMessageId,
    requestWorkspaceScope,
    sentImage,
    sentSavedImage,
    sentImageIntent,
    historySeedMessages,
  }: RunAssistantStreamParams) => {
    try {
      const historyBase = requestWorkspaceScope
        ? historySeedMessages.filter((message) => message.workspaceScope === requestWorkspaceScope)
        : historySeedMessages;
      const history = historyBase.slice(-10).map((message) => ({ role: message.role, text: message.text }));
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

      const selectedCandidateContext = selectedContextFromSelection || selectedContextFromRail || null;

      const selectedMarginContext: SelectedMarginContextPayload | null =
        state.mode === "margins" && selectedWorkspaceItem
          ? (() => {
            const isPayPackage =
              selectedWorkspaceItem.objectType === "pay_package" ||
              selectedWorkspaceItem.recordPhase === "job";
            return {
            object_type: selectedWorkspaceItem.objectType || null,
            record_phase: selectedWorkspaceItem.recordPhase || null,
            pay_package_id: selectedWorkspaceItem.payPackageId || null,
            margin_object_id: selectedWorkspaceItem.marginObjectId || null,
            job_id: selectedWorkspaceItem.jobId || null,
            margin_id: selectedWorkspaceItem.marginId || null,
            candidate_name: isPayPackage ? null : selectedWorkspaceItem.candidateName || selectedWorkspaceItem.label || null,
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
            };
          })()
          : null;
      const rosterDigest =
        state.mode === "ayaops" ? buildAyaopsRosterDigest(summary) : null;

      const chatBody: Record<string, unknown> = {
        prompt,
        history,
        image: sentImage || undefined,
        imageRecordId: sentSavedImage?.imageId,
        imageIntent: sentImageIntent || undefined,
        mode: state.mode,
        modelOverride: modelOverride !== "auto" ? modelOverride : undefined,
        selectedCandidateContext,
        selectedMarginContext,
        uiContext: {
          candidateId: selectedCandidateContext?.candidate_id || null,
          candidateName: selectedCandidateContext?.candidate_name || null,
          activeItems: state.mode === "code" ? summary?.items : undefined,
          rosterDigest,
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
                dispatch({ type: "APPEND_ASSISTANT_CHUNK", payload: { id: assistantMessageId, textChunk: referenceLine } });
              }
            }
            const elapsed = Math.round(performance.now() - startTimeRef.current);
            dispatch({
              type: "FINISH_ASSISTANT_STREAM",
              payload: { id: assistantMessageId, durationMs: elapsed, modelProvider, modelId },
            });
            continue;
          }
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.type === "text") {
              assistantTextBuffer += String(parsed.text || "");
              dispatch({ type: "APPEND_ASSISTANT_CHUNK", payload: { id: assistantMessageId, textChunk: parsed.text } });
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
                messageId: assistantMessageId,
              });

              if (!announcedSandboxTasksRef.current.has(taskId)) {
                announcedSandboxTasksRef.current.add(taskId);
                dispatch({
                  type: "APPEND_ASSISTANT_CHUNK",
                  payload: {
                    id: assistantMessageId,
                    textChunk: `${isOpsMode ? "\n\n" : ""}Preview ready: ${title}. Review in Sandbox.`,
                  },
                });
              }
            } else if (parsed.type === "write_result") {
              const outcome = parsed.outcome;
              if (isWriteOutcome(outcome)) {
                const writePayload =
                  parsed.payload && typeof parsed.payload === "object"
                    ? (parsed.payload as Record<string, unknown>)
                    : undefined;
                const transactionIdRaw =
                  (typeof parsed.transaction_id === "string" && parsed.transaction_id.trim()) ||
                  (typeof parsed.transactionId === "string" && parsed.transactionId.trim()) ||
                  "";
                const transactionId =
                  transactionIdRaw ||
                  deriveWriteTransactionId({
                    action: typeof parsed.action === "string" ? parsed.action : undefined,
                    outcome,
                    rowsUpdated: typeof parsed.rowsUpdated === "number" ? parsed.rowsUpdated : null,
                    payload: writePayload || null,
                  });
                dispatch({
                  type: "SET_ASSISTANT_WRITE_RESULT",
                  payload: {
                    id: assistantMessageId,
                    writeResult: {
                      outcome,
                      action: typeof parsed.action === "string" ? parsed.action : undefined,
                      objectType: typeof parsed.objectType === "string" ? parsed.objectType : undefined,
                      rowsUpdated: typeof parsed.rowsUpdated === "number" ? parsed.rowsUpdated : null,
                      code: typeof parsed.code === "string" ? parsed.code : null,
                      transactionId,
                      payload: writePayload,
                    },
                  },
                });

                if (
                  (parsed.action === "update_candidate_status" || parsed.action === "update_candidate_profession") &&
                  writePayload &&
                  summary
                ) {
                  const candidateId = String(writePayload.candidate_id || "");
                  const novaId = String(writePayload.nova_id || "");
                  if (candidateId || novaId) {
                    setSummary((prev) => {
                      if (!prev) return prev;
                      const updatedItems = prev.items.map((item) => {
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
                  id: assistantMessageId,
                  error: parsed.message || "No response returned. Please try again.",
                  code: typeof parsed.code === "string" ? parsed.code : undefined,
                },
              });
            } else if (parsed.type === "tool_status") {
              const label = sanitizeToolStatusLabel(
                typeof parsed.label === "string" ? parsed.label : String(parsed.tool || ""),
              );
              console.log(`[tool_status] ${parsed.tool} ${parsed.status} ${parsed.latency_ms ?? ""}ms`);
              dispatch({
                type: "UPSERT_TOOL_STATUS",
                payload: {
                  id: assistantMessageId,
                  status: {
                    tool: parsed.tool,
                    status: parsed.status,
                    label,
                    latencyMs: parsed.latency_ms
                  }
                }
              });
            } else if (parsed.type === "grounding") {
              dispatch({
                type: "SET_ASSISTANT_GROUNDING",
                payload: { id: assistantMessageId, citations: parsed.citations, queries: parsed.queries },
              });
            } else if (parsed.type === "executableCode") {
              dispatch({ type: "ADD_CODE_BLOCK", payload: { id: assistantMessageId, code: parsed.code, language: parsed.language } });
            } else if (parsed.type === "codeExecutionResult") {
              dispatch({
                type: "SET_CODE_RESULT",
                payload: { id: assistantMessageId, outcome: parsed.outcome, output: parsed.output },
              });
            }
          } catch {
            // Ignore malformed SSE chunks.
          }
        }
      }
    } catch (err) {
      dispatch({
        type: "ERROR_ASSISTANT_STREAM",
        payload: {
          id: assistantMessageId,
          error: err instanceof Error ? err.message : "Try again in a moment.",
          code: "STREAM_ERROR",
        },
      });
    }
  };

  const handleSubmit = async (e?: FormEvent, promptOverride?: string) => {
    if (e) e.preventDefault();
    const hasPendingImage = Boolean(state.pendingImage || pendingSavedImage);
    const rawPrompt = (promptOverride ?? state.input).trim();
    const packagesImageCapturePrompt =
      hasPendingImage &&
      state.mode === "margins" &&
      (
        !state.input.trim() ||
        /^Create concise candidate outreach from this selected pay package\./i.test(rawPrompt) ||
        /^Draft fast outreach for this pay package\./i.test(rawPrompt)
      );
    const prompt = packagesImageCapturePrompt
      ? "Extract and save this pay package or margin screenshot."
      : rawPrompt || (hasPendingImage ? "What's in this image?" : "");
    if ((!prompt && !hasPendingImage) || state.loading) return;
    const requestWorkspaceScope = workspaceScopeFor(state.mode, selectedWorkspaceItem);
    const sentImage = state.pendingImage;
    const sentSavedImage = pendingSavedImage;
    const sentImageIntent =
      state.imageIntent || (state.mode === "margins" && hasPendingImage ? "pay_package" : null);

    const userMessageId = uid();
    dispatch({
      type: "ADD_USER_MESSAGE",
      payload: {
        text: prompt,
        id: userMessageId,
        imageUrl: sentImage || sentSavedImage?.previewUrl || undefined,
        workspaceScope: requestWorkspaceScope,
      },
    });
    setPendingSavedImage(null);

    const assistantMessageId = uid();
    dispatch({
      type: "START_ASSISTANT_STREAM",
      payload: {
        id: assistantMessageId,
        workspaceScope: requestWorkspaceScope,
        requestUserMessageId: userMessageId,
      },
    });
    startTimeRef.current = performance.now();

    await runAssistantStream({
      prompt,
      assistantMessageId,
      requestWorkspaceScope,
      sentImage,
      sentSavedImage,
      sentImageIntent,
      historySeedMessages: state.messages,
    });
  };

  const handleRetryAssistantMessage = async (assistantMessageId: string) => {
    if (state.loading) return;
    const assistantIndex = state.messages.findIndex(
      (message) => message.id === assistantMessageId && message.role === "assistant",
    );
    if (assistantIndex < 0) return;

    const assistantMessage = state.messages[assistantIndex];
    let sourceUserIndex = -1;
    if (assistantMessage.requestUserMessageId) {
      sourceUserIndex = state.messages.findIndex(
        (message) => message.id === assistantMessage.requestUserMessageId && message.role === "user",
      );
    }
    if (sourceUserIndex < 0) {
      for (let i = assistantIndex - 1; i >= 0; i -= 1) {
        const candidate = state.messages[i];
        if (candidate.role !== "user") continue;
        if ((candidate.workspaceScope || null) !== (assistantMessage.workspaceScope || null)) continue;
        sourceUserIndex = i;
        break;
      }
    }
    if (sourceUserIndex < 0) return;

    const sourceUserMessage = state.messages[sourceUserIndex];
    if (!sourceUserMessage || sourceUserMessage.role !== "user") return;

    const requestWorkspaceScope = sourceUserMessage.workspaceScope || assistantMessage.workspaceScope || null;
    const historySeedMessages = state.messages.slice(0, sourceUserIndex);

    dispatch({ type: "RETRY_ASSISTANT_STREAM", payload: { id: assistantMessageId } });
    startTimeRef.current = performance.now();

    await runAssistantStream({
      prompt: sourceUserMessage.text,
      assistantMessageId,
      requestWorkspaceScope,
      sentImage: sourceUserMessage.imageUrl || null,
      sentSavedImage: null,
      sentImageIntent: null,
      historySeedMessages,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(e); }
  };

  const handleTodayCardAction = useCallback((prompt: string) => {
    if (!prompt || state.loading) return;
    void handleSubmit(undefined, prompt);
  }, [handleSubmit, state.loading]);

  useEffect(() => {
    if (state.mode !== "ayaops" && ayaAdminMode) {
      setAyaAdminMode(false);
    }
  }, [ayaAdminMode, state.mode]);

  const toTitleTokens = useCallback((value: string | null | undefined): string => {
    const normalized = String(value || "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized) return "";
    return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
  }, []);

  const initialsFor = useCallback((value: string | null | undefined): string => {
    const label = String(value || "").trim();
    if (!label) return "NA";
    return label
      .split(/\s+/)
      .map((part) => part[0] || "")
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }, []);

  const activeAyaCandidate = useMemo(() => {
    if (state.mode !== "ayaops") return null;
    if (selectedWorkspaceItem) return selectedWorkspaceItem;
    return (summary?.items?.[0] || null) as PanelItem | null;
  }, [state.mode, selectedWorkspaceItem, summary?.items]);

  const contextStatusLabel = useMemo(() => {
    if (!activeAyaCandidate) return "";
    const rawStatus =
      activeAyaCandidate.derivedCurrentStatus ||
      activeAyaCandidate.assignmentStatus ||
      activeAyaCandidate.status ||
      "in_conversation";
    return toTitleTokens(rawStatus);
  }, [activeAyaCandidate, toTitleTokens]);

  const contextRecentAssignment = useMemo(() => {
    if (!activeAyaCandidate) return "";
    const location = [activeAyaCandidate.facilityName, activeAyaCandidate.facilityState]
      .filter(Boolean)
      .join(", ");
    const windowLabel = formatAssignmentWindow(
      activeAyaCandidate.assignmentStart || null,
      activeAyaCandidate.assignmentEnd || null,
    );
    if (location && windowLabel && windowLabel !== "--") return `${location}, ${windowLabel}`;
    if (location) return location;
    return windowLabel !== "--" ? windowLabel : "";
  }, [activeAyaCandidate]);

  const candidateHubUrl = useMemo(() => {
    if (!activeAyaCandidate) return "";
    if (activeAyaCandidate.novaId) return `/c/${encodeURIComponent(activeAyaCandidate.novaId)}`;
    if (activeAyaCandidate.id) return `/c/${encodeURIComponent(activeAyaCandidate.id)}`;
    if (activeAyaCandidate.hubUrl) return activeAyaCandidate.hubUrl;
    return "";
  }, [activeAyaCandidate]);

  const messageCount = visibleMessages.filter(m => m.role === "user").length;
  const headerScopeLabel = useMemo(() => {
    const latestUserMessage = [...visibleMessages]
      .reverse()
      .find((message) => message.role === "user" && String(message.text || "").trim().length > 0);
    const fromThread = latestUserMessage ? summarizeThreadLabel(latestUserMessage.text) : "";
    if (fromThread) return fromThread;
    return (
      selectedWorkspaceItem?.label ||
      selectedWorkspaceItem?.candidateName ||
      selectedWorkspaceItem?.facilityName ||
      "General follow-up"
    );
  }, [visibleMessages, selectedWorkspaceItem]);
  const headerScopePrefix = isOpsMode ? "Team" : "Workspace";

  return (
    <div
      className={`ws-shell ${artifactContent ? "ws-artifact-open"
          : rightPanelMode === "sources" ? "ws-sources-open"
            : rightPanelMode === "picks" ? "ws-picks-open"
            : rightPanelMode === "sandbox" ? "ws-sandbox-open"
              : ""
        } ws-ayaops-v2 ${mobileRailOpen ? "ws-mobile-rail-open" : ""} ${
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
        getAuthToken={user ? () => user.getIdToken() : undefined}
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
          <div className="c-header-left">
            <div className="c-main-crumb">
              <span className="label">{headerScopePrefix}</span>
              <span className="sep">/</span>
              <span className="current">{headerScopeLabel}</span>
            </div>
          </div>
          <div className="c-header-right">
            <button
              type="button"
              className="c-rail-toggle"
              onClick={() => setMobileRailOpen(true)}
              aria-label="Open workspace panel"
            >
              <PanelLeft size={15} />
            </button>
            {state.mode === "ayaops" && (
              <button
                type="button"
                className={`c-admin-toggle ${ayaAdminMode ? "is-on" : ""}`}
                onClick={() => setAyaAdminMode((current) => !current)}
                aria-pressed={ayaAdminMode}
                aria-label="Toggle admin controls"
              >
                <span className="c-admin-toggle-dot" />
                Admin
              </button>
            )}
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
              className={`c-sources-btn ${rightPanelMode === "sources" ? "is-active" : ""}`}
              onClick={() => {
                const latestAssistant = [...visibleMessages].reverse().find((m) => m.role === "assistant") || null;
                setSourcesMsg(latestAssistant);
                setRightPanelMode("sources");
              }}
            >
              Sources
            </button>
            {state.mode === "sports" && (
              <button
                type="button"
                className={`c-sources-btn ${rightPanelMode === "picks" ? "is-active" : ""}`}
                onClick={() => setRightPanelMode("picks")}
              >
                Picks ({summary?.sportsPicks?.length || 0})
              </button>
            )}
            <button
              type="button"
              className={`c-sources-btn ${rightPanelMode === "sandbox" ? "is-active" : ""}`}
              onClick={() => setRightPanelMode("sandbox")}
            >
              Sandbox
            </button>
            {state.mode !== "ayaops" && (
              <Link href="/voice" className="c-voice-link" title="Voice mode">
                <Mic size={16} />
              </Link>
            )}
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
                New
              </button>
            )}
          </div>
        </header>

        {state.mode === "ayaops" && activeAyaCandidate && (
          <>
            <section className={`c-context-bar ${ayaAdminMode ? "admin-on" : ""}`}>
              <div className="c-context-avatar">{initialsFor(activeAyaCandidate.label || activeAyaCandidate.candidateName)}</div>
              <div className="c-context-info">
                <div className="c-context-row1">
                  <span className="c-context-name">
                    {activeAyaCandidate.label || activeAyaCandidate.candidateName || "Candidate"}
                  </span>
                  <span className="c-context-state">{contextStatusLabel || "In Conversation"}</span>
                </div>
                <div className="c-context-row2">
                  <span>
                    <strong>{activeAyaCandidate.specialty || activeAyaCandidate.profession || "--"}</strong>
                  </span>
                  {contextRecentAssignment && (
                    <span>Recent <strong>{contextRecentAssignment}</strong></span>
                  )}
                </div>
              </div>
              <div className="c-link-cluster">
                {activeAyaCandidate.phone ? (
                  <a className="c-link-btn" href={`tel:${activeAyaCandidate.phone}`} title="RingCentral call">
                    <Phone size={15} />
                  </a>
                ) : (
                  <span className="c-link-btn is-disabled" aria-hidden="true"><Phone size={15} /></span>
                )}
                {activeAyaCandidate.rcThreadUrl || activeAyaCandidate.phone ? (
                  <a
                    className="c-link-btn"
                    href={activeAyaCandidate.rcThreadUrl || `sms:${activeAyaCandidate.phone}`}
                    target={activeAyaCandidate.rcThreadUrl ? "_blank" : undefined}
                    rel={activeAyaCandidate.rcThreadUrl ? "noopener noreferrer" : undefined}
                    title="RingCentral SMS"
                  >
                    <MessageSquare size={15} />
                  </a>
                ) : (
                  <span className="c-link-btn is-disabled" aria-hidden="true"><MessageSquare size={15} /></span>
                )}
                {activeAyaCandidate.outlookThreadUrl || activeAyaCandidate.candidateEmail ? (
                  <a
                    className="c-link-btn"
                    href={activeAyaCandidate.outlookThreadUrl || `mailto:${activeAyaCandidate.candidateEmail}`}
                    target={activeAyaCandidate.outlookThreadUrl ? "_blank" : undefined}
                    rel={activeAyaCandidate.outlookThreadUrl ? "noopener noreferrer" : undefined}
                    title="Outlook thread"
                  >
                    <Mail size={15} />
                  </a>
                ) : (
                  <span className="c-link-btn is-disabled" aria-hidden="true"><Mail size={15} /></span>
                )}
                <span className="c-link-divider" />
                {activeAyaCandidate.novaUrl ? (
                  <a className="c-link-btn" href={activeAyaCandidate.novaUrl} target="_blank" rel="noopener noreferrer" title="Nova profile">
                    <CirclePlus size={15} />
                  </a>
                ) : (
                  <span className="c-link-btn is-disabled" aria-hidden="true"><CirclePlus size={15} /></span>
                )}
                <span className="c-link-btn is-disabled" aria-hidden="true" title="Teams chat">
                  <Users size={15} />
                </span>
                {ayaAdminMode && (
                  <>
                    <span className="c-link-divider" />
                    {candidateHubUrl ? (
                      <a className="c-link-btn c-link-btn-admin" href={candidateHubUrl} target="_blank" rel="noopener noreferrer" title="Candidate hub link">
                        <Link2 size={15} />
                      </a>
                    ) : (
                      <span className="c-link-btn c-link-btn-admin is-disabled" aria-hidden="true">
                        <Link2 size={15} />
                      </span>
                    )}
                  </>
                )}
              </div>
            </section>

            <section className={`c-hub-strip ${ayaAdminMode ? "is-on" : ""}`}>
              <span className="c-hub-strip-label">Hub URL</span>
              <span className="c-hub-url">{candidateHubUrl || "Unavailable"}</span>
              <div className="c-hub-actions">
                <button
                  type="button"
                  className="c-hub-action-btn"
                  disabled={!candidateHubUrl}
                  onClick={() => {
                    if (!candidateHubUrl) return;
                    void navigator.clipboard.writeText(candidateHubUrl);
                  }}
                >
                  <Copy size={12} />
                  Copy
                </button>
                <button
                  type="button"
                  className="c-hub-action-btn"
                  disabled={!candidateHubUrl || !activeAyaCandidate.phone}
                  onClick={() => {
                    if (!candidateHubUrl || !activeAyaCandidate.phone) return;
                    const smsBody = encodeURIComponent(candidateHubUrl);
                    window.open(`sms:${activeAyaCandidate.phone}?body=${smsBody}`, "_self");
                  }}
                >
                  <MessageSquare size={12} />
                  Send via SMS
                </button>
                <a
                  className={`c-hub-action-btn c-hub-action-btn-primary ${candidateHubUrl ? "" : "is-disabled"}`}
                  href={candidateHubUrl || undefined}
                  target={candidateHubUrl ? "_blank" : undefined}
                  rel={candidateHubUrl ? "noopener noreferrer" : undefined}
                  aria-disabled={!candidateHubUrl}
                  onClick={(event) => {
                    if (!candidateHubUrl) event.preventDefault();
                  }}
                >
                  <ExternalLink size={12} />
                  Open hub
                </a>
              </div>
            </section>
          </>
        )}



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
                    <a
                      className="aya-nova-btn"
                      href={selectedWorkspaceItem.facilityProfileUrl || selectedWorkspaceItem.facilityNovaUrl || selectedWorkspaceItem.novaUrl || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={selectedWorkspaceItem.facilityProfileUrl || selectedWorkspaceItem.facilityNovaUrl || selectedWorkspaceItem.novaUrl || ""}
                    >
                      Nova
                    </a>
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
                <strong>{selectedWorkspaceItem.submittalRules || "--"}</strong>
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
                <strong>{selectedWorkspaceItem.payVsLocalCol || "--"}</strong>
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
          const isPayPackage = pkg.objectType === "pay_package" || pkg.recordPhase === "job" || marginSubTab === "jobs";
          const primaryActionLabel = isPayPackage ? "Draft Outreach" : "Review Margin";
          const copyPackageText = () => {
            const specialty = pkg.specialty || pkg.profession || "Assignment";
            const facility = pkg.facilityName || "TBD";
            const grossNum = typeof pkg.weeklyGross === "number" && Number.isFinite(pkg.weeklyGross)
              ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(pkg.weeklyGross)
              : "--";
            const location = [pkg.facilityCity, pkg.facilityState].filter(Boolean).join(", ") || "Location TBD";

            const lines = [
              `${specialty} - ${facility} | ${grossNum}/week`,
              ``,
              `Location: ${location}`,
              `Dates: ${formatAssignmentWindow(pkg.assignmentStart, pkg.assignmentEnd)}`,
              `Schedule: ${formatShiftCadence(pkg.weeklyHours, pkg.shiftType, pkg.shiftStart, pkg.shiftEnd)} | ${formatShiftWindow(pkg.shiftType, pkg.shiftStart, pkg.shiftEnd)}`,
              ``,
              `Weekly Gross:  ${grossNum}/week`,
              `Base Rate:     ${formatMoney(pkg.basePayRate)}/hr`,
              `Stipends:      ${formatMoney(pkg.weeklyStipends)}/wk`,
              ``,
              `Let me know if you'd like to discuss this opportunity.`,
            ];
            navigator.clipboard.writeText(lines.join("\n"));
          };
          const sendPackageActionToComposer = () => {
            const specialty = pkg.specialty || pkg.profession || "role";
            const facility = pkg.facilityName || "this facility";
            const gross = formatMoney(pkg.weeklyGross);
            const schedule = formatShiftCadence(pkg.weeklyHours, pkg.shiftType, pkg.shiftStart, pkg.shiftEnd);
            const prompt = isPayPackage
              ? [
                `Create concise candidate outreach from this selected pay package.`,
                `Facility: ${facility}`,
                `Role: ${specialty}`,
                `Pay: ${gross}/wk`,
                `Dates: ${formatAssignmentWindow(pkg.assignmentStart, pkg.assignmentEnd)}`,
                `Schedule: ${schedule || "--"} | ${formatShiftWindow(pkg.shiftType, pkg.shiftStart, pkg.shiftEnd)}`,
              ].join("\n")
              : [
                `Draft the margin approval for this offer.`,
                `Facility: ${facility}`,
                `Role: ${specialty}`,
                `Pay package: ${gross}/wk`,
                `Actual margin: ${formatPct(pkg.actualMarginPct)}`,
                `Target margin: ${formatPct(pkg.targetMarginPct)}`,
              ].join("\n");
            dispatch({ type: "SET_INPUT", payload: prompt });
            inputRef.current?.focus();
          };
          return (
          <section className={`c-package-brief ${isPayPackage ? "is-pay-package" : "is-margin"}`} id="margin-outreach-card">
            <div className="c-package-brief-head">
              <div className="c-package-title">
                <div className="c-package-title-row">
                  <span className="c-package-kicker">{isPayPackage ? "Pay Package" : "Margin"}</span>
                  <span className="c-package-status">{isPayPackage ? "Package record" : "Approval record"}</span>
                </div>
                <h2>{pkg.specialty || pkg.profession || "Role"}</h2>
                <p>{pkg.facilityName || "Facility pending"}</p>
              </div>
              <div className="c-package-actions">
                <button
                  type="button"
                  className="c-margin-action-primary"
                  onClick={sendPackageActionToComposer}
                >
                  {primaryActionLabel}
                </button>
                {isPayPackage && (
                  <button
                    type="button"
                    className="c-margin-action-secondary"
                    onClick={copyPackageText}
                  >
                    Copy
                  </button>
                )}
                {pkg.rcThreadUrl && (
                  <a className="c-margin-action-secondary" href={pkg.rcThreadUrl} target="_blank" rel="noopener noreferrer">
                    SMS
                  </a>
                )}
                {pkg.outlookThreadUrl && (
                  <a className="c-margin-action-secondary" href={pkg.outlookThreadUrl} target="_blank" rel="noopener noreferrer">
                    Email
                  </a>
                )}
              </div>
            </div>

            <div className="c-package-brief-grid">
              <div className="c-package-pay-box">
                <span className="c-package-pay-label">Weekly Gross</span>
                <strong>{formatMoney(pkg.weeklyGross)}<small>/wk</small></strong>
                <div className="c-package-pay-metrics">
                  <span>Base <b>{formatMoney(pkg.basePayRate)}/hr</b></span>
                  <span>Stipends <b>{formatMoney(pkg.weeklyStipends)}/wk</b></span>
                </div>
              </div>

              <div className="c-package-fact-grid">
                <div className="c-package-fact">
                  <span>Dates</span>
                  <strong>{formatAssignmentWindow(pkg.assignmentStart, pkg.assignmentEnd)}</strong>
                </div>
                <div className="c-package-fact">
                  <span>Schedule</span>
                  <strong>
                    {formatShiftCadence(pkg.weeklyHours, pkg.shiftType, pkg.shiftStart, pkg.shiftEnd) || "--"}
                    {pkg.weeklyHours != null ? ` · ${pkg.weeklyHours}h` : ""}
                  </strong>
                </div>
                <div className="c-package-fact">
                  <span>Shift</span>
                  <strong>{formatShiftWindow(pkg.shiftType, pkg.shiftStart, pkg.shiftEnd)}</strong>
                </div>
                <div className="c-package-fact">
                  <span>Location</span>
                  <strong>{[pkg.facilityCity, pkg.facilityState].filter(Boolean).join(", ") || "Location pending"}</strong>
                </div>
              </div>
            </div>

            {marginTimeline && (
              <div className="c-package-progress">
                <div className="c-margin-premium-timeline-bar">
                  <div className="c-margin-premium-timeline-fill" style={{ width: `${marginTimeline.pct}%` }} />
                </div>
                <span>{marginTimeline.label}</span>
              </div>
            )}

            {marginDistance && (
              <div className="c-package-distance">Distance: {marginDistance.distance} · {marginDistance.duration}</div>
            )}

            <details className="c-margin-premium-meta-details">
              <summary>Internal</summary>
              <div className="c-package-internal-grid">
                <div>
                  <span>Actual Margin</span>
                  <strong>{formatPct(pkg.actualMarginPct)}</strong>
                </div>
                <div>
                  <span>Target Margin</span>
                  <strong>{formatPct(pkg.targetMarginPct)}</strong>
                </div>
                <div>
                  <span>Job Ref</span>
                  <strong className="c-margin-mono">{pkg.jobId || "--"}</strong>
                </div>
                <div>
                  <span>Margin Ref</span>
                  <strong className="c-margin-mono">{pkg.marginId || "--"}</strong>
                </div>
              </div>
            </details>
          </section>
          );
        })()}

        {!(state.mode === "margins" && selectedWorkspaceItem && visibleMessages.length === 0) && (
          <ChatMessages
            state={state}
            dispatch={dispatch}
            inputRef={inputRef}
            messagesEndRef={messagesEndRef}
            visibleMessages={visibleMessages}
            approvingSnapshotMessageId={approvingSnapshotMessageId}
            ingestingCandidateMessageId={ingestingCandidateMessageId}
            expandedWritePayloads={expandedWritePayloads}
            setExpandedWritePayloads={setExpandedWritePayloads}
            setSourcesMsg={setSourcesMsg}
            setRightPanelMode={setRightPanelMode}
            handleApproveHealthcareSnapshot={handleApproveHealthcareSnapshot}
            handleAddCandidateToSystem={handleAddCandidateToSystem}
            onRetryAssistantMessage={handleRetryAssistantMessage}
            copyToClipboard={copyToClipboard}
            modeConfig={modeConfig}
          />
        )}
        {state.mode === "margins" && selectedWorkspaceItem && visibleMessages.length === 0 && (
          <div className="c-package-compose-spacer" aria-hidden="true" />
        )}

        {/* Input dock */}
        <ChatInput
          pendingSavedImage={pendingSavedImage}
          setPendingSavedImage={setPendingSavedImage}
          state={state}
          dispatch={dispatch}
          IMAGE_INTENTS={IMAGE_INTENTS}
          handleSubmit={handleSubmit}
          handleDrop={handleDrop}
          fileInputRef={fileInputRef}
          handleFileSelect={handleFileSelect}
          inputRef={inputRef}
          handleKeyDown={handleKeyDown}
          handlePaste={handlePaste}
          modeConfig={modeConfig}
          modelOverride={modelOverride}
          setModelOverride={setModelOverride}
          uploadingImage={uploadingImage}
          CapabilityDropdown={CapabilityDropdown}
        />
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
          onProcessCredential={handleProcessCredential}
          selectedCandidateId={state.selectedCandidate?.id || null}
          onClose={() => {
            setRightPanelMode("closed");
            setSourcesMsg(null);
          }}
        />
      )}

      {/* Right Panel (Picks) */}
      {rightPanelMode === "picks" && state.mode === "sports" && (
        <PicksRightPanel
          summary={summary}
          onPrompt={(prompt) => {
            void handleSubmit(undefined, prompt);
          }}
          onClose={() => setRightPanelMode("closed")}
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
          onEditEmailDraft={handleEditSandboxEmailDraft}
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

"use client";

import { useReducer, useRef, useEffect, useCallback, useState, useMemo, FormEvent } from "react";
import { Send, Copy, Check, Plus, ChevronDown, ChevronRight, X, Paperclip, Mic, Search, MoreHorizontal, PanelLeft, Loader2, CheckCircle, AlertCircle, Zap, ShieldCheck, MapPin, ExternalLink, FileText, Phone, MessageSquare, Mail, UserPlus, Calculator } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import type { CommitAction, SandboxPanelMode, SandboxPreview, SandboxTask } from "@/lib/types/sandbox";
import { SandboxPanel } from "@/components/SandboxPanel";


import type { 
  Citation, CodeBlock, WriteOutcome, WriteResultMeta, Message, ToolStatus, 
  SavedImage, SelectedCandidateContextPayload, SelectedMarginContextPayload, 
  BrowserStep, VisualAssertion, BrowserTask, ConsoleMode, ModelOverride, 
  ModeConfig, ImageIntent, ChatState, ChatAction,
  PanelItem, SummaryData, TodayCard
} from "@/lib/types/chat";

import { ChatInput } from "@/components/chat/ChatInput";
import { ChatMessages } from "@/components/chat/ChatMessages";
import {
  formatMarkdown, formatCopyReadyText, isCopyReadyFenceLanguage, isLikelyRawPayloadBlock,
  buildCopyOnlyMarkdown, buildAssistantDisplayContent, buildUserDisplayContent, formatMessageTimestamp,
  extractPrimaryCopyBlock, stripFirstCopyReadyFence, saveToStorage, loadFromStorage,
  workspaceScopeFor, getSavedMode, readStringSafe, readNumberSafe, readPercentDecimal, MODE_KEY, storageKey,
  formatShortDate, formatLongDate, formatDateTime, marginDeltaPoints, formatMarginDelta,
  formatRelativeTime, formatShiftWindow, parseTimeToMinutes, formatShiftCadence,
  formatAssignmentWindow, assignmentProgress, formatTouchPriorityReason, formatSubmissionDifficulty,
  formatTournamentStage, normalizeStateToCode, inferHealthcareContextFromPrompt,
  inferHealthcareContextFromLabel, normalizeTextToken, buildLicensingReferenceUrl,
  resolveHealthcareEntityFromPrompt
} from "@/lib/chat-utils";


// ModeConfig is imported from "@/lib/types/chat"

export const MODES: Record<ConsoleMode, ModeConfig> = {
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
  agent: {
    id: "agent",
    label: "Agent",
    suggestions: [
      "Review the AyaOps facility tab for visual regressions",
      "Verify the candidate card badges render as SVG icons",
      "Check if the tool status chips stack correctly on multi-tool calls",
    ],
    placeholder: "Describe what the browser agent should check...",
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
  agent: "Describe a browser task — the AI will produce structured steps, selectors, and assertions.",
};

const CAPABILITY_OPTIONS: { value: ModelOverride; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "routes for you" },
  { value: "flash", label: "Quick", hint: "fast lookups" },
  { value: "sonnet", label: "Standard", hint: "everyday" },
  { value: "opus", label: "Deep", hint: "heavy analysis" },
  { value: "pro", label: "Extended", hint: "long research" },
];

const IMAGE_INTENTS: { value: ImageIntent; icon: React.ReactNode; label: string }[] = [
  { value: "add_candidate", icon: <UserPlus size={13} />, label: "Add Candidate" },
  { value: "margin_approval", icon: <Calculator size={13} />, label: "Margin Approval" },
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
  if (code === "TOOL_EXECUTION_FAILED" && error && error.length > 5) {
    return `Tool execution failed: ${error}`;
  }
  return "I couldn’t complete that request. Please try again.";
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

export function CapabilityDropdown({
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
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") return;
    if (file.size > 10 * 1024 * 1024) { alert("File must be under 10MB"); return; }
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

  // ── Add Candidate to System (from screenshot extraction) ──────
  const [ingestingCandidateMessageId, setIngestingCandidateMessageId] = useState<string | null>(null);

  const handleAddCandidateToSystem = useCallback(
    async (message: Message) => {
      const text = message.text || "";

      // Parse structured candidate fields from the AI's markdown output
      const extract = (pattern: RegExp): string | null => {
        const m = text.match(pattern);
        return m ? m[1].trim() : null;
      };

      // Extract candidate name — try specific heading patterns first
      let fullName = extract(/Candidate Profile:\s*\*?\*?\s*(.+)/i)
        || extract(/details for\s+\*?\*?([\w][\w\s]+[\w])\*?\*?\s/i)
        || extract(/\*\*?(?:Name|Candidate)[:\s]*\*?\*?\s*(.+)/i);

      if (!fullName) {
        appendAssistantSystemMessage("Could not extract candidate name from this message.");
        return;
      }

      // Strip markdown formatting and stray label prefixes
      fullName = fullName
        .replace(/[*_]/g, "")
        .replace(/^Profile:\s*/i, "")
        .trim();

      const nameParts = fullName.split(/\s+/);
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      const novaId = extract(/(?:Aya ID|Nova ID)[:\s]*(\d+)/i);
      const email = extract(/(?:Email)[:\s]*([^\s*]+@[^\s*]+)/i);
      const phone = extract(/(?:Primary Phone)[:\s]*([\d().\-\s+]+)/i);
      const profession = extract(/(?:Profession)[:\s]*([^\n*]+)/i)?.replace(/:\s*$/, "");
      const specialty = extract(/(?:Specialty)[:\s]*([^\n*]+)/i)?.replace(/:\s*$/, "");
      const experienceRaw = extract(/(?:Experience)[:\s]*(\d+)/i);
      const employmentType = extract(/(?:Employment Type)[:\s]*([^\n*]+)/i);

      // Parse city/state from address or location field
      const addressMatch = text.match(/(?:Home Address|Address|Location)[:\s]*[^,]*,\s*([^,]+),\s*([A-Z]{2})/i);
      const city = addressMatch ? addressMatch[1].trim() : null;
      const stateCode = addressMatch ? addressMatch[2].trim() : null;

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
      payload: { id: String(Date.now()), text: `🔄 Processing credential OCR for image: ${image.imageId}...` }
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
      const sentImageIntent = state.imageIntent;
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
                  payload: { id: aId, textChunk: `${isOpsMode ? "\n\n" : ""}Preview ready: ${title} — Review in Sandbox` },
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
              const label = typeof parsed.label === "string" ? parsed.label : String(parsed.tool || "");
              console.log(`[tool_status] ${parsed.tool} ${parsed.status} ${parsed.latency_ms ?? ""}ms`);
              dispatch({
                type: "UPSERT_TOOL_STATUS",
                payload: {
                  id: aId,
                  status: {
                    tool: parsed.tool,
                    status: parsed.status,
                    label,
                    latencyMs: parsed.latency_ms
                  }
                }
              });
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
          return (
          <section className="c-margin-premium-card" id="margin-outreach-card">
            {/* ── Action Bar ── */}
            <div className="c-margin-actions">
              <button
                type="button"
                className="c-margin-action-primary"
                onClick={() => {
                  copyPackageText();
                  const btn = document.getElementById("copy-pkg-btn");
                  if (btn) { btn.textContent = "Copied"; setTimeout(() => { btn.textContent = "Copy Package"; }, 1800); }
                }}
                id="copy-pkg-btn"
              >
                Copy Package
              </button>
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

            {/* ── Section 1: Assignment ── */}
            <div className="c-pkg-section">
              <div className="c-pkg-section-label">Assignment</div>
              <div className="c-pkg-section-content">
                <div className="c-pkg-row">
                  <span className="c-pkg-field-label">Specialty</span>
                  <span className="c-pkg-field-value">{pkg.specialty || pkg.profession || "--"}</span>
                </div>
                <div className="c-pkg-row">
                  <span className="c-pkg-field-label">Facility</span>
                  <span className="c-pkg-field-value">{pkg.facilityName || "--"}</span>
                </div>
                <div className="c-pkg-row">
                  <span className="c-pkg-field-label">Location</span>
                  <span className="c-pkg-field-value">{[pkg.facilityCity, pkg.facilityState].filter(Boolean).join(", ") || "--"}</span>
                </div>
                {marginDistance && (
                  <div className="c-pkg-row">
                    <span className="c-pkg-field-label">Distance</span>
                    <span className="c-pkg-field-value">{marginDistance.distance} · {marginDistance.duration}</span>
                  </div>
                )}
                <div className="c-pkg-row">
                  <span className="c-pkg-field-label">Dates</span>
                  <span className="c-pkg-field-value">{formatAssignmentWindow(pkg.assignmentStart, pkg.assignmentEnd)}</span>
                </div>
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

            {/* ── Section 2: Compensation ── */}
            <div className="c-pkg-section">
              <div className="c-pkg-section-label">Compensation</div>
              <div className="c-pkg-section-content">
                <div className="c-pkg-row c-pkg-row-highlight">
                  <span className="c-pkg-field-label">Weekly Gross</span>
                  <span className="c-pkg-field-value c-pkg-field-primary">{formatMoney(pkg.weeklyGross)}<small>/wk</small></span>
                </div>
                <div className="c-pkg-row">
                  <span className="c-pkg-field-label">Base Rate</span>
                  <span className="c-pkg-field-value">{formatMoney(pkg.basePayRate)}<small>/hr</small></span>
                </div>
                <div className="c-pkg-row">
                  <span className="c-pkg-field-label">Stipends</span>
                  <span className="c-pkg-field-value">{formatMoney(pkg.weeklyStipends)}<small>/wk</small></span>
                </div>
              </div>
            </div>

            {/* ── Section 3: Schedule ── */}
            <div className="c-pkg-section">
              <div className="c-pkg-section-label">Schedule</div>
              <div className="c-pkg-section-content">
                <div className="c-pkg-row">
                  <span className="c-pkg-field-label">Cadence</span>
                  <span className="c-pkg-field-value">{formatShiftCadence(pkg.weeklyHours, pkg.shiftType, pkg.shiftStart, pkg.shiftEnd) || "--"}</span>
                </div>
                <div className="c-pkg-row">
                  <span className="c-pkg-field-label">Shift Window</span>
                  <span className="c-pkg-field-value">{formatShiftWindow(pkg.shiftType, pkg.shiftStart, pkg.shiftEnd)}</span>
                </div>
                <div className="c-pkg-row">
                  <span className="c-pkg-field-label">Weekly Hours</span>
                  <span className="c-pkg-field-value">{pkg.weeklyHours ?? "--"}</span>
                </div>
              </div>
            </div>

            {/* ── Internal (hidden) ── */}
            <details className="c-margin-premium-meta-details">
              <summary>Internal</summary>
              <div className="c-pkg-section-content" style={{ marginTop: 16 }}>
                <div className="c-pkg-row">
                  <span className="c-pkg-field-label">Actual Margin</span>
                  <span className="c-pkg-field-value">{formatPct(pkg.actualMarginPct)}</span>
                </div>
                <div className="c-pkg-row">
                  <span className="c-pkg-field-label">Target Margin</span>
                  <span className="c-pkg-field-value">{formatPct(pkg.targetMarginPct)}</span>
                </div>
                <div className="c-pkg-row">
                  <span className="c-pkg-field-label">Last Synced</span>
                  <span className="c-pkg-field-value">{formatRelativeTime(pkg.lastSeenAt)}</span>
                </div>
                <div className="c-pkg-row">
                  <span className="c-pkg-field-label">Job Ref</span>
                  <span className="c-pkg-field-value c-margin-mono">{pkg.jobId || "--"}</span>
                </div>
                <div className="c-pkg-row">
                  <span className="c-pkg-field-label">Margin Ref</span>
                  <span className="c-pkg-field-value c-margin-mono">{pkg.marginId || "--"}</span>
                </div>
                <div className="c-pkg-row">
                  <span className="c-pkg-field-label">Ledger ID</span>
                  <span className="c-pkg-field-value c-margin-mono">{pkg.marginObjectId || pkg.id}</span>
                </div>
              </div>
            </details>
          </section>
          );
        })()}

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
          copyToClipboard={copyToClipboard}
          modeConfig={modeConfig}
        />

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

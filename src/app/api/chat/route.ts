import { NextRequest } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { formatCandidateContext } from "@/lib/formatters/candidate-context";
import type { CandidateRecord, RetrievalPolicy, InternalContext } from "@/lib/types/candidate";
import { routeRequest, MODEL_META, type ModelId } from "@/lib/router/model-router";
import { callClaude } from "@/lib/providers/claude";
import { DB_TOOL_DECLARATIONS, executeDbTool } from "@/lib/spanner/tools";
import { resolve as resolveHub } from "@/lib/resolver";
import { getCachedConstitution } from "@/lib/git-governance/engine";
import { interceptGroundedWrite } from "@/lib/ayaops/grounded-write-interceptor";
import { getEvidenceInlineData } from "@/lib/evidence/store";
import {
  STRICT_TOOL_CALL_SYSTEM_MESSAGE,
  classifyToolRequirement,
  detectSimulatedToolText,
  evaluateToolRequiredTurn,
  summarizeToolExecution,
} from "@/lib/agent/tool-policy";
import {
  OPS_REASSIGNMENT_RECIPIENT,
  resolveEmailTemplateId,
} from "@/lib/ayaops/email-template-routing";
import {
  OUTREACH_EMAIL_TEMPLATES,
  OPS_EMAIL_TEMPLATES,
  RESPONSE_EMAIL_TEMPLATES,
  getMissingRequiredFields,
  extractMarginApprovalFromText,
  type ExtractedOfferData as TemplateCatalogOfferData,
} from "@/lib/ayaops/template-catalog";
import { ingestMarginLedgerCapture } from "@/lib/ayaops/margin-ledger";
import {
  ingestRingCentralThreadCapture,
  isLikelyRingCentralThreadPayload,
} from "@/lib/ayaops/ringcentral-ledger";

import { GOOGLE_CLOUD_PROJECT, VERTEX_AI_AYAOPS_URL_DATASTORE } from "@/lib/env";

const PROJECT_ID = GOOGLE_CLOUD_PROJECT;
const LOCATION = "global";
const RAG_CORPUS = process.env.RAG_CORPUS_NAME || "";

// Gemini model IDs
const GEMINI_MODELS = {
  flash: "gemini-3-flash-preview",
  pro: "gemini-3.1-pro-preview",
} as const;

const ai = new GoogleGenAI({
  vertexai: true,
  project: PROJECT_ID,
  location: LOCATION,
});

const AYAOPS_WRITE_TOOL_NAMES = new Set([
  "update_candidate_status",
  "update_candidate_profession",
  "update_candidate_name",
  "add_candidate_note",
  "create_com_draft_email",
]);
const AYAOPS_READ_TOOL_NAMES = new Set<string>();

const AYAOPS_WRITE_TOOL_DECLARATIONS = DB_TOOL_DECLARATIONS.filter((tool) =>
  AYAOPS_WRITE_TOOL_NAMES.has(String((tool as { name?: unknown }).name || "")),
);
const AYAOPS_READ_TOOL_DECLARATIONS = DB_TOOL_DECLARATIONS.filter((tool) =>
  AYAOPS_READ_TOOL_NAMES.has(String((tool as { name?: unknown }).name || "")),
);

// ── URL Hub Tool Declaration ────────────────────────────────────
const ACCESS_HUB_DECLARATION = {
  name: "access_hub",
  description:
    "Access the Data Hub to resolve any entity: candidates, templates, facilities, jobs, games, picks. Returns identity block + canonical URLs + available actions. Path format: '{entity}/{identifier}' e.g. 'candidates/Fontaine', 'templates/initial-outreach', 'games/401695431', or 'picks/pick_123'. The identifier can be a name, ID, or search term.",
  parameters: {
    type: "object" as const,
    properties: {
      path: {
        type: "string" as const,
        description:
          "Hub path, e.g. 'candidates/Fontaine', 'templates/initial-outreach', 'facilities/Rush', 'games/401695431_nba', 'picks/pick_123'",
      },
    },
    required: ["path"],
  },
};

const INGEST_MARGIN_PAYLOAD_DECLARATION = {
  name: "ingest_margin_payload",
  description:
    "Persist pay package or margin approval data extracted from an Aya margin calculator, pay package, offer, or screenshot. Use record_phase='job' when no candidate is attached (pay package inventory). Use record_phase='margin' only when an offer/candidate is attached.",
  parameters: {
    type: "object" as const,
    properties: {
      view_type: {
        type: "string" as const,
        description: "Source view, for example pay_package_screenshot, margin_approval_screenshot, or aya_margin_calculator.",
      },
      source_kind: {
        type: "string" as const,
        description: "Capture source, normally screenshot_vision.",
      },
      screenshot_id: {
        type: "string" as const,
        description: "Saved image id when available.",
      },
      rows: {
        type: "array" as const,
        description: "One or more extracted pay package or margin rows.",
        items: {
          type: "object" as const,
          properties: {
            record_phase: { type: "string" as const, description: "job for pay package, margin for offer margin approval." },
            facility_name: { type: "string" as const },
            profession: { type: "string" as const },
            specialty: { type: "string" as const },
            job_id: { type: "string" as const },
            margin_id: { type: "string" as const },
            candidate_name: { type: "string" as const },
            start_date: { type: "string" as const },
            end_date: { type: "string" as const },
            shift_type: { type: "string" as const },
            shift_start_time: { type: "string" as const },
            shift_end_time: { type: "string" as const },
            weekly_hours: { type: "number" as const },
            base_pay_rate_usd: { type: "number" as const },
            weekly_stipends_usd: { type: "number" as const },
            gross_weekly_pay_usd: { type: "number" as const },
            target_margin_pct: { type: "number" as const },
            actual_margin_pct: { type: "number" as const },
            raw_text: { type: "string" as const },
          },
        },
      },
    },
    required: ["rows"],
  },
};

// --- Context Caching (Gemini only) ---
const cacheStore = new Map<string, { name: string; expireTime: number }>();

async function getOrCreateCache(mode: string, geminiModel: string, systemPrompt: string): Promise<string | null> {
  const cacheKey = `${mode}_${geminiModel}`;
  const now = Date.now();
  const existing = cacheStore.get(cacheKey);
  
  if (existing && existing.expireTime > now + 60_000) {
    return existing.name;
  }

  try {
    const cache = await ai.caches.create({
      model: geminiModel,
      config: {
        systemInstruction: systemPrompt,
        ttl: "1800s",
        displayName: `thelab-${cacheKey}`,
      },
    });
    
    if (cache.name) {
      cacheStore.set(cacheKey, {
        name: cache.name,
        expireTime: now + 30 * 60 * 1000,
      });
      console.log(`Cache created for "${cacheKey}": ${cache.name}`);
      return cache.name;
    }
  } catch (err) {
    console.warn(`Cache creation failed for "${cacheKey}", falling back to inline:`, err);
  }
  return null;
}

// --- System Prompts ---
const SYSTEM_PROMPTS: Record<string, string> = {
  healthcare: `You are a healthcare credentialing and compliance research assistant.
The user is in Pacific Time (PT / America/Los_Angeles). Always reference times in PT.
Your expertise: BLS/ACLS/PALS certification requirements, state licensing boards, CE/CME requirements, nursing compact states, credential verification, travel healthcare staffing, and regulatory compliance.
Be precise about dates, deadlines, and regulatory requirements. Use markdown formatting.`,

  sports: `You are a sports intelligence analyst with access to Google Search.
The user is in Pacific Time (PT / America/Los_Angeles). Always reference times in PT, not UTC or ET unless comparing.
Your expertise: injury reports, lineup changes, late scratches, betting market implications, DFS pricing, playoff scenarios, trade rumors, and game-day intel.
When the user references a specific game from workspace context, call access_hub({ path: "games/{id}" }) first to ground canonical game URLs and structured game data.
When the user asks for picks, output normalized pick contracts using canonical enums:
- market_type: SPREAD | TOTAL | MONEYLINE | PLAYER_PROP
- side: HOME | AWAY | OVER | UNDER
- priority_band: FEATURED | STANDARD | WATCH
- event_status: SCHEDULED | LIVE | FINAL | POSTPONED
- grading_status: PENDING | WON | LOST | PUSH | VOID
Use display_text for canonical pick wording.
Rationale length rule: FEATURED can use up to 280 chars. STANDARD and WATCH must stay at 140 chars or less.
For consumer settlement phrasing, keep it direct and bet-facing: "covered/hit/missed/lost" plus units. Avoid product-internal phrasing like "added to your track record."
Do not emit bracketed citation numbers. Fold source attribution into prose when useful, and let the Sources panel carry verification links. Be concise, factual, and direct. Prioritize recency, the freshest data wins. Use markdown formatting.`,

  code: `You are a senior software engineer with access to Google Search for documentation lookup.
The user is in Pacific Time (PT / America/Los_Angeles).
Your expertise: debugging, code review, architecture design, performance optimization, security analysis, and implementation across all major languages and frameworks.
Rules:
- Show code, don't describe it. If the fix is 3 lines, show the 3 lines.
- Always use fenced code blocks with the correct language tag.
- When reviewing code, be specific: line numbers, exact variable names, concrete alternatives.
- For architecture questions, think in trade-offs: what you gain, what you lose, and when each approach fits.
- Cite official documentation when referencing API behavior, library versions, or language specs.
- Use markdown formatting. Be direct.`,

  worldcup: `You are a World Cup match intelligence assistant.
The user is in Pacific Time (PT / America/Los_Angeles). Always reference times in PT.
Focus on fixture context, matchup risk factors, travel/load context, and actionable pre-match insights.
When the user asks to prepare or stage a publishable preview for human review, you MUST call prepare_match_preview instead of writing the full preview body directly in chat.
Canonical writeup URL format is https://thedrip.bet/worldcup/{fixture_id}. Use fixture_id-based URLs.
Use markdown formatting.`,

  ayaops: `You are an internal staffing operations assistant for a healthcare travel staffing agency.
The user is in Pacific Time (PT / America/Los_Angeles).
Your expertise: travel nurse assignments, candidate compliance status, facility credentialing, pay packages, assignment timelines, specialty matching, and recruiter workflows.

READ PATH (default):
- Candidate reads and summaries are grounded from URL sources via the access_hub tool, not ad-hoc candidate search.
- Dynamic resolver hub:
  - access_hub({ path: "candidates/{id_or_name}" }) → canonical candidate grounding payload + available actions.
  - access_hub({ path: "candidates?specialty={specialty}&status={status}&limit={n}" }) → candidate collection query for list/roster asks.
  - access_hub({ path: "dietitians?specialty={specialty}&status={status}&limit={n}" }) → shorthand alias for dietitian roster queries.
  - access_hub({ path: "facilities/{name}" }) → canonical facility grounding payload.
  - access_hub({ path: "jobs/{id}" }) → canonical job grounding payload.
  - access_hub({ path: "templates/{id_or_name}" }) → canonical template structure and required fields for drafting.
- Prefer grounded URL facts/citations over assumptions.
- Do not ask the user to paste raw JSON if grounded candidate context is available.

WRITE PATH (mutation only):
- If user pastes source="nova_candidate_profile" JSON, ingest it before follow-up writes.
- update_candidate_status: Execute real assignment status update.
- update_candidate_profession: Execute real profession/specialty update.
- add_candidate_note: Save note to candidate record.
- create_com_draft_email: Save COM email draft (never claim an email was sent).

MANDATORY RULES:
1. Reads come from grounded URL retrieval via access_hub. Writes go through write tools.
2. COLLECTION NAVIGATION MANDATE: If a recruiter asks for a list (candidates, deals, dietitians, facilities, jobs, submittals, contracts), treat it as queryable system data and run the list query flow, do not decline.
   - Assume a collection endpoint exists and apply available filters/sorts.
   - If a requested filter is not supported, return available results plus a clear capability gap in recruiter language, never an inability apology.
3. Resolve identity via URL hub before asking the user for IDs:
   - Call access_hub({ path: "candidates/{id_or_name}" }) first.
   - Once resolved, reuse the returned canonical ID for all tools in that turn.
4. If selected candidate context is present, treat it as authoritative unless user names a different candidate.
5. If candidate context is active and user says "him/her/them", reuse that candidate context for writes.
6. Never simulate tool calls. If a write is requested, execute the real write tool.
7. For status-change requests, call update_candidate_status and ground confirmation in returned write payload.
8. For note/save/log requests, call add_candidate_note and ground confirmation in returned write payload.
9. Only call create_com_draft_email when the user explicitly asks to save/log/store a draft in-system.
   If they only want wording/copy, return plain draft text with no write tool.
10. For profession/specialty changes, call update_candidate_profession and ground confirmation in returned write payload.
11. For copy/paste-ready drafts, never use markdown blockquotes (">") and do not wrap draft text in quotation marks.
12. Unless user asks for variants, provide one best draft.
13. When RingCentral SMS thread payload is provided, treat it as communications ingest and preserve raw thread details in write summary.
14. Use markdown formatting. Be direct and operational.
15. ANTI-CONTEXT-BLEED - HARD RULE: Each user message is its OWN intent. Prior conversation does NOT imply the next action.
    - NEVER draft an email/template unless the user's CURRENT message explicitly contains a word like "draft", "write", "send", "compose", "email", or "margin approval".
    - "Add this candidate" / "Pull this candidate" = candidate CRUD only. Find them, update them if needed, return their profile. Do NOT draft.
    - A screenshot upload = extract data from the screenshot. Do NOT assume the user wants a repeat of prior conversation workflows.
    - If the user's message does not explicitly request a draft, do NOT create one. Zero tolerance.
    - If an imageIntent directive is present (e.g. [INTENT: ADD_CANDIDATE]), follow that directive exactly and ignore all prior conversation context.
16. TEMPLATE ENFORCEMENT: If a user asks you to draft a specific breakdown, form, or email, you MUST execute access_hub({ path: "templates/<search>" }) FIRST to retrieve the correct structure before returning any copy. Never invent schemas organically.
17. RECRUITER-FACING RESPONSE VOICE: User-facing chat responses must use plain recruiter language, not operator/admin vocabulary.
    - Never use first-person system narration ("I updated", "I found", "I successfully...").
    - Never use operator/developer phrasing such as "Resource Resolved", "Items rendered", "Querying", "endpoint", "payload", "REST", or similar system jargon.
    - Prefer factual recruiter phrasing such as "12 dietitians match Renal specialty in your book."
18. DRAFTED COMMUNICATION VOICE: Email/SMS/Teams drafts written on behalf of recruiters preserve first-person recruiter voice ("I", "we").
19. NO INFRASTRUCTURE LEAKAGE IN CHAT: Never expose URLs, query strings, API paths, tool names, or internal system notes in recruiter-facing responses unless the user explicitly asks for technical details.
20. LIST INTENT FIT: For list queries, return concise results in recruiter language (count + top matches + suggested next actions). If results only partially match user intent, tighten filters or call out the gap and offer the next refinement.
21. TYPOGRAPHY: No em-dash or en-dash in user-facing copy, including drafted communications. Use commas, periods, parentheses, or "to".
22. WRITE HONESTY: Never say a package, offer, margin, note, draft, candidate, or profile was saved, attached, created, submitted, updated, or moved unless a real write tool or deterministic backend write executed in the current turn and returned success. If no write executed, say what is already true and what action is still needed.`,
};

const WORLDCUP_WRITEUP_BASE_URL = String(process.env.WORLDCUP_WRITEUP_BASE_URL || "https://thedrip.bet/worldcup")
  .trim()
  .replace(/\/+$/, "");

function buildCanonicalWorldCupWriteupUrl(fixtureId: string): string {
  return `${WORLDCUP_WRITEUP_BASE_URL}/${encodeURIComponent(String(fixtureId || "").trim())}`;
}

function normalizeWorldCupWriteupUrl(fixtureId: string, rawWriteupUrl: string): string | null {
  if (!fixtureId) return null;
  if (!rawWriteupUrl) return buildCanonicalWorldCupWriteupUrl(fixtureId);
  if (!/^https:\/\//i.test(rawWriteupUrl)) return null;
  return buildCanonicalWorldCupWriteupUrl(fixtureId);
}

const VISION_PROMPTS: Record<string, string> = {
  healthcare: "You are an expert healthcare document analyst. The user is in Pacific Time (PT). Analyze this image for: credential details (provider, cert type, expiration dates, ID numbers), compliance documents, license information, or any healthcare-related data. Extract all structured information. Use markdown formatting.",
  sports: "You are an expert sports visual analyst. The user is in Pacific Time (PT). Analyze this image for: box scores, lineups, injury reports, betting slips, DFS screenshots, standings, or any sports-related data. Extract all structured information. Use markdown formatting.",
  code: "You are an expert code analyst. The user is in Pacific Time (PT). Analyze this image for: code snippets, error messages, stack traces, terminal output, architecture diagrams, database schemas, or any development-related content. Extract the code or error text, identify the issue, and provide a fix. Use markdown formatting with correct language-tagged code blocks.",
  ayaops: "You are an expert recruiter and healthcare travel staffing visual analyst. Provide a rigorous, structured data extraction of this screenshot. Extract ALL candidate data, assignment parameters (Facility, Start/End Dates, Shift Types, Hours), and specific Financial/Pay data (Taxable Rate, Stipend, Gross Pay). Retain exact numerical values, IDs, and identifiers without modification.",
};

const SANDBOX_TOOL_DECLARATIONS = [
  {
    name: "prepare_match_preview",
    description:
      "Prepare a match preview document for sandbox review. Do not publish directly. This only stages a review task.",
    parameters: {
      type: "object" as const,
      properties: {
        fixture_id: { type: "string" as const },
        title: { type: "string" as const },
        markdown: { type: "string" as const },
        writeup_url: {
          type: "string" as const,
          description:
            "Optional absolute https URL. If omitted or non-canonical, backend stores canonical fixture URL https://thedrip.bet/worldcup/{fixture_id}.",
        },
      },
      required: ["fixture_id", "title", "markdown"],
    },
  },
  {
    name: "prepare_db_write",
    description:
      "Prepare a database write plan for sandbox review. Do not execute the write directly. This only stages a review task.",
    parameters: {
      type: "object" as const,
      properties: {
        title: { type: "string" as const },
        database: { type: "string" as const },
        table: { type: "string" as const },
        operation: { type: "string" as const },
        before: { type: "object" as const },
        after: { type: "object" as const },
        params: { type: "object" as const },
      },
      required: ["database", "table", "operation", "params"],
    },
  },
  {
    name: "prepare_api_call",
    description:
      "Prepare an external API request for sandbox review. Do not execute the API call directly. This only stages a review task.",
    parameters: {
      type: "object" as const,
      properties: {
        title: { type: "string" as const },
        method: { type: "string" as const },
        url: { type: "string" as const },
        headers: { type: "object" as const },
        body: { type: "object" as const },
      },
      required: ["method", "url"],
    },
  },
  {
    name: "prepare_email_draft",
    description:
      "Prepare a structured candidate/job email draft for sandbox review using fixed backend templates. Do not send directly.",
    parameters: {
      type: "object" as const,
      properties: {
        template_id: {
          type: "string" as const,
          description:
            "Email template id. Supports outreach, ops, response, and SMS-style template catalog IDs (for example: initial_outreach, pay_package_snippet, ops_reassignment, text_followup).",
        },
        candidate_id: { type: "string" as const, description: "Candidate internal UUID or Nova numeric ID." },
        job_id: { type: "string" as const, description: "Optional job identifier for traceability." },
        candidate: { type: "object" as const, description: "Candidate context object." },
        job: { type: "object" as const, description: "Job context object." },
        pay: { type: "object" as const, description: "Pay context object." },
        to_email: { type: "string" as const, description: "Primary recipient email." },
        cc: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Optional CC recipients. Keep empty by default.",
        },
      },
      required: ["template_id", "candidate_id"],
    },
  },
  {
    name: "prepare_agent_handoff",
    description:
      "Prepare a browser-agent handoff task that wraps a target Nova URL with instructions and expected return schema. This stages a middleware URL task for sandbox approval.",
    parameters: {
      type: "object" as const,
      properties: {
        title: { type: "string" as const },
        target_url: { type: "string" as const, description: "Absolute HTTP(S) URL to open after handoff." },
        source_surface: { type: "string" as const, description: "Source surface label, e.g. nova." },
        goal: { type: "string" as const, description: "One-sentence execution goal." },
        instructions: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Ordered extraction/analysis instructions.",
        },
        expected_return_schema: { type: "object" as const, description: "Structured return schema for results." },
        context: { type: "object" as const, description: "Optional task packet context payload." },
        auto_launch: { type: "boolean" as const, description: "If true, downstream agent may auto-launch target URL." },
      },
      required: ["target_url", "goal"],
    },
  },
];

const SANDBOX_TOOL_NAMES = new Set(
  SANDBOX_TOOL_DECLARATIONS.map((tool) => String((tool as { name?: string }).name || "")),
);

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function tryParseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return asJsonRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function normalizeSmartQuotes(value: string): string {
  return value
    .replace(/[\u201C\u201D\u201E\u2033\u00AB\u00BB]/g, '"')
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "");
}

// ── Safe JSON parse for intent tags ─────────────────────────────
function safeParseTags(raw: unknown): string[] {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((t) => String(t)) : [];
  } catch {
    return [];
  }
}

// ── Human-readable tool labels for SSE chips ────────────────────
const TOOL_LABELS: Record<string, string> = {
  access_hub: "Hub lookup",
  search_candidates: "Candidate search",
  get_candidate_by_id: "Candidate lookup",
  list_candidates_by_status: "Status filter",
  list_stale_prospects: "Prospect scan",
  get_candidate_profile_link: "Profile link",
  get_internal_grounding_context: "Context lookup",
  ingest_nova_profile: "Profile ingest",
  update_candidate_status: "Status mutation",
  update_candidate_profession: "Profession mutation",
  update_candidate_specialty: "Specialty mutation",
  add_candidate_note: "Note mutation",
  create_com_draft_email: "Draft mutation",
};
const TOOL_LABELS_DONE: Record<string, string> = {
  access_hub: "Record loaded",
  search_candidates: "Search resolved",
  get_candidate_by_id: "Candidate loaded",
  list_candidates_by_status: "Candidates listed",
  list_stale_prospects: "Prospects resolved",
  get_candidate_profile_link: "Profile link ready",
  get_internal_grounding_context: "Context loaded",
  ingest_nova_profile: "Profile ingested",
  update_candidate_status: "Status updated",
  update_candidate_profession: "Profession updated",
  update_candidate_specialty: "Specialty updated",
  add_candidate_note: "Note updated",
  create_com_draft_email: "Draft created",
};

function stripTrailingCommas(value: string): string {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
        quote = "";
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === ",") {
      let lookAhead = i + 1;
      while (lookAhead < value.length && /\s/.test(value[lookAhead])) lookAhead += 1;
      const next = value[lookAhead];
      if (next === "}" || next === "]") {
        continue;
      }
    }

    output += char;
  }

  return output;
}

function tryParseJsonRecordRelaxed(value: string): Record<string, unknown> | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalizedQuotes = normalizeSmartQuotes(raw);
  const candidates = [raw, normalizedQuotes, stripTrailingCommas(normalizedQuotes)];

  for (const candidate of candidates) {
    const parsed = tryParseJsonRecord(candidate);
    if (parsed) return parsed;
  }

  return null;
}

function extractJsonBlockContainingToken(input: string, token: string): Record<string, unknown> | null {
  const needle = token.toLowerCase();
  const lower = input.toLowerCase();
  const tokenIndex = lower.indexOf(needle);
  if (tokenIndex < 0) return null;

  const start = input.lastIndexOf("{", tokenIndex);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
        quote = "";
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return tryParseJsonRecordRelaxed(input.slice(start, index + 1));
      }
    }
  }

  return null;
}

function extractNovaCandidateProfilePayload(prompt: string): Record<string, unknown> | null {
  const input = String(prompt || "");
  if (!input) return null;
  const token = "nova_candidate_profile";

  const direct = tryParseJsonRecordRelaxed(input.trim());
  if (direct && String(direct.source || "").toLowerCase().includes(token)) {
    return direct;
  }

  const fencedMatches = input.match(/```(?:json)?\s*([\s\S]*?)```/gi) || [];
  for (const block of fencedMatches) {
    const raw = block.replace(/```(?:json)?/i, "").replace(/```$/, "").trim();
    const parsed = tryParseJsonRecordRelaxed(raw);
    if (parsed && String(parsed.source || "").toLowerCase().includes(token)) {
      return parsed;
    }
  }

  const embedded = extractJsonBlockContainingToken(input, token);
  if (embedded && String(embedded.source || "").toLowerCase().includes(token)) {
    return embedded;
  }
  return null;
}

function extractMarginCalculatorPayload(prompt: string): Record<string, unknown> | null {
  const input = String(prompt || "");
  if (!input) return null;
  const token = "aya_margin_calculator";

  const direct = tryParseJsonRecordRelaxed(input.trim());
  if (direct && String(direct.source || "").toLowerCase().includes(token)) {
    return direct;
  }

  const fencedMatches = input.match(/```(?:json)?\s*([\s\S]*?)```/gi) || [];
  for (const block of fencedMatches) {
    const raw = block.replace(/```(?:json)?/i, "").replace(/```$/, "").trim();
    const parsed = tryParseJsonRecordRelaxed(raw);
    if (parsed && String(parsed.source || "").toLowerCase().includes(token)) {
      return parsed;
    }
  }

  const embedded = extractJsonBlockContainingToken(input, token);
  if (embedded && String(embedded.source || "").toLowerCase().includes(token)) {
    return embedded;
  }
  return null;
}

function extractRingCentralThreadPayload(prompt: string): Record<string, unknown> | null {
  const input = String(prompt || "");
  if (!input) return null;
  const token = "ringcentral";

  const direct = tryParseJsonRecordRelaxed(input.trim());
  if (isLikelyRingCentralThreadPayload(direct)) return direct;

  const fencedMatches = input.match(/```(?:json)?\s*([\s\S]*?)```/gi) || [];
  for (const block of fencedMatches) {
    const raw = block.replace(/```(?:json)?/i, "").replace(/```$/, "").trim();
    const parsed = tryParseJsonRecordRelaxed(raw);
    if (isLikelyRingCentralThreadPayload(parsed)) return parsed;
  }

  const embedded = extractJsonBlockContainingToken(input, token);
  if (isLikelyRingCentralThreadPayload(embedded)) return embedded;

  return null;
}

function containsNovaPayloadHint(prompt: string): boolean {
  const input = String(prompt || "");
  if (!input) return false;
  const normalized = input.toLowerCase();
  if (normalized.includes("nova_candidate_profile")) return true;
  if (/nova\.ayahealthcare\.com\/#\/recruiting\/candidates\/\d+/i.test(input)) return true;
  return false;
}

function containsMarginPayloadHint(prompt: string): boolean {
  const input = String(prompt || "");
  if (!input) return false;
  const normalized = input.toLowerCase();
  if (normalized.includes("aya_margin_calculator")) return true;
  if (/\bmargin_calc_id\b/i.test(input) && /\{[\s\S]*\}/.test(input)) return true;
  if (/\bjob_context_id\b/i.test(input) && /\{[\s\S]*\}/.test(input)) return true;
  return false;
}

function containsRingCentralPayloadHint(prompt: string): boolean {
  const input = String(prompt || "");
  if (!input) return false;
  const normalized = input.toLowerCase();
  if (normalized.includes("ringcentral")) return true;
  if (/\bvisible_messages\b/i.test(input) && /\bparticipants\b/i.test(input)) return true;
  if (/\blatest_inbound_message\b/i.test(input) && /\blatest_outbound_message\b/i.test(input)) return true;
  return false;
}

function requiresPostIngestWrite(prompt: string): boolean {
  const normalized = String(prompt || "").toLowerCase();
  const noteIntent = /\b(note|notes|log|logged|attach|comment)\b/.test(normalized);
  const draftIntent = /\b(draft|email|message|outreach|reply|sms|text)\b/.test(normalized);
  const statusIntent =
    /\b(update|change|move|set)\b/.test(normalized) &&
    /\b(status|review|working|submitted|offer|prestart|done|on assignment)\b/.test(normalized);
  return noteIntent || draftIntent || statusIntent;
}

function isPayPackageSaveIntent(prompt: string): boolean {
  const normalized = String(prompt || "").toLowerCase();
  if (!/\b(save|store|log|persist|attach)\b/.test(normalized)) return false;
  return /\b(pay\s*package|package details|package|rate details|assignment details)\b/.test(normalized);
}

function buildEventStreamResponse(
  events: Array<Record<string, unknown>>,
  routeMeta: { provider: string; model: string; reason: string },
) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Model-Provider": routeMeta.provider,
      "X-Model-Id": routeMeta.model,
      "X-Route-Reason": routeMeta.reason,
    },
  });
}

type SelectedCandidateContext = {
  candidate_id: string | null;
  nova_id: string | null;
  candidate_name: string | null;
  candidate_email: string | null;
  current_bucket: string | null;
  source: string | null;
};

type SelectedMarginContext = {
  object_type: string | null;
  record_phase: string | null;
  pay_package_id: string | null;
  margin_object_id: string | null;
  job_id: string | null;
  margin_id: string | null;
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
};

function normalizeSelectedCandidateContext(value: unknown): SelectedCandidateContext | null {
  const input = asJsonRecord(value);
  if (!input) return null;
  const candidateId = readString(input.candidate_id || input.candidateId) || null;
  const novaId = readString(input.nova_id || input.novaId) || null;
  const candidateName = readString(input.candidate_name || input.candidateName) || null;
  const candidateEmail = readString(input.candidate_email || input.candidateEmail || input.email) || null;
  const currentBucket = readString(input.current_bucket || input.currentBucket) || null;
  const source = readString(input.source) || null;
  if (!candidateId && !novaId && !candidateName) return null;
  return {
    candidate_id: candidateId,
    nova_id: novaId,
    candidate_name: candidateName,
    candidate_email: candidateEmail,
    current_bucket: currentBucket,
    source,
  };
}

function normalizeSelectedMarginContext(value: unknown): SelectedMarginContext | null {
  const input = asJsonRecord(value);
  if (!input) return null;
  const toNumber = (entry: unknown): number | null => {
    if (typeof entry === "number" && Number.isFinite(entry)) return entry;
    if (typeof entry === "string") {
      const parsed = Number(entry.replace(/[$,%\s,]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };
  const context: SelectedMarginContext = {
    object_type: readString(input.object_type || input.objectType) || null,
    record_phase: readString(input.record_phase || input.recordPhase) || null,
    pay_package_id: readString(input.pay_package_id || input.payPackageId) || null,
    margin_object_id: readString(input.margin_object_id || input.marginObjectId) || null,
    job_id: readString(input.job_id || input.jobId) || null,
    margin_id: readString(input.margin_id || input.marginId) || null,
    candidate_name: readString(input.candidate_name || input.candidateName) || null,
    profession: readString(input.profession) || null,
    specialty: readString(input.specialty) || null,
    facility_name: readString(input.facility_name || input.facilityName) || null,
    facility_city: readString(input.facility_city || input.facilityCity) || null,
    facility_state: readString(input.facility_state || input.facilityState) || null,
    assignment_start: readString(input.assignment_start || input.assignmentStart) || null,
    assignment_end: readString(input.assignment_end || input.assignmentEnd) || null,
    weekly_gross: toNumber(input.weekly_gross || input.weeklyGross),
    actual_margin_pct: toNumber(input.actual_margin_pct || input.actualMarginPct),
    target_margin_pct: toNumber(input.target_margin_pct || input.targetMarginPct),
    base_pay_rate: toNumber(input.base_pay_rate || input.basePayRate),
    weekly_stipends: toNumber(input.weekly_stipends || input.weeklyStipends),
    weekly_hours: toNumber(input.weekly_hours || input.weeklyHours),
    shift_type: readString(input.shift_type || input.shiftType) || null,
    shift_start: readString(input.shift_start || input.shiftStart) || null,
    shift_end: readString(input.shift_end || input.shiftEnd) || null,
  };
  if (!context.candidate_name && !context.facility_name) return null;
  return context;
}

function isOfferStatusIntent(prompt: string): boolean {
  const normalized = String(prompt || "").toLowerCase();
  if (!normalized) return false;
  return (
    /\b(has|got|received)\s+(an?\s+)?offer\b/.test(normalized) ||
    /\bmove\b[\s\w]{0,24}\bto\b[\s\w]{0,24}\boffer\b/.test(normalized) ||
    /\b(mark|set|update|change)\b[\s\w]{0,24}\boffer\b/.test(normalized)
  );
}

function nextSandboxTaskId(): string {
  return `sb_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function normalizeStringMap(value: unknown): Record<string, string> {
  const record = asJsonRecord(value) || {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    out[key] = String(entry);
  }
  return out;
}

function normalizeSandboxDatabaseName(value: unknown): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "recruitingdb";
  if (["internal", "recruiting", "recruiting_db", "recruitingdb"].includes(normalized)) {
    return "recruitingdb";
  }
  if (["worldcup", "worldcup_db", "worldcupdb"].includes(normalized)) {
    return "worldcupdb";
  }
  if (["sports", "sports_db", "sportsdb"].includes(normalized)) {
    return "sportsdb";
  }
  return normalized;
}

function readString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

function deriveAyaopsReadFallbackHubPath(
  prompt: string,
  selectedCandidateInput?: string,
): string {
  const raw = readString(prompt);
  if (!raw) return "";
  const lower = raw.toLowerCase();

  const selected = readString(selectedCandidateInput);
  if (selected && /\b(him|her|them|candidate|profile|record)\b/.test(lower)) {
    return `candidates/${selected}`;
  }

  if (/\bworking\b[\s\w]{0,24}\bcandidates?\b/.test(lower)) return "candidates/working";
  if (/\bprestart(s)?\b/.test(lower)) return "candidates/prestart";
  if (/\bdietitian(s)?\b/.test(lower)) return `dietitians/${raw}`;
  if (/\bcandidates?\b/.test(lower)) return `candidates/${raw}`;

  const lookupMatch = raw.match(
    /(?:pull up|bring up|show|open|find|get|lookup|look up|check)\s+([A-Za-z][A-Za-z'.-]+(?:\s+[A-Za-z][A-Za-z'.-]+)+)/i,
  );
  if (lookupMatch?.[1]) {
    return `candidates/${lookupMatch[1].trim()}`;
  }

  return "";
}

function buildAyaopsHubFallbackText(hubResult: unknown): string {
  const payload = asJsonRecord(hubResult);
  if (!payload) return "";

  const type = readString(payload.type).toLowerCase();
  const status = readString(payload.status).toLowerCase();
  const summary = readString(payload.summary);
  const data = asJsonRecord(payload.data);

  if (type === "candidate_collection" && data) {
    const items = Array.isArray(data.items) ? data.items : [];
    const countRaw = Number(data.count);
    const count = Number.isFinite(countRaw) ? countRaw : items.length;
    const topNames = items
      .slice(0, 3)
      .map((item) => readString((item as Record<string, unknown>).name))
      .filter(Boolean);

    if (count <= 0) return summary || "No matching candidates were found.";
    if (topNames.length === 0) return `${count} candidates match your filters.`;
    return `${count} candidates match your filters. Top ${topNames.length}: ${topNames.join(", ")}.`;
  }

  if (type === "candidate") {
    if (status === "resolved") return summary || "Candidate record loaded.";
    if (status === "ambiguous" || status === "not_found") return summary;
  }

  return summary;
}

function shortStableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function deriveWriteResultTransactionId(event: Record<string, unknown>): string {
  const payload = asJsonRecord(event.payload) || {};
  const changedFields =
    payload.changed_fields && typeof payload.changed_fields === "object"
      ? JSON.stringify(payload.changed_fields)
      : "";
  const signature = [
    readString(event.action || payload.action),
    readString(event.outcome || payload.outcome),
    readString(event.objectType || event.object_type || payload.object_type),
    readString(event.rowsUpdated ?? event.rows_updated ?? payload.rows_updated),
    readString(event.code || payload.code),
    readString(payload.candidate_id),
    readString(payload.nova_id),
    readString(payload.thread_id),
    readString(payload.note_id),
    readString(payload.event_id),
    readString(payload.write_timestamp || payload.updated_at || payload.created_at),
    changedFields,
  ].join("|");
  return `tx_${shortStableHash(signature)}`;
}

function buildWriteResultEvent(event: Record<string, unknown>): Record<string, unknown> {
  if (String(event.type || "") !== "write_result") return event;
  const transactionId =
    readString(event.transaction_id) ||
    readString(event.transactionId) ||
    deriveWriteResultTransactionId(event);
  const normalized = { ...event, transaction_id: transactionId } as Record<string, unknown>;
  if ("transactionId" in normalized) delete normalized.transactionId;
  return normalized;
}

function normalizeHttpUri(value: unknown): string {
  const uri = readString(value);
  if (!uri) return "";
  if (!/^https?:\/\//i.test(uri)) return "";
  return uri;
}

function extractGroundingPayload(meta: unknown): {
  queries: string[];
  citations: Array<{ title: string; uri: string }>;
} {
  const record = asJsonRecord(meta) || {};
  const queries = Array.isArray(record.webSearchQueries)
    ? record.webSearchQueries.map((entry) => readString(entry)).filter(Boolean)
    : [];

  const citations: Array<{ title: string; uri: string }> = [];
  const seen = new Set<string>();
  const addCitation = (uriValue: unknown, titleValue?: unknown) => {
    const uri = normalizeHttpUri(uriValue);
    if (!uri || seen.has(uri)) return;
    seen.add(uri);
    citations.push({
      title: readString(titleValue) || "Source",
      uri,
    });
  };

  const walk = (value: unknown, depth = 0) => {
    if (depth > 5 || value == null) return;

    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1);
      return;
    }

    if (typeof value === "string") {
      addCitation(value, "Source");
      return;
    }

    const node = asJsonRecord(value);
    if (!node) return;

    addCitation(
      node.uri ?? node.url ?? node.link ?? node.sourceUri ?? node.source_url,
      node.title ?? node.displayName ?? node.label ?? node.name,
    );

    const webNode = asJsonRecord(node.web);
    if (webNode) {
      addCitation(webNode.uri ?? webNode.url, webNode.title ?? webNode.displayName ?? webNode.name);
    }

    const retrievedNode = asJsonRecord(node.retrievedContext);
    if (retrievedNode) {
      addCitation(
        retrievedNode.uri ?? retrievedNode.url ?? retrievedNode.sourceUri,
        retrievedNode.title ?? retrievedNode.displayName ?? retrievedNode.name,
      );
    }

    for (const nested of Object.values(node)) {
      if (nested && typeof nested === "object") walk(nested, depth + 1);
    }
  };

  walk(record.groundingChunks);

  if (citations.length === 0) {
    const searchEntryPoint = asJsonRecord(record.searchEntryPoint);
    const renderedContent = readString(searchEntryPoint?.renderedContent);
    if (renderedContent) {
      const hrefRegex = /href=["'](https?:\/\/[^"']+)["']/gi;
      let match: RegExpExecArray | null = null;
      while ((match = hrefRegex.exec(renderedContent)) !== null) {
        addCitation(match[1], "Search result");
      }
    }
  }

  return { queries, citations };
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,\s]/g, "");
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function formatCurrency(value: number | null): string {
  if (value == null) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatHumanDate(value: string): string {
  const trimmed = readString(value);
  if (!trimmed) return "";
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return trimmed;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function buildUserFacingLookupErrorMessage(toolName: string, rawError: unknown): string {
  const name = String(toolName || "lookup");
  const error = String(rawError ?? "");

  if (/CANDIDATE_NOT_FOUND|CANDIDATE_IDENTITY_AMBIGUOUS/i.test(error)) {
    return "Could not match that candidate. Try full name or candidate ID.";
  }
  if (/UNIMPLEMENTED|Unsupported built-in function/i.test(error)) {
    return "This lookup is temporarily unavailable. Please retry in a minute.";
  }
  if (/PERMISSION_DENIED|UNAUTHENTICATED/i.test(error)) {
    return "Could not complete that lookup due to access limits. Please retry.";
  }
  if (/DEADLINE_EXCEEDED|timeout/i.test(error)) {
    return "Lookup timed out. Please retry.";
  }
  return `Could not complete ${name.replace(/_/g, " ")} right now. Please retry.`;
}

type AyaopsRosterDigest = {
  total: number;
  statuses: Record<string, number>;
  specialties: Record<string, number>;
};

function normalizeAyaopsRosterDigest(input: unknown): AyaopsRosterDigest | null {
  const record = asJsonRecord(input);
  if (!record) return null;

  const totalRaw = Number(record.total);
  const total = Number.isFinite(totalRaw) && totalRaw >= 0 ? Math.floor(totalRaw) : 0;

  const normalizeBucket = (value: unknown): Record<string, number> => {
    const bucket = asJsonRecord(value);
    if (!bucket) return {};
    const entries = Object.entries(bucket)
      .map(([key, count]) => {
        const normalizedKey = readString(key).toLowerCase();
        const normalizedCount = Number(count);
        if (!normalizedKey || !Number.isFinite(normalizedCount) || normalizedCount <= 0) return null;
        return [normalizedKey, Math.floor(normalizedCount)] as const;
      })
      .filter((entry): entry is readonly [string, number] => Boolean(entry))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);
    return Object.fromEntries(entries);
  };

  const statuses = normalizeBucket(record.statuses);
  const specialties = normalizeBucket(record.specialties);

  if (total <= 0 && Object.keys(statuses).length === 0 && Object.keys(specialties).length === 0) {
    return null;
  }

  return { total, statuses, specialties };
}

function inferAyaopsCollectionHubPath(prompt: string): string {
  const normalized = readString(prompt).replace(/\s+/g, " ");
  if (!normalized) return "";

  if (/^(candidates|dietitians)(\/|\?|$)/i.test(normalized)) {
    return normalized;
  }

  const lower = normalized.toLowerCase();
  const listVerb = /\b(show|list|find|get|pull|rank|sort|filter|which|who|how many|top)\b/.test(lower);
  const rosterEntity = /\b(candidates?|dietitians?|nurses?|travelers?)\b/.test(lower);
  const rosterQualifier = /\b(all|working|active|prestart|pending|pipeline|submitted|completed|cold|replied|renal)\b/.test(
    lower,
  );
  const explicitCollectionIntent =
    /\b(candidates?|dietitians?|nurses?|travelers?)\b/.test(lower) &&
    /\b(all|list|roster|show|find|get|pull|rank|sort|filter|which|who|how many|top|me)\b/.test(
      lower,
    );
  const singleCandidateLikely =
    Boolean(inferCandidateNameFromPrompt(normalized)) &&
    !/\b(all|list|roster|top|how many|which|who)\b/.test(lower);

  if (singleCandidateLikely && !explicitCollectionIntent) return "";
  if (!((listVerb && (rosterEntity || rosterQualifier)) || (rosterEntity && rosterQualifier))) return "";

  if (/\bdietitians?\b/.test(lower)) {
    return `dietitians/${normalized}`;
  }
  return `candidates/${normalized}`;
}

function inferCandidateUrlInput(input: {
  selectedContext: SelectedCandidateContext | null;
  uiContext?: { threadId?: string; candidateId?: string; candidateName?: string };
  prompt: string;
  history?: { role: string; text: string }[];
}): string {
  const selected = readString(input.selectedContext?.candidate_id || input.selectedContext?.nova_id);
  if (selected) return selected;
  const fromUi = readString(input.uiContext?.candidateId);
  if (fromUi) return fromUi;
  const fromUiName = readString(input.uiContext?.candidateName);
  if (fromUiName) return fromUiName;
  const promptText = String(input.prompt || "");

  const uuidMatch = promptText.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i);
  if (uuidMatch) return uuidMatch[0];

  const labeledNumericIdMatch = promptText.match(
    /\b(candidate[_\s-]?id|nova[_\s-]?id|candidate|nova)\b[\s:#-]{0,12}(\d{6,10})\b/i,
  );
  if (labeledNumericIdMatch?.[2]) return labeledNumericIdMatch[2];

  if (/\b(candidate|nova|profile)\b/i.test(promptText)) {
    const numericMatches = Array.from(promptText.matchAll(/\b\d{6,10}\b/g));
    for (const match of numericMatches) {
      const value = readString(match[0]);
      if (!value) continue;
      const start = Number(match.index || 0);
      const leftWindow = promptText.slice(Math.max(0, start - 24), start).toLowerCase();
      if (/\b(call|text|sms|phone|tel|mobile)\b/.test(leftWindow)) continue;
      const rightWindow = promptText.slice(start + value.length, start + value.length + 8);
      if (/[%$]/.test(rightWindow) || /[%$]/.test(leftWindow)) continue;
      return value;
    }
  }

  const fromPromptName = inferCandidateNameFromPrompt(promptText);
  if (fromPromptName) return fromPromptName;

  const fromHistory = inferCandidateInputFromHistory(input.history);
  if (fromHistory) return fromHistory;

  return "";
}

function inferCandidateNameFromPrompt(prompt: string): string {
  const normalized = readString(prompt).replace(/\s+/g, " ");
  if (!normalized) return "";

  const patterns = [
    /\b(?:look up|pull up|find|get|show|summarize|open|status(?: of)?|move|update|draft|about|status of|how is|with|for|tell me about|check on)\s+([a-z][a-z'`.-]*(?:\s+[a-z][a-z'`.-]*){0,2})(?=\s+(?:to|into|for|in|on|with|about)\b|[?.!,]|$)/i,
    /\bcandidate\s+([a-z][a-z'`.-]*(?:\s+[a-z][a-z'`.-]*){0,2})(?=\s+(?:to|into|for|in|on)\b|[?.!,]|$)/i,
    /\b([a-z][a-z'`.-]*(?:\s+[a-z][a-z'`.-]*){0,2})'s\s+(?:assignment|status|profile|contract|availability|email|phone|details)\b/i,
  ];

  let candidatePhrase = "";
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      candidatePhrase = readString(match[1]);
      if (candidatePhrase) break;
    }
  }

  if (!candidatePhrase) return "";

  const lowered = candidatePhrase.toLowerCase();
  if (
    [
      "me",
      "my",
      "us",
      "our",
      "him",
      "her",
      "them",
      "this candidate",
      "that candidate",
      "candidate",
      "the candidate",
      "the margin",
      "a pay",
      "pay package",
    ].includes(lowered)
  ) {
    return "";
  }

  if (
    /\b(candidates?|dietitians?|nurses?|travelers?|prestarts?|roster|list)\b/.test(lowered)
  ) {
    return "";
  }

  return candidatePhrase;
}

function inferCandidateInputFromHistory(history?: { role: string; text: string }[]): string {
  if (!Array.isArray(history) || history.length === 0) return "";

  const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
  const novaIdPattern = /\b\d{6,10}\b/;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const text = readString(history[index]?.text);
    if (!text) continue;

    const canonicalUrlMatch = text.match(/\/c\/([0-9a-f-]{36}|\d{6,10})\b/i);
    if (canonicalUrlMatch && canonicalUrlMatch[1]) {
      return canonicalUrlMatch[1];
    }

    const labeledIdMatch = text.match(
      /\b(candidate[_\s-]?id|nova[_\s-]?id|candidate)\b[\s:#-]{0,12}([0-9a-f-]{36}|\d{6,10})\b/i,
    );
    if (labeledIdMatch && labeledIdMatch[2]) {
      return labeledIdMatch[2];
    }

    const uuidMatch = text.match(uuidPattern);
    if (uuidMatch) return uuidMatch[0];

    // Only use raw numeric fallback for explicit ID-like phrasing to avoid phone/date collisions.
    if (/\b(id|candidate|nova)\b/i.test(text)) {
      const numericMatch = text.match(novaIdPattern);
      if (numericMatch) return numericMatch[0];
    }
  }

  return "";
}

const TEMPLATE_CATALOG = [
  ...OUTREACH_EMAIL_TEMPLATES,
  ...OPS_EMAIL_TEMPLATES,
  ...RESPONSE_EMAIL_TEMPLATES,
];

const TEMPLATE_CATALOG_ID_LIST = Array.from(new Set(TEMPLATE_CATALOG.map((template) => String(template.id || "").trim())))
  .filter(Boolean)
  .sort();

type EmailTemplateId = string;

type RenderedEmailDraft = {
  templateId: EmailTemplateId;
  candidateId: string;
  jobId?: string;
  toEmail: string;
  cc: string[];
  subject: string;
  body: string;
  noteContent: string;
  allowSendNow: boolean;
};

function buildInitialOutreachDraft(args: Record<string, unknown>): RenderedEmailDraft | { error: string } {
  const templateId = "initial_outreach";
  const candidate = asJsonRecord(args.candidate) || {};
  const job = asJsonRecord(args.job) || {};
  const pay = asJsonRecord(args.pay) || {};

  const candidateId = readString(args.candidate_id || args.candidateId);
  const jobId = readString(args.job_id || args.jobId) || undefined;
  const firstName = readString(candidate.first_name || candidate.firstName || args.first_name);
  const specialty = readString(job.specialty || args.specialty);
  const facilityName = readString(job.facility_name || job.facilityName || args.facility_name);
  const city = readString(job.city || args.city);
  const state = readString(job.state || args.state);
  const startDateRaw = readString(job.start_date || job.startDate || args.start_date);
  const endDateRaw = readString(job.end_date || job.endDate || args.end_date);
  const shiftType = readString(job.shift_type || job.shiftType || args.shift_type);
  const weeklyHours = readNumber(job.weekly_hours ?? job.weeklyHours ?? args.weekly_hours);
  const taxableRate = readNumber(pay.taxable_hourly_rate ?? pay.taxableRate ?? args.taxable_rate);
  const weeklyStipend = readNumber(pay.weekly_stipend_total ?? pay.weeklyStipend ?? args.weekly_stipend);
  const grossWeeklyPay = readNumber(pay.gross_weekly_pay ?? pay.grossWeeklyPay ?? args.gross_weekly_pay);
  const toEmail = readString(args.to_email || args.toEmail || candidate.email);
  const cc = Array.isArray(args.cc)
    ? args.cc.map((entry) => readString(entry)).filter(Boolean)
    : [];

  const missing: string[] = [];
  if (!candidateId) missing.push("candidate_id");
  if (!firstName) missing.push("candidate.first_name");
  if (!specialty) missing.push("job.specialty");
  if (!facilityName) missing.push("job.facility_name");
  if (!city) missing.push("job.city");
  if (!state) missing.push("job.state");
  if (!startDateRaw) missing.push("job.start_date");
  if (!endDateRaw) missing.push("job.end_date");
  if (!shiftType) missing.push("job.shift_type");
  if (weeklyHours == null) missing.push("job.weekly_hours");
  if (taxableRate == null) missing.push("pay.taxable_hourly_rate");
  if (weeklyStipend == null) missing.push("pay.weekly_stipend_total");
  if (grossWeeklyPay == null) missing.push("pay.gross_weekly_pay");
  if (!toEmail) missing.push("to_email");
  if (toEmail && !isLikelyEmail(toEmail)) missing.push("to_email(valid)");

  if (missing.length > 0) {
    return {
      error:
        `initial_outreach missing/invalid required fields: ${missing.join(", ")}.`,
    };
  }

  const startDate = formatHumanDate(startDateRaw);
  const endDate = formatHumanDate(endDateRaw);
  const taxableRateFormatted = formatCurrency(taxableRate);
  const weeklyStipendFormatted = formatCurrency(weeklyStipend);
  const grossWeeklyPayFormatted = formatCurrency(grossWeeklyPay);
  const weeklyHoursText = Number.isInteger(weeklyHours) ? String(weeklyHours) : String(weeklyHours);

  const subject = `${specialty} Assignment at ${facilityName} | ${grossWeeklyPayFormatted}/week`;
  const body = [
    `Hi ${firstName},`,
    ``,
    `Thanks for your interest in the ${specialty} position at ${facilityName}. Here is the full breakdown, this looks like a strong fit for your background:`,
    ``,
    `Facility: ${facilityName}`,
    `Location: ${city}, ${state}`,
    `Assignment Dates: ${startDate} to ${endDate}`,
    `Shifts & Hours: ${shiftType} (${weeklyHoursText} hours/week)`,
    ``,
    `Pay Package:`,
    `Taxable Hourly Rate: ${taxableRateFormatted}/hr`,
    `Meals & Housing Stipend: ${weeklyStipendFormatted}/week`,
    `Total Gross Weekly Pay: ${grossWeeklyPayFormatted}`,
    ``,
    `If this looks like a good fit, I can help move this along today and make sure you are submitted ASAP.`,
    ``,
    `To get everything ready, please confirm:`,
    `- Are you available to start ${startDate}?`,
    `- Do you have any time-off requests during the contract?`,
    `- Is your Aya profile current with your work history and skills checklist?`,
    ``,
    `Please also send over your current certifications. If your profile is not fully updated yet, no worries. You can send me your current resume too, and I can help keep things moving.`,
    ``,
    `Please let me know if you have any questions.`,
    ``,
    `Thank you!`,
  ].join("\n");

  const noteContent = [
    "Email draft created",
    `Template: ${templateId}`,
    `Subject: ${subject}`,
    `Recipient: ${toEmail}`,
    "Status: Draft saved",
  ].join("\n");

  return {
    templateId,
    candidateId,
    jobId,
    toEmail,
    cc,
    subject,
    body,
    noteContent,
    allowSendNow: true,
  };
}

function buildPayPackageSnippetDraft(args: Record<string, unknown>): RenderedEmailDraft | { error: string } {
  const templateId = "pay_package_snippet";
  const candidate = asJsonRecord(args.candidate) || {};
  const job = asJsonRecord(args.job) || {};
  const pay = asJsonRecord(args.pay) || {};

  const candidateId = readString(args.candidate_id || args.candidateId);
  const jobId = readString(args.job_id || args.jobId) || undefined;
  const toEmail = readString(args.to_email || args.toEmail || candidate.email);
  const cc = Array.isArray(args.cc)
    ? args.cc.map((entry) => readString(entry)).filter(Boolean)
    : [];

  const facilityName = readString(job.facility_name || job.facilityName || args.facility_name);
  const city = readString(job.city || args.city);
  const state = readString(job.state || args.state);
  const startDateRaw = readString(job.start_date || job.startDate || args.start_date);
  const endDateRaw = readString(job.end_date || job.endDate || args.end_date);
  const shiftType = readString(job.shift_type || job.shiftType || args.shift_type);
  const weeklyHours = readNumber(job.weekly_hours ?? job.weeklyHours ?? args.weekly_hours);
  const specialty = readString(job.specialty || args.specialty);
  const taxableRate = readNumber(pay.taxable_hourly_rate ?? pay.taxableRate ?? args.taxable_rate);
  const mealsStipend = readNumber(pay.meals_stipend ?? args.meals_stipend);
  const housingStipend = readNumber(pay.housing_stipend ?? args.housing_stipend);
  const totalStipends = readNumber(
    pay.total_stipends ?? pay.weekly_stipend_total ?? args.total_stipends ?? args.weekly_stipend,
  );
  const grossWeeklyPay = readNumber(pay.gross_weekly_pay ?? pay.grossWeeklyPay ?? args.gross_weekly_pay);

  const missing: string[] = [];
  if (!candidateId) missing.push("candidate_id");
  if (!toEmail) missing.push("to_email");
  if (toEmail && !isLikelyEmail(toEmail)) missing.push("to_email(valid)");
  if (!facilityName) missing.push("job.facility_name");
  if (!city) missing.push("job.city");
  if (!state) missing.push("job.state");
  if (!startDateRaw) missing.push("job.start_date");
  if (!endDateRaw) missing.push("job.end_date");
  if (!shiftType) missing.push("job.shift_type");
  if (weeklyHours == null) missing.push("job.weekly_hours");
  if (!specialty) missing.push("job.specialty");
  if (taxableRate == null) missing.push("pay.taxable_hourly_rate");
  if (mealsStipend == null) missing.push("pay.meals_stipend");
  if (housingStipend == null) missing.push("pay.housing_stipend");
  if (totalStipends == null) missing.push("pay.total_stipends");
  if (grossWeeklyPay == null) missing.push("pay.gross_weekly_pay");

  if (missing.length > 0) {
    return {
      error: `pay_package_snippet missing/invalid required fields: ${missing.join(", ")}.`,
    };
  }

  const startDate = formatHumanDate(startDateRaw);
  const endDate = formatHumanDate(endDateRaw);
  const weeklyHoursText = Number.isInteger(weeklyHours) ? String(weeklyHours) : String(weeklyHours);

  const subject = "Pay Package & Facility Info";
  const body = [
    `Facility: ${facilityName}`,
    `Location: ${city}, ${state}`,
    `Assignment Dates: ${startDate} to ${endDate}`,
    `Shifts & Hours/Week: ${shiftType} (${weeklyHoursText} hours/week)`,
    `Specialty: ${specialty}`,
    ``,
    `Pay Package:`,
    `Taxable Hourly Rate: ${formatCurrency(taxableRate)}/hr`,
    `Weekly Meals Stipend: ${formatCurrency(mealsStipend)}`,
    `Weekly Housing Stipend: ${formatCurrency(housingStipend)}`,
    `Total Weekly Stipends (Meals + Housing): ${formatCurrency(totalStipends)}`,
    `Total Gross Weekly Pay for ${weeklyHoursText} Hours Worked: ${formatCurrency(grossWeeklyPay)}`,
  ].join("\n");

  const noteContent = [
    "Email draft created",
    `Template: ${templateId}`,
    `Subject: ${subject}`,
    `Recipient: ${toEmail}`,
    "Status: Draft saved",
  ].join("\n");

  return {
    templateId,
    candidateId,
    jobId,
    toEmail,
    cc,
    subject,
    body,
    noteContent,
    allowSendNow: false,
  };
}

function buildOpsReassignmentDraft(args: Record<string, unknown>): RenderedEmailDraft | { error: string } {
  const templateId = "ops_reassignment";
  const candidate = asJsonRecord(args.candidate) || {};
  const candidateId = readString(args.candidate_id || args.candidateId);
  const jobId = readString(args.job_id || args.jobId) || undefined;
  const cc = Array.isArray(args.cc)
    ? args.cc.map((entry) => readString(entry)).filter(Boolean)
    : [];

  const candidateName =
    readString(candidate.full_name || candidate.candidate_name || candidate.display_name || args.candidate_name) ||
    [readString(candidate.first_name), readString(candidate.last_name)].filter(Boolean).join(" ").trim();
  const candidateEmail = readString(candidate.email || args.candidate_email || args.to_email);
  const explicitNovaProfileUrl = readString(
    candidate.nova_profile_url || candidate.novaUrl || candidate.profile_url || args.nova_profile_url || args.profile_url,
  );
  const resolvedNovaId =
    readString(candidate.nova_id || candidate.novaId || args.nova_id) ||
    (/^\d+$/.test(candidateId) ? candidateId : "");
  const novaProfileUrl =
    explicitNovaProfileUrl ||
    (resolvedNovaId
      ? `https://nova.ayahealthcare.com/#/recruiting/candidates/${resolvedNovaId}/new-profile/about`
      : "");

  const missing: string[] = [];
  if (!candidateId) missing.push("candidate_id");
  if (!candidateName) missing.push("candidate.full_name");
  if (!candidateEmail) missing.push("candidate.email");
  if (candidateEmail && !isLikelyEmail(candidateEmail)) missing.push("candidate.email(valid)");
  if (!novaProfileUrl) missing.push("candidate.nova_profile_url");

  if (missing.length > 0) {
    return {
      error: `ops_reassignment missing/invalid required fields: ${missing.join(", ")}.`,
    };
  }

  const toEmail = OPS_REASSIGNMENT_RECIPIENT;
  const subject = `Reassignment Request - ${candidateName}`;
  const body = [
    "Hi Team,",
    "",
    `Can we please reassign ${candidateName}?`,
    "",
    `Email: ${candidateEmail}`,
    `Nova Profile: ${novaProfileUrl}`,
    "",
    "Thank you!",
  ].join("\n");
  const noteContent = [
    "Email draft created",
    `Template: ${templateId}`,
    `Subject: ${subject}`,
    `Recipient: ${toEmail}`,
    "Status: Draft saved",
  ].join("\n");

  return {
    templateId,
    candidateId,
    jobId,
    toEmail,
    cc,
    subject,
    body,
    noteContent,
    allowSendNow: true,
  };
}

/**
 * Build raw offer data WITHOUT sentinel defaults — used for validation.
 * Fields that have no user-provided value stay as empty string / null / 0.
 */
function buildRawOfferDataForValidation(args: Record<string, unknown>): Partial<TemplateCatalogOfferData> {
  const candidate = asJsonRecord(args.candidate) || {};
  const job = asJsonRecord(args.job) || {};
  const pay = asJsonRecord(args.pay) || {};

  const candidateName =
    readString(candidate.full_name || candidate.candidate_name || candidate.display_name || args.candidate_name) ||
    [readString(candidate.first_name), readString(candidate.last_name)].filter(Boolean).join(" ").trim() ||
    "";

  return {
    name: candidateName || undefined,
    email: readString(args.to_email || args.toEmail || candidate.email) || undefined,
    facility: readString(job.facility_name || job.facilityName || args.facility_name || args.facility) || undefined,
    city: readString(job.city || args.city) || undefined,
    state: readString(job.state || args.state) || undefined,
    shiftType: readString(job.shift_type || job.shiftType || args.shift_type || args.shifts) || undefined,
    specialty: readString(job.specialty || args.specialty) || undefined,
    weeklyHours: readNumber(job.weekly_hours ?? job.weeklyHours ?? args.weekly_hours ?? args.hours_per_week) ?? undefined,
    startDate: readString(job.start_date || job.startDate || args.start_date) || undefined,
    endDate: readString(job.end_date || job.endDate || args.end_date) || undefined,
    taxableRate: readNumber(pay.taxable_hourly_rate ?? pay.taxableRate ?? args.taxable_rate) ?? undefined,
    weeklyStipend: readNumber(pay.total_stipends ?? pay.weekly_stipend_total ?? pay.weeklyStipend ?? args.total_stipends ?? args.weekly_stipend) ?? undefined,
    grossWeeklyPay: readNumber(pay.gross_weekly_pay ?? pay.grossWeeklyPay ?? args.gross_weekly_pay) ?? undefined,
  };
}

/**
 * Build full offer data WITH sentinel defaults — used for template rendering.
 */
function buildTemplateCatalogOfferData(args: Record<string, unknown>): TemplateCatalogOfferData {
  const candidate = asJsonRecord(args.candidate) || {};
  const job = asJsonRecord(args.job) || {};
  const pay = asJsonRecord(args.pay) || {};

  const candidateName =
    readString(candidate.full_name || candidate.candidate_name || candidate.display_name || args.candidate_name) ||
    [readString(candidate.first_name), readString(candidate.last_name)].filter(Boolean).join(" ").trim() ||
    "Candidate";

  const candidateEmail = readString(args.to_email || args.toEmail || candidate.email);
  const facility = readString(job.facility_name || job.facilityName || args.facility_name || args.facility);
  const city = readString(job.city || args.city);
  const state = readString(job.state || args.state);
  const shiftType = readString(job.shift_type || job.shiftType || args.shift_type || args.shifts) || "Day";
  const specialty = readString(job.specialty || args.specialty) || "Specialty";
  const weeklyHours =
    readNumber(job.weekly_hours ?? job.weeklyHours ?? args.weekly_hours ?? args.hours_per_week) || 36;
  const startDate = readString(job.start_date || job.startDate || args.start_date) || null;
  const endDate = readString(job.end_date || job.endDate || args.end_date) || null;
  const taxableRate = readNumber(pay.taxable_hourly_rate ?? pay.taxableRate ?? args.taxable_rate) || 0;
  const weeklyStipend = readNumber(
    pay.total_stipends ?? pay.weekly_stipend_total ?? pay.weeklyStipend ?? args.total_stipends ?? args.weekly_stipend,
  ) || 0;
  const grossWeeklyPay = readNumber(pay.gross_weekly_pay ?? pay.grossWeeklyPay ?? args.gross_weekly_pay) || 0;
  const candidateIdRaw = readString(args.candidate_id || args.candidateId || candidate.nova_id || candidate.novaId);
  const jobIdRaw = readString(args.job_id || args.jobId || job.job_id || job.jobId);
  const actualMarginStr = readString(pay.actual_margin ?? pay.actualMargin ?? args.actual_margin);
  
  // Unstructured freeform extraction fallback for margin
  const unstructuredText = typeof args.context_text === "string" ? args.context_text : "";
  const freeformMargin = extractMarginApprovalFromText(unstructuredText);
  const actualMargin = readNumber(actualMarginStr) ?? readNumber(freeformMargin.marginPercentage);

  return {
    name: candidateName,
    email: candidateEmail,
    facility,
    city,
    state,
    shiftType,
    weeklyHours,
    startDate,
    endDate,
    taxableRate,
    weeklyStipend,
    grossWeeklyPay,
    specialty,
    jobId: /^\d+$/.test(jobIdRaw) ? Number(jobIdRaw) : null,
    candidateId: /^\d+$/.test(candidateIdRaw) ? Number(candidateIdRaw) : null,
    actualMargin,
  };
}

function buildTransferredTemplateDraft(
  templateId: string,
  args: Record<string, unknown>,
): RenderedEmailDraft | { error: string } {
  const template = TEMPLATE_CATALOG.find((entry) => String(entry.id || "").toLowerCase() === templateId.toLowerCase());
  if (!template) return { error: `Unsupported template_id '${templateId || "(empty)"}'.` };

  const candidateId = readString(args.candidate_id || args.candidateId);
  if (!candidateId) {
    return { error: `${templateId} requires candidate_id.` };
  }

  const offerData = buildTemplateCatalogOfferData(args);

  // Validate against RAW data (no sentinel defaults) so missing fields are actually detected
  const rawData = buildRawOfferDataForValidation(args);
  const missing = getMissingRequiredFields(rawData, template);
  if (missing.length > 0) {
    return {
      error: `Review needed: Missing fields [${missing.join(", ")}]. Please provide these details to generate the draft.`,
    };
  }

  const rendered = template.generateContent(offerData);
  const toEmail = readString(rendered.to || args.to_email || args.toEmail || offerData.email);
  if (!toEmail) {
    return {
      error: `${templateId} requires a target recipient (to_email).`,
    };
  }
  if (!isLikelyEmail(toEmail) && template.messageType !== 'sms') {
    return {
      error: `${templateId} requires a valid email address.`,
    };
  }

  const ccFromTemplate = Array.isArray(rendered.cc)
    ? rendered.cc.map((entry) => readString(entry)).filter(Boolean)
    : readString(rendered.cc)
      ? [readString(rendered.cc)]
      : [];
  const ccFromArgs = Array.isArray(args.cc)
    ? args.cc.map((entry) => readString(entry)).filter(Boolean)
    : [];
  const cc = Array.from(new Set([...ccFromTemplate, ...ccFromArgs]));
  const subject = readString(rendered.subject) || `Draft (${templateId})`;
  const body = readString(rendered.body);
  if (!body) {
    return { error: `${templateId} generated an empty draft body.` };
  }

  const jobId = readString(args.job_id || args.jobId) || undefined;
  
  const isSms = template.messageType === 'sms';
  const labelPrefix = isSms ? "SMS" : "Email";
  const noteContent = isSms
    ? [
        `${labelPrefix} draft created`,
        `Template: ${templateId}`,
        `Excerpt: ${body.substring(0, 45).replace(/\n/g, ' ')}...`,
        `Recipient: ${toEmail}`,
        "Status: Draft ready for SMS dispatch",
      ].join("\n")
    : [
        `${labelPrefix} draft created`,
        `Template: ${templateId}`,
        `Subject: ${subject}`,
        `Recipient: ${toEmail}`,
        "Status: Draft saved",
      ].join("\n");

  return {
    templateId,
    candidateId,
    jobId,
    toEmail,
    cc,
    subject,
    body,
    noteContent,
    allowSendNow: true,
  };
}

function buildTemplateEmailDraft(templateIdInput: string, args: Record<string, unknown>): RenderedEmailDraft | { error: string } {
  const templateId = templateIdInput as EmailTemplateId;
  if (templateId === "initial_outreach") return buildInitialOutreachDraft(args);
  if (templateId === "pay_package_snippet") return buildPayPackageSnippetDraft(args);
  if (templateId === "ops_reassignment") return buildOpsReassignmentDraft(args);
  const transferred = buildTransferredTemplateDraft(templateId, args);
  if ("error" in transferred) {
    return {
      error: `${transferred.error} Supported template_ids: ${TEMPLATE_CATALOG_ID_LIST.join(", ")}.`,
    };
  }
  return transferred;
}

function toSandboxChunk(
  name: string,
  rawArgs: unknown,
  userPrompt: string,
): { chunk: Record<string, unknown>; toolResponse: Record<string, unknown> } | { error: string } {
  const args = asJsonRecord(rawArgs) || {};
  const taskId = String(args.task_id || args.taskId || nextSandboxTaskId());

  if (name === "prepare_match_preview") {
    const fixtureId = String(args.fixture_id || "").trim();
    const title = String(args.title || "").trim();
    const markdown = String(args.markdown || "");
    const rawWriteupUrl = String(args.writeup_url || "").trim();
    const writeupUrl = normalizeWorldCupWriteupUrl(fixtureId, rawWriteupUrl);

    if (!fixtureId || !title) {
      return { error: "prepare_match_preview requires fixture_id and title." };
    }
    if (!writeupUrl) {
      return { error: "prepare_match_preview writeup_url must be an absolute https URL." };
    }

    return {
      chunk: {
        type: "sandbox_document",
        taskId,
        title,
        markdown,
        commitAction: {
          type: "publish_preview",
          fixtureId,
          writeupUrl,
          writeupTitle: title,
        },
      },
      toolResponse: {
        sandbox_task_created: true,
        task_id: taskId,
        output_type: "document",
      },
    };
  }

  if (name === "prepare_db_write") {
    const database = normalizeSandboxDatabaseName(args.database);
    const table = String(args.table || "").trim();
    const operation = String(args.operation || "").trim().toUpperCase();
    const params = asJsonRecord(args.params) || {};
    const before = asJsonRecord(args.before);
    const after = asJsonRecord(args.after) || params;
    const title = String(args.title || `${operation || "UPDATE"} ${table || "record"}`);

    if (!table || !operation) {
      return { error: "prepare_db_write requires table and operation." };
    }

    return {
      chunk: {
        type: "sandbox_db_write",
        taskId,
        title,
        database,
        table,
        operation,
        before,
        after,
        params,
        commitAction: {
          type: "spanner_write",
          database,
          table,
          operation,
          params,
        },
      },
      toolResponse: {
        sandbox_task_created: true,
        task_id: taskId,
        output_type: "db_write",
      },
    };
  }

  if (name === "prepare_api_call") {
    const method = String(args.method || "GET").trim().toUpperCase();
    const url = String(args.url || "").trim();
    const headers = normalizeStringMap(args.headers);
    const body = args.body ?? null;
    const title = String(args.title || `${method} ${url}`);

    if (!url || !/^https?:\/\//i.test(url)) {
      return { error: "prepare_api_call requires an absolute HTTP(S) url." };
    }

    return {
      chunk: {
        type: "sandbox_api_call",
        taskId,
        title,
        method,
        url,
        headers,
        body,
        commitAction: {
          type: "api_fetch",
          method,
          url,
          headers,
          body,
        },
      },
      toolResponse: {
        sandbox_task_created: true,
        task_id: taskId,
        output_type: "api_call",
      },
    };
  }

  if (name === "prepare_email_draft") {
    const templateId = resolveEmailTemplateId({
      requestedTemplateId: readString(args.template_id || args.templateId).toLowerCase(),
      args,
      userPrompt,
    });
    const rendered = buildTemplateEmailDraft(templateId, args);
    if ("error" in rendered) {
      return { error: rendered.error };
    }

    const title = `Email Draft: ${rendered.subject}`;
    return {
      chunk: {
        type: "sandbox_email_draft",
        taskId,
        title,
        templateId: rendered.templateId,
        candidateId: rendered.candidateId,
        jobId: rendered.jobId || null,
        toEmail: rendered.toEmail,
        cc: rendered.cc,
        subject: rendered.subject,
        body: rendered.body,
        noteContent: rendered.noteContent,
        allowSendNow: rendered.allowSendNow,
        commitAction: {
          type: "create_email_draft",
          templateId: rendered.templateId,
          candidateId: rendered.candidateId,
          jobId: rendered.jobId,
          toEmail: rendered.toEmail,
          cc: rendered.cc,
          subject: rendered.subject,
          body: rendered.body,
          noteContent: rendered.noteContent,
        },
      },
      toolResponse: {
        sandbox_task_created: true,
        task_id: taskId,
        output_type: "email_draft",
        template_id: rendered.templateId,
      },
    };
  }

  if (name === "prepare_agent_handoff") {
    const targetUrl = String(args.target_url || args.targetUrl || "").trim();
    const sourceSurface = readString(args.source_surface || args.sourceSurface || "nova").toLowerCase() || "nova";
    const goal = readString(args.goal);
    const instructions = Array.isArray(args.instructions)
      ? args.instructions.map((entry) => readString(entry)).filter(Boolean)
      : [];
    const expectedReturnSchema =
      asJsonRecord(args.expected_return_schema || args.expectedReturnSchema) || {
        type: "object",
        required: ["task_id", "facts", "structured_json", "strategic_read"],
      };
    const context = asJsonRecord(args.context);
    const autoLaunch =
      typeof args.auto_launch === "boolean"
        ? args.auto_launch
        : typeof args.autoLaunch === "boolean"
          ? args.autoLaunch
          : false;
    const title = String(args.title || `Agent Handoff: ${sourceSurface}`);

    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
      return { error: "prepare_agent_handoff requires an absolute HTTP(S) target_url." };
    }
    if (!goal) {
      return { error: "prepare_agent_handoff requires goal." };
    }
    if (instructions.length === 0) {
      instructions.push(
        `Open target URL and execute: ${goal}`,
        "Return structured JSON that matches expected_return_schema.",
      );
    }

    return {
      chunk: {
        type: "sandbox_agent_handoff",
        taskId,
        title,
        targetUrl,
        sourceSurface,
        goal,
        instructions,
        expectedReturnSchema,
        context,
        autoLaunch,
        commitAction: {
          type: "create_agent_handoff_task",
          targetUrl,
          sourceSurface,
          goal,
          instructions,
          expectedReturnSchema,
          context,
          autoLaunch,
        },
      },
      toolResponse: {
        sandbox_task_created: true,
        task_id: taskId,
        output_type: "agent_handoff",
      },
    };
  }

  return { error: `Unsupported sandbox tool '${name}'.` };
}

export async function POST(request: NextRequest) {
  try {
    const { prompt, history, image, imageRecordId, imageIntent, mode, retrievalPolicy, internalContext, selectedCandidateContext, selectedMarginContext, modelOverride, uiContext } = await request.json() as {
      prompt: string;
      history?: { role: string; text: string }[];
      image?: string;
      imageRecordId?: string;
      mode?: string;
      retrievalPolicy?: RetrievalPolicy;
      internalContext?: InternalContext;
      selectedCandidateContext?: Record<string, unknown>;
      selectedMarginContext?: Record<string, unknown>;
      modelOverride?: ModelId;
      imageIntent?: string;
      uiContext?: {
        threadId?: string;
        candidateId?: string;
        candidateName?: string;
        activeItems?: Array<Record<string, unknown>>;
        rosterDigest?: Record<string, unknown> | null;
      };
    };

    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "prompt is required" }), { status: 400 });
    }

    const hasInlineImage = !!(image && typeof image === "string");
    const hasSavedImage = typeof imageRecordId === "string" && imageRecordId.length > 0;
    const hasImage = hasInlineImage || hasSavedImage;
    const requestedMode = mode || "sports";
    const activeMode =
      requestedMode === "facility" || requestedMode === "margins"
        ? "ayaops"
        : requestedMode;
    // Architecture drift prevention: strict URL Hub routing only. No ad-hoc search tools.
    const allowExternalGroundingInAyaops = false;
    const isInternalRecord = retrievalPolicy?.source === "internal_candidate_record";
    const selectedContext = normalizeSelectedCandidateContext(selectedCandidateContext);
    const selectedMargin = normalizeSelectedMarginContext(selectedMarginContext);
    const historyCandidateInput = inferCandidateInputFromHistory(history);

    // ── Grounded UI context (thread or candidate selection) ──
    let groundedUiContext: Record<string, unknown> | null = null;
    if (uiContext?.threadId && activeMode === "ayaops") {
      try {
        const { getRecruitingDb } = await import("@/lib/spanner-pool");
        const recruitDb = getRecruitingDb();
        const [threadRows] = await recruitDb.run({
          sql: `SELECT thread_id, matched_candidate_id, matched_candidate_name, candidate_name_raw,
                       candidate_phone_raw, intent_tags_json, recommended_next_step
                FROM Threads WHERE thread_id = @id LIMIT 1`,
          params: { id: uiContext.threadId },
          types: { id: { type: "string" } },
        });
        if (threadRows.length > 0) {
          const row = (threadRows[0] as any).toJSON();
          groundedUiContext = {
            source: "active_thread_selection",
            thread_id: row.thread_id,
            candidate_id: row.matched_candidate_id ?? null,
            candidate_name: row.matched_candidate_name ?? row.candidate_name_raw ?? null,
            intent_tags: safeParseTags(row.intent_tags_json),
            recommended_next_step: row.recommended_next_step ?? null,
          };
        }
      } catch (err) {
        console.warn("[ui_context] thread lookup failed:", err);
      }
    } else if (uiContext?.candidateId && activeMode === "ayaops" && !selectedContext) {
      groundedUiContext = {
        source: "active_candidate_selection",
        candidate_id: uiContext.candidateId,
        candidate_name: uiContext.candidateName ?? null,
      };
    }

    // ── Route decision ──────────────────────────────────────────
    let route = routeRequest({
      mode: activeMode,
      hasImage,
      hasInternalRecord: isInternalRecord,
    });

    // User override (vision always stays Gemini — can't override multimodal)
    if (modelOverride && !hasImage) {
      const meta = MODEL_META[modelOverride];
      route = { model: modelOverride, provider: meta.provider, reason: `user_override_${modelOverride}` };
    }

    console.log(
      `[router] mode=${activeMode} requested_mode=${requestedMode} model=${route.model} provider=${route.provider} reason=${route.reason}`,
    );

    // ── System prompt ───────────────────────────────────────────
    let systemPrompt = hasImage
      ? (VISION_PROMPTS[activeMode] || VISION_PROMPTS.sports)
      : (SYSTEM_PROMPTS[activeMode] || SYSTEM_PROMPTS.sports);
    if (!hasImage && activeMode === "ayaops" && allowExternalGroundingInAyaops) {
      systemPrompt = `${systemPrompt}

MODE OVERRIDE:
- In Facility and Packages views, you MAY use Google Search grounding for external/public context.
- Candidate-specific identity, status, and write actions MUST remain grounded to internal DB tools.
- Never fabricate internal data. Keep external claims source-cited.`;
    }
    // ── Build user prompt with optional candidate grounding ─────
    let fullPrompt = prompt;
    let hasPrefetchedAyaopsObservation = false;
    if (isInternalRecord && internalContext?.candidate) {
      const candidateGrounding = formatCandidateContext(internalContext.candidate as CandidateRecord);
      fullPrompt = `${candidateGrounding}\n\n${prompt}`;
    }

    // ── Image Intent Routing (pre-resolved by UI) ───────────────
    if (imageIntent && hasImage && activeMode === "ayaops") {
      const intentDirectives: Record<string, string> = {
        add_candidate: `[INTENT: ADD_CANDIDATE] The user has selected "Add Candidate" intent. Extract the candidate's name, specialty, facility, and all visible data from the attached screenshot. Do NOT draft emails. Do NOT match existing candidates. Ingest this as a new candidate record.`,
        pay_package: `[INTENT: PAY_PACKAGE_CAPTURE] The user uploaded a pay package screenshot. Extract the package fields and call ingest_margin_payload. Use rows[0].record_phase = "job" because this is facility-owned package inventory without a candidate/offer attached. Do NOT draft outreach. Do NOT claim anything was saved unless ingest_margin_payload succeeds.`,
        margin_approval: `[INTENT: MARGIN_APPROVAL_CAPTURE] The user uploaded a margin approval screenshot. Extract the approval fields and call ingest_margin_payload. Use rows[0].record_phase = "margin" only if a candidate or offer is visible; otherwise use "job". Do NOT draft outreach. Do NOT claim anything was saved unless ingest_margin_payload succeeds.`,
        analyze: `[INTENT: ANALYZE] The user has selected "Analyze" intent. Describe and analyze the contents of the attached screenshot. Do NOT perform any write actions. Read-only analysis.`,
      };
      const directive = intentDirectives[imageIntent];
      if (directive) {
        fullPrompt = `${directive}\n\n${fullPrompt}`;
      }
    }

    if (activeMode === "ayaops" && selectedContext) {
      const authoritativeCandidateId = selectedContext.candidate_id || "";
      const fallbackNovaId = selectedContext.nova_id || "";
      const resolvedName = selectedContext.candidate_name || "";
      const resolvedEmail = selectedContext.candidate_email || "";
      const currentBucket = selectedContext.current_bucket || "";
      const contextSource = selectedContext.source || "left_rail";
      fullPrompt = `${fullPrompt}

[System note: Left-rail selected candidate context is available and authoritative for this turn.
Resolver priority (strict): selected candidate context → exact nova_id → exact internal id → exact name → fuzzy name last.
candidate_id="${authoritativeCandidateId}"
nova_id="${fallbackNovaId}"
candidate_name="${resolvedName}"
candidate_email="${resolvedEmail}"
current_bucket="${currentBucket}"
context_source="${contextSource}"
CRITICAL: When candidate_id is provided above, you MUST pass it directly to write tools (update_candidate_status, add_candidate_note, create_com_draft_email, update_candidate_profession). Do NOT call access_hub first, the candidate is already resolved. Call the write tool immediately with candidate_id="${authoritativeCandidateId}".]`;
    }

    // Inject grounded UI context if available (thread or inferred candidate)
    if (activeMode === "ayaops" && groundedUiContext && !selectedContext) {
      const ctxJson = JSON.stringify(groundedUiContext, null, 2);
      fullPrompt = `${fullPrompt}

[System note: GROUNDED UI CONTEXT (authoritative)
${ctxJson}
Rule: If the user asks to "draft a reply", "update status", or references "this candidate", strictly use the IDs from this context block. Do not search for other candidates.]`;
    }
    
    // ── GaC: Direct Git-governance injection via Octokit ──
    if (activeMode === "ayaops" || activeMode === "code") {
      const ledgerPath = activeMode === "code" ? "docs/ledger/code-engineering.json" : "docs/ledger/recruiter-voice.json";
      const constitution = await getCachedConstitution(undefined, undefined, ledgerPath);
      fullPrompt = `${fullPrompt}

[System note: LIVE ARCHITECTURE LEDGER - VER: ${constitution.version}
The following governance rules are injected deterministically from the repository HEAD commit via the Git-as-Governance engine. Your response MUST comply with every "accepted" verdict below.
${JSON.stringify(constitution.rules, null, 2)}
CRITICAL: These are laws, not suggestions. Treat each rule with the same strictness as returning valid JSON.]`;
    }

    // ── Supplemental: dynamic Spanner verdicts from client state (code mode only) ──
    if (activeMode === "code" && uiContext?.activeItems && Array.isArray(uiContext.activeItems)) {
      const acceptedItems = uiContext.activeItems.filter((item) => {
        const record = asJsonRecord(item);
        const status = readString(record?.status);
        return status.toLowerCase() === "accepted";
      });
      const dynamicVerdictItems = acceptedItems.length > 0 ? acceptedItems : uiContext.activeItems;
      if (dynamicVerdictItems.length > 0) {
        fullPrompt = `${fullPrompt}

[System note: DYNAMIC VERDICTS (from Spanner verdict ledger)
${JSON.stringify(dynamicVerdictItems.map((item) => ({
  verdict: item.label,
  details: item.preview,
  status: item.status,
})), null, 2)}
Rule: These supplement the Live Architecture Ledger above. Use as additional context for repo conventions.]`;
      }
    }

    if (activeMode === "ayaops") {
      const rosterDigest = normalizeAyaopsRosterDigest(uiContext?.rosterDigest);
      if (rosterDigest) {
        fullPrompt = `${fullPrompt}

[System note: ROSTER_MAP
You are managing ${rosterDigest.total} candidates.
Status distribution: ${Object.entries(rosterDigest.statuses)
  .map(([status, count]) => `${status}:${count}`)
  .join(", ") || "none"}.
Specialty distribution: ${Object.entries(rosterDigest.specialties)
  .map(([specialty, count]) => `${specialty}(${count})`)
  .join(", ") || "none"}.
If asked for a list, prefer grounded collection retrieval and refine by intent.]`;
      }

      const formatResolverCandidateOption = (entry: unknown): string => {
        const record = asJsonRecord(entry);
        const name = readString(record?.display_name || record?.name) || "Unknown candidate";
        const candidateId = readString(record?.candidate_id || record?.id) || "";
        const novaId = readString(record?.nova_id) || "";
        const specialty = readString(record?.specialty) || "";
        const status = readString(record?.assignment_status || record?.status) || "";
        const facilityName = readString(record?.facility_name) || "";
        const facilityCity = readString(record?.facility_city) || "";
        const facilityState = readString(record?.facility_state) || "";
        const recentActivityAt =
          readString(record?.recent_activity_at || record?.recentActivityAt) || "";

        const contextSegments: string[] = [];
        if (specialty) contextSegments.push(`specialty: ${specialty}`);
        if (status) contextSegments.push(`status: ${status}`);
        if (facilityName || facilityCity || facilityState) {
          const loc = [facilityCity, facilityState].filter(Boolean).join(", ");
          contextSegments.push(`location: ${facilityName}${loc ? ` (${loc})` : ""}`);
        }
        if (recentActivityAt) contextSegments.push(`recent activity: ${recentActivityAt}`);

        return `${name}${candidateId ? ` (candidate_id: ${candidateId})` : ""}${novaId ? ` (nova_id: ${novaId})` : ""}${contextSegments.length > 0 ? ` | ${contextSegments.join(" | ")}` : ""}`;
      };

      const collectionPath = inferAyaopsCollectionHubPath(prompt);
      if (collectionPath) {
        try {
          const collectionResult = await resolveHub(collectionPath);
          if (
            collectionResult.status === "resolved" &&
            collectionResult.type === "candidate_collection"
          ) {
            const collectionData = asJsonRecord(collectionResult.data);
            const collectionItemsRaw = Array.isArray(collectionData?.items)
              ? collectionData.items
              : [];
            const collectionItems = collectionItemsRaw
              .slice(0, 10)
              .map((entry) => {
                const record = asJsonRecord(entry);
                return {
                  id: readString(record?.id) || null,
                  name: readString(record?.name) || null,
                  specialty: readString(record?.specialty) || null,
                  profession: readString(record?.profession) || null,
                  status: readString(record?.status || record?.assignment_status) || null,
                  facility: readString(record?.facility_name) || null,
                  state: readString(record?.facility_state || record?.home_state) || null,
                  assignment_end: readString(record?.assignment_end) || null,
                  last_contact_at: readString(record?.last_contact_at) || null,
                };
              })
              .filter((entry) => Boolean(entry.name));
            const countRaw = Number(collectionData?.count);
            const count = Number.isFinite(countRaw) ? countRaw : collectionItemsRaw.length;
            const observationPayload = {
              type: collectionResult.type,
              status: collectionResult.status,
              summary: collectionResult.summary,
              count,
              filters_applied: asJsonRecord(collectionData?.filters_applied) || {},
              capability_gaps: Array.isArray(collectionData?.capability_gaps)
                ? collectionData?.capability_gaps
                : [],
              items: collectionItems,
            };
            const observationJson = JSON.stringify(observationPayload);
            if (observationJson) {
              fullPrompt = `${fullPrompt}

[System note: CURRENT_OBSERVATION (collection prefetch from URL hub)
${observationJson}]`;
              hasPrefetchedAyaopsObservation = true;
            }
          } else {
            const summary = readString(collectionResult.summary);
            if (summary) {
              fullPrompt = `${fullPrompt}

[System note: Collection prefetch returned non-resolved status.
path="${collectionPath}"
summary="${summary}"]`;
            }
          }
        } catch (sourceErr) {
          console.warn("[candidate_collection_prefetch] resolve failed:", sourceErr);
        }
      }

      if (!collectionPath) {
        const candidateUrlInput = inferCandidateUrlInput({
          selectedContext,
          uiContext,
          prompt,
          history,
        });
        if (candidateUrlInput.length > 0) {
          try {
            const resolverPayload = await resolveHub(`candidates/${candidateUrlInput}`);
            if (resolverPayload.status === "resolved") {
              const sourceJson = JSON.stringify(asJsonRecord(resolverPayload.data) || {});
              const resolvedCandidateId = readString(resolverPayload.id);
              const resolvedName = readString(
                asJsonRecord(resolverPayload.data)?.display_name || resolverPayload.summary,
              );
              if (sourceJson) {
                fullPrompt = `${fullPrompt}

[System note: Dynamic candidate grounding hub resolved candidate context for this turn.
resolved_candidate_id="${resolvedCandidateId}"
resolved_candidate_name="${resolvedName}"
Use this JSON as authoritative candidate read context:
${sourceJson}]`;
                hasPrefetchedAyaopsObservation = true;
              }
            } else if (resolverPayload.status === "ambiguous") {
              const candidates = Array.isArray(resolverPayload.alternatives)
                ? resolverPayload.alternatives
                    .map((entry) => formatResolverCandidateOption(entry))
                    .filter(Boolean)
                    .slice(0, 5)
                : [];
              if (candidates.length > 0) {
                fullPrompt = `${fullPrompt}

[System note: Candidate resolver found multiple matches for "${candidateUrlInput}".
Do not guess. Ask the user to pick one of these:
- ${candidates.join("\n- ")}]`;
              }
            } else if (resolverPayload.status === "not_found") {
              const resolverMessage =
                readString(resolverPayload.summary) ||
                `No exact candidate match for "${candidateUrlInput}".`;
              fullPrompt = `${fullPrompt}

[System note: Candidate resolver found zero exact matches for "${candidateUrlInput}".
Resolver message: ${resolverMessage}
Do not guess. Ask the user to clarify the candidate identity.]`;
            }
          } catch (sourceErr) {
            console.warn("[candidate_url_grounding] resolveHub failed:", sourceErr);
          }
        }
      }
    }

    // Always inject ambiguity handling rule for ayaops
    if (activeMode === "ayaops") {
      systemPrompt = `${systemPrompt}

Rule: If any tool returns error_code "AMBIGUOUS_MATCH" or "AMBIGUOUS_CANDIDATE" with alternatives, DO NOT retry the search. Stop immediately and present the alternatives to the user with context so they can choose.
Rule: If any tool returns error_code "CANDIDATE_NOT_FOUND", ask the user for clarification (full name, candidate ID, or Nova ID). Do not guess.`;
    }

    if (requestedMode === "margins") {
      const selectedIsPayPackage =
        selectedMargin?.object_type === "pay_package" ||
        selectedMargin?.record_phase === "job";
      fullPrompt = `${fullPrompt}

[System note: Packages mode output style
- Canonical model:
  Facility -> Job -> Pay Package -> Outreach.
  Facility -> Job -> Offer -> selected Pay Package -> Margin -> Approval.
  Candidate -> Job -> Offer / Assignment history.
  Facility -> Candidate -> Job -> Offer -> selected Pay Package -> Margin -> Approval.
- If the selected object is a pay package, treat it as recruiter/candidate-facing money for outreach. Do not call it a margin.
- If the selected object is a margin approval, treat margin as internal approval math only.
- If the user says to save selected package details, do not invent a save. The selected pay package is already in Packages unless a write event says otherwise.
- Do not re-list inventory fields already shown in the package or approval card.
- Never surface internal IDs (record keys, job IDs, calc IDs) unless the user explicitly asks.
- Answer in 2-3 sentences max:
  1) deal read,
  2) primary risk,
  3) next action.
- Use plain recruiter language; no generic suggestion menus.]`;

      if (selectedMargin) {
        fullPrompt = selectedIsPayPackage
          ? `${fullPrompt}

[Selected pay package context]
Role: ${selectedMargin.specialty || selectedMargin.profession || "Unknown"}
Facility: ${selectedMargin.facility_name || "Unknown"}${selectedMargin.facility_city || selectedMargin.facility_state ? ` (${[selectedMargin.facility_city, selectedMargin.facility_state].filter(Boolean).join(", ")})` : ""}
Assignment: ${selectedMargin.assignment_start || "--"} to ${selectedMargin.assignment_end || "--"}
Weekly gross: ${selectedMargin.weekly_gross ?? "unknown"}
Base pay: ${selectedMargin.base_pay_rate ?? "unknown"}
Weekly stipends: ${selectedMargin.weekly_stipends ?? "unknown"}
Weekly hours: ${selectedMargin.weekly_hours ?? "unknown"}
Shift: ${selectedMargin.shift_type || "--"} ${selectedMargin.shift_start || "--"}-${selectedMargin.shift_end || "--"}]`
          : `${fullPrompt}

[Selected margin approval context]
Candidate: ${selectedMargin.candidate_name || "Unknown"}
Role: ${selectedMargin.specialty || selectedMargin.profession || "Unknown"}
Facility: ${selectedMargin.facility_name || "Unknown"}${selectedMargin.facility_city || selectedMargin.facility_state ? ` (${[selectedMargin.facility_city, selectedMargin.facility_state].filter(Boolean).join(", ")})` : ""}
Assignment: ${selectedMargin.assignment_start || "--"} to ${selectedMargin.assignment_end || "--"}
Weekly gross: ${selectedMargin.weekly_gross ?? "unknown"}
Actual margin: ${selectedMargin.actual_margin_pct ?? "unknown"}
Target margin: ${selectedMargin.target_margin_pct ?? "unknown"}
Base pay: ${selectedMargin.base_pay_rate ?? "unknown"}
Weekly stipends: ${selectedMargin.weekly_stipends ?? "unknown"}
Weekly hours: ${selectedMargin.weekly_hours ?? "unknown"}
Shift: ${selectedMargin.shift_type || "--"} ${selectedMargin.shift_start || "--"}-${selectedMargin.shift_end || "--"}]`;
      }
    }

    if (
      activeMode === "ayaops" &&
      /\b(draft|rewrite|reword|clean this up|message|email|sms|text|slack|teams|note|outlook|format|formatting|fix)\b/i.test(prompt)
    ) {
      fullPrompt = `${fullPrompt}

[System note: The user likely needs copy/paste-ready language.
- Default to one best draft. Only provide multiple options if the user explicitly asks for options/variants.
- Always return ready-to-send SMS/email copy in fenced plain-text blocks (\`\`\`text ... \`\`\`), including single-draft responses.
- Never use markdown blockquotes (">") for drafted messages.
- Never wrap drafted messages in quotation marks.
- Skip trailing filler (for example: "let me know if you need...").]`;
    }

    const selectedContextCandidateInput =
      selectedContext?.candidate_id ||
      selectedContext?.nova_id ||
      readString(groundedUiContext?.candidate_id) ||
      historyCandidateInput ||
      "";

    if (
      activeMode === "ayaops" &&
      isOfferStatusIntent(prompt) &&
      selectedContextCandidateInput
    ) {
      const updateExecution = await executeDbTool("update_candidate_status", {
        candidate_id: selectedContextCandidateInput,
        new_status: "offer",
      });

      const encoder = new TextEncoder();
      const directStream = new ReadableStream({
        start(controller) {
          if (updateExecution.error) {
            const isCandidateResolutionFailure = /CANDIDATE_NOT_FOUND|CANDIDATE_IDENTITY_AMBIGUOUS/i.test(
              updateExecution.error,
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify(buildWriteResultEvent({
                  type: "write_result",
                  outcome: "failed",
                  action: "update_candidate_status",
                  rowsUpdated: null,
                  code: isCandidateResolutionFailure ? "CANDIDATE_RESOLUTION_FAILED" : "TOOL_EXECUTION_FAILED",
                  payload: {
                    action: "update_candidate_status",
                    error: updateExecution.error,
                    code: isCandidateResolutionFailure
                      ? "CANDIDATE_RESOLUTION_FAILED"
                      : "TOOL_EXECUTION_FAILED",
                    reason: isCandidateResolutionFailure
                      ? "selected_context_missing"
                      : "tool_execution_failed",
                  },
                }))}\n\n`,
              ),
            );
            controller.enqueue(
              encoder.encode(
	                `data: ${JSON.stringify({
	                  type: "error",
	                  code: isCandidateResolutionFailure ? "CANDIDATE_RESOLUTION_FAILED" : "TOOL_EXECUTION_FAILED",
	                  reason: isCandidateResolutionFailure ? "selected_context_missing" : "tool_execution_failed",
	                  message: buildUserFacingLookupErrorMessage(
	                    "update_candidate_status",
	                    updateExecution.error,
	                  ),
	                })}\n\n`,
	              ),
	            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }

          const resultObj =
            updateExecution.result && typeof updateExecution.result === "object"
              ? (updateExecution.result as Record<string, unknown>)
              : {};
          const rawRows =
            typeof resultObj.rows_updated === "number"
              ? resultObj.rows_updated
              : typeof resultObj.rows_updated === "string"
                ? Number(resultObj.rows_updated)
                : null;
          const rowsUpdated =
            typeof rawRows === "number" && Number.isFinite(rawRows) ? rawRows : null;
          const rawOutcome =
            typeof resultObj.outcome === "string" ? resultObj.outcome.toLowerCase() : "";
          const outcome =
            rawOutcome === "inserted" ||
            rawOutcome === "updated" ||
            rawOutcome === "no_change" ||
            rawOutcome === "failed"
              ? rawOutcome
              : rowsUpdated === 0
                ? "no_change"
                : "updated";
          const changedFields = asJsonRecord(resultObj.changed_fields);
          const changedStatus = asJsonRecord(changedFields?.status);
          const oldStatus = readString(changedStatus?.from);
          const newStatus = readString(changedStatus?.to);
          const candidateName =
            readString(resultObj.candidate_name || selectedContext?.candidate_name) || "candidate";

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify(buildWriteResultEvent({
                type: "write_result",
                outcome,
                action: "update_candidate_status",
                objectType: typeof resultObj.object_type === "string" ? resultObj.object_type : "candidate_status",
                rowsUpdated,
                code: null,
                payload: resultObj,
              }))}\n\n`,
            ),
          );
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "text",
                text:
                  outcome === "failed"
                    ? `Could not update ${candidateName} to Offer.`
                    : outcome === "no_change"
                      ? `${candidateName} is already in Offer status (no change).`
                      : oldStatus && newStatus
                        ? `${candidateName}: ${oldStatus} to ${newStatus}.`
                        : `${candidateName}: Offer status updated.`,
              })}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      return new Response(directStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Model-Provider": route.provider,
          "X-Model-Id": route.model,
          "X-Route-Reason": "selected_candidate_offer_intent_direct_write",
        },
      });
    }

    const autoNovaProfilePayload =
      activeMode === "ayaops" ? extractNovaCandidateProfilePayload(prompt) : null;
    const hasNovaPayloadHint =
      activeMode === "ayaops" ? containsNovaPayloadHint(prompt) : false;
    const autoRingCentralPayload =
      activeMode === "ayaops" ? extractRingCentralThreadPayload(prompt) : null;
    const hasRingCentralPayloadHint =
      activeMode === "ayaops" ? containsRingCentralPayloadHint(prompt) : false;
    const autoMarginPayload =
      activeMode === "ayaops" ? extractMarginCalculatorPayload(prompt) : null;
    const hasMarginPayloadHint =
      activeMode === "ayaops" ? containsMarginPayloadHint(prompt) : false;
    const selectedIsPayPackage =
      requestedMode === "margins" &&
      Boolean(selectedMargin) &&
      (selectedMargin?.object_type === "pay_package" || selectedMargin?.record_phase === "job");

    if (
      activeMode === "ayaops" &&
      selectedIsPayPackage &&
      isPayPackageSaveIntent(prompt) &&
      !autoMarginPayload
    ) {
      const role = selectedMargin?.specialty || selectedMargin?.profession || "selected role";
      const facility = selectedMargin?.facility_name || "selected facility";
      const gross =
        typeof selectedMargin?.weekly_gross === "number"
          ? formatCurrency(selectedMargin.weekly_gross)
          : "the listed weekly gross";

      return buildEventStreamResponse(
        [
          {
            type: "text",
            text:
              `This pay package is already saved in Packages: ${role} at ${facility}, ${gross}/wk. ` +
              "Nothing new was written from that message. To use it, create an offer from the selected package or tell me the candidate name to attach it to.",
          },
        ],
        { provider: route.provider, model: route.model, reason: "selected_pay_package_already_saved" },
      );
    }

    if (activeMode === "ayaops" && hasRingCentralPayloadHint && !autoRingCentralPayload) {
      const encoder = new TextEncoder();
      const earlyStream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify(buildWriteResultEvent({
                type: "write_result",
                outcome: "failed",
                action: "ingest_ringcentral_thread",
                rowsUpdated: null,
                code: "INVALID_RINGCENTRAL_PAYLOAD",
                payload: {
                  action: "ingest_ringcentral_thread",
                  code: "INVALID_RINGCENTRAL_PAYLOAD",
                  error:
                    "Could not parse a valid RingCentral thread JSON object. Check quotes/braces and remove trailing commas.",
                },
              }))}\n\n`,
            ),
          );
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "error",
                code: "INVALID_RINGCENTRAL_PAYLOAD",
                message:
                  "Malformed RingCentral payload. Provide a valid JSON object with thread_source='RingCentral SMS' (or source containing ringcentral).",
              })}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      return new Response(earlyStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Model-Provider": route.provider,
          "X-Model-Id": route.model,
          "X-Route-Reason": route.reason,
        },
      });
    }

    if (activeMode === "ayaops" && hasMarginPayloadHint && !autoMarginPayload) {
      const encoder = new TextEncoder();
      const earlyStream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify(buildWriteResultEvent({
                type: "write_result",
                outcome: "failed",
                action: "ingest_margin_payload",
                rowsUpdated: null,
                code: "INVALID_MARGIN_PAYLOAD",
                payload: {
                  action: "ingest_margin_payload",
                  code: "INVALID_MARGIN_PAYLOAD",
                  error:
                    "Could not parse a valid aya_margin_calculator JSON object. Check quotes/braces and remove trailing commas.",
                },
              }))}\n\n`,
            ),
          );
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "error",
                code: "INVALID_MARGIN_PAYLOAD",
                message:
                  "Malformed margin payload. Provide a valid JSON object with source='aya_margin_calculator'.",
              })}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      return new Response(earlyStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Model-Provider": route.provider,
          "X-Model-Id": route.model,
          "X-Route-Reason": route.reason,
        },
      });
    }

    if (
      activeMode === "ayaops" &&
      !autoMarginPayload &&
      hasNovaPayloadHint &&
      !autoNovaProfilePayload
    ) {
      const encoder = new TextEncoder();
      const earlyStream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify(buildWriteResultEvent({
                type: "write_result",
                outcome: "failed",
                action: "ingest_nova_profile",
                rowsUpdated: null,
                code: "INVALID_PROFILE_PAYLOAD",
                payload: {
                  action: "ingest_nova_profile",
                  code: "INVALID_PROFILE_PAYLOAD",
                  error:
                    "Could not parse a valid nova_candidate_profile JSON object. Check quotes/braces and remove trailing commas.",
                },
              }))}\n\n`,
            ),
          );
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "error",
                code: "INVALID_PROFILE_PAYLOAD",
                message:
                  "Malformed Nova payload. Provide a valid JSON object with source='nova_candidate_profile'.",
              })}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      return new Response(earlyStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Model-Provider": route.provider,
          "X-Model-Id": route.model,
          "X-Route-Reason": route.reason,
        },
      });
    }
    let preIngestWriteEvent: Record<string, unknown> | null = null;
    let preIngestExecuted = false;
    let requireFollowupWriteAfterIngest = false;

    if (autoRingCentralPayload) {
      const payloadRecord = asJsonRecord(autoRingCentralPayload) || {};

      try {
        const ringcentralResult = await ingestRingCentralThreadCapture(payloadRecord);
        const writeStatus = readString(ringcentralResult.write_status || "");
        const outcome =
          writeStatus === "inserted"
            ? "inserted"
            : writeStatus === "updated"
              ? "updated"
              : "no_change";
        const rowsUpdated = outcome === "no_change" ? 0 : 1;

        preIngestWriteEvent = {
          type: "write_result",
          outcome,
          action: "ingest_ringcentral_thread",
          objectType: "ringcentral_thread_capture",
          rowsUpdated,
          code: null,
          payload: ringcentralResult,
        };
        preIngestExecuted = true;
        requireFollowupWriteAfterIngest = false;

        fullPrompt = `${fullPrompt}

[System note: ingest_ringcentral_thread executed before this turn.
thread_id="${String(ringcentralResult.thread_id || "")}"
event_id="${String(ringcentralResult.event_id || "")}"
candidate_link_status="${String(ringcentralResult.candidate_link_status || "")}"
message_count="${String(ringcentralResult.message_count || 0)}"
Return only operational summary: save status, link status, and next best action.]`;
      } catch (ringcentralErr) {
        const ringcentralMessage =
          ringcentralErr instanceof Error ? ringcentralErr.message : String(ringcentralErr);
        const encoder = new TextEncoder();
        const earlyStream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify(buildWriteResultEvent({
                  type: "write_result",
                  outcome: "failed",
                  action: "ingest_ringcentral_thread",
                  rowsUpdated: null,
                  code: "RINGCENTRAL_INGEST_FAILED",
                  payload: {
                    action: "ingest_ringcentral_thread",
                    code: "RINGCENTRAL_INGEST_FAILED",
                    error: ringcentralMessage,
                  },
                }))}\n\n`,
              ),
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "error",
                  code: "RINGCENTRAL_INGEST_FAILED",
                  message: buildUserFacingLookupErrorMessage(
                    "ingest_ringcentral_thread",
                    ringcentralMessage,
                  ),
                })}\n\n`,
              ),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });

        return new Response(earlyStream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Model-Provider": route.provider,
            "X-Model-Id": route.model,
            "X-Route-Reason": route.reason,
          },
        });
      }
    }

    if (autoMarginPayload && !autoRingCentralPayload) {
      const payloadRecord = asJsonRecord(autoMarginPayload) || {};
      const payloadRows = Array.isArray(payloadRecord.rows)
        ? payloadRecord.rows
            .map((entry) => asJsonRecord(entry))
            .filter((entry): entry is Record<string, unknown> => Boolean(entry))
        : [];
      const rows =
        payloadRows.length > 0 ? payloadRows : [payloadRecord];

      try {
        const marginResult = await ingestMarginLedgerCapture({
          view_type: readString(payloadRecord.view_type || payloadRecord.viewType) || "aya_margin_calculator",
          source_kind: readString(payloadRecord.source) || "aya_margin_calculator",
          source_url: readString(payloadRecord.source_url || payloadRecord.sourceUrl) || null,
          captured_at: readString(payloadRecord.captured_at || payloadRecord.capturedAt) || null,
          raw_capture_json: payloadRecord,
          rows,
        });

        const canonicalUpserted = Number(marginResult.canonical_upserted || 0);
        const canonicalUpdated = Number(marginResult.canonical_updated || 0);
        const rowsUpdated = canonicalUpserted + canonicalUpdated;
        const outcome =
          canonicalUpserted > 0
            ? "inserted"
            : canonicalUpdated > 0
              ? "updated"
              : "no_change";

        preIngestWriteEvent = {
          type: "write_result",
          outcome,
          action: "ingest_margin_payload",
          objectType: "margin_ledger_capture",
          rowsUpdated,
          code: null,
          payload: marginResult,
        };
        preIngestExecuted = true;
        requireFollowupWriteAfterIngest = false;

        const rowLabel = rowsUpdated === 1 ? "row" : "rows";
        const text =
          outcome === "no_change"
            ? "Package data already matched Packages. No new rows were written. Next useful action: create an offer from the package when you have a candidate."
            : `Package data saved to Packages (${rowsUpdated} ${rowLabel}). Next useful action: create an offer from the package when you have a candidate.`;

        return buildEventStreamResponse(
          [
            buildWriteResultEvent(preIngestWriteEvent),
            { type: "text", text },
          ],
          { provider: route.provider, model: route.model, reason: "margin_payload_deterministic_ingest" },
        );
      } catch (marginErr) {
        const marginMessage = marginErr instanceof Error ? marginErr.message : String(marginErr);
        const encoder = new TextEncoder();
        const earlyStream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify(buildWriteResultEvent({
                  type: "write_result",
                  outcome: "failed",
                  action: "ingest_margin_payload",
                  rowsUpdated: null,
                  code: "MARGIN_INGEST_FAILED",
                  payload: {
                    action: "ingest_margin_payload",
                    code: "MARGIN_INGEST_FAILED",
                    error: marginMessage,
                  },
                }))}\n\n`,
              ),
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "error",
                  code: "MARGIN_INGEST_FAILED",
                  message: buildUserFacingLookupErrorMessage(
                    "ingest_margin_payload",
                    marginMessage,
                  ),
                })}\n\n`,
              ),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });

        return new Response(earlyStream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Model-Provider": route.provider,
            "X-Model-Id": route.model,
            "X-Route-Reason": route.reason,
          },
        });
      }
    }

    if (autoNovaProfilePayload) {
      const ingestExecution = await executeDbTool("ingest_nova_profile", {
        candidate_profile: autoNovaProfilePayload,
      });

      if (ingestExecution.error) {
        const ingestErrorMessage = ingestExecution.error ?? "Unknown ingest error";
        const encoder = new TextEncoder();
        const earlyStream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify(buildWriteResultEvent({
                  type: "write_result",
                  outcome: "failed",
                  action: "ingest_nova_profile",
                  rowsUpdated: null,
                  code: "PROFILE_INGEST_FAILED",
                  payload: {
                    action: "ingest_nova_profile",
                    code: "PROFILE_INGEST_FAILED",
                    error: ingestErrorMessage,
                  },
                }))}\n\n`,
              ),
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "error",
                  code: "PROFILE_INGEST_FAILED",
                  message: buildUserFacingLookupErrorMessage(
                    "ingest_nova_profile",
                    ingestErrorMessage,
                  ),
                })}\n\n`,
              ),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });

        return new Response(earlyStream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Model-Provider": route.provider,
            "X-Model-Id": route.model,
            "X-Route-Reason": route.reason,
          },
        });
      }

      const ingestResult = asJsonRecord(ingestExecution.result) || {};
      const rowsUpdatedRaw =
        typeof ingestResult.rows_updated === "number"
          ? ingestResult.rows_updated
          : typeof ingestResult.rows_updated === "string"
            ? Number(ingestResult.rows_updated)
            : null;
      const rowsUpdated =
        typeof rowsUpdatedRaw === "number" && Number.isFinite(rowsUpdatedRaw) ? rowsUpdatedRaw : null;
      const rawOutcome =
        typeof ingestResult.outcome === "string" ? ingestResult.outcome.toLowerCase() : "";
      const outcome =
        rawOutcome === "inserted" || rawOutcome === "updated" || rawOutcome === "no_change"
          ? rawOutcome
          : "inserted";

      preIngestWriteEvent = {
        type: "write_result",
        outcome,
        action: "ingest_nova_profile",
        objectType: typeof ingestResult.object_type === "string" ? ingestResult.object_type : "candidate_profile",
        rowsUpdated,
        code: null,
        payload: ingestResult,
      };
      preIngestExecuted = true;
      requireFollowupWriteAfterIngest = requiresPostIngestWrite(prompt);

      const canonicalCandidateId =
        typeof ingestResult.candidate_id === "string" ? ingestResult.candidate_id : "";
      const novaId = typeof ingestResult.nova_id === "string" ? ingestResult.nova_id : "";

      fullPrompt = `${fullPrompt}

[System note: ingest_nova_profile already executed before this turn. Candidate is persisted for follow-up actions. Use candidate_id "${canonicalCandidateId}"${novaId ? ` (nova_id "${novaId}")` : ""} for any add_candidate_note or create_com_draft_email action.]`;
    }

    // ── Grounded Write Interceptor ─────────────────────────────────
    // Detects write intents from the raw prompt, resolves entities,
    // executes writes directly — BEFORE the LLM runs. No tool calling.
    if (activeMode === "ayaops" && !preIngestExecuted) {
      try {
        const selectedCandidateIdForInterceptor = selectedContext?.candidate_id || null;
        const groundedWrite = await interceptGroundedWrite(prompt, selectedCandidateIdForInterceptor);

        if (groundedWrite.intercepted) {
          preIngestWriteEvent = {
            type: "write_result",
            outcome: (groundedWrite.result as any).outcome || "updated",
            action: groundedWrite.action,
            objectType: "grounded_write",
            rowsUpdated: (groundedWrite.result as any).rows_updated ?? 1,
            code: null,
            payload: groundedWrite.result,
          };
          preIngestExecuted = true;
          requireFollowupWriteAfterIngest = false;

          fullPrompt = `${fullPrompt}\n\n${groundedWrite.groundingText}`;

          console.log(
            `[grounded_write] action=${groundedWrite.action} candidate=${groundedWrite.displayName} candidate_id=${groundedWrite.candidateId}`,
          );
        }
      } catch (groundedErr) {
        console.warn("[grounded_write] interceptor failed, falling through to LLM:", groundedErr);
      }
    }

    // ══════════════════════════════════════════════════════════════
    // CLAUDE PATH (with silent fallback to Gemini)
    // ══════════════════════════════════════════════════════════════
    if (route.provider === "claude") {
      try {
        const claudeMessages: { role: "user" | "assistant"; content: string }[] = [];

        if (history && Array.isArray(history)) {
          for (const msg of history) {
            claudeMessages.push({
              role: msg.role === "user" ? "user" : "assistant",
              content: msg.text,
            });
          }
        }
        claudeMessages.push({ role: "user", content: fullPrompt });

        const claudeModel = route.model === "opus" ? "opus" : "sonnet";
        const stream = await callClaude({
          model: claudeModel,
          systemPrompt,
          messages: claudeMessages,
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Model-Provider": route.provider,
            "X-Model-Id": route.model,
            "X-Route-Reason": route.reason,
          },
        });
      } catch (claudeErr) {
        console.warn(`[router] Claude ${route.model} failed, falling back to Gemini flash:`, claudeErr);
        route = { model: "flash", provider: "gemini", reason: "claude_fallback" };
      }
    }

    // ══════════════════════════════════════════════════════════════
    // GEMINI PATH
    // ══════════════════════════════════════════════════════════════
    const geminiModel = route.model === "pro" ? GEMINI_MODELS.pro : GEMINI_MODELS.flash;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contents: any[] = [];
    if (history && Array.isArray(history)) {
      for (const msg of history) {
        contents.push({ role: msg.role === "user" ? "user" : "model", parts: [{ text: msg.text }] });
      }
    }

    const currentParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    currentParts.push({ text: fullPrompt });

    if (hasInlineImage) {
      const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        currentParts.push({
          inlineData: { mimeType: match[1], data: match[2] },
        });
      }
    }
    if (!hasInlineImage && hasSavedImage && imageRecordId) {
      const inline = await getEvidenceInlineData(imageRecordId);
      currentParts.push({
        inlineData: { mimeType: inline.mimeType, data: inline.data },
      });
    }

    contents.push({ role: "user", parts: currentParts });

    const enableAyaopsSandbox =
      activeMode === "ayaops" &&
      /\b(sandbox|preview|ship it|review before|dry run)\b/i.test(fullPrompt);

    // Build tools
    let tools: Array<Record<string, object>>;
    if (activeMode === "ayaops") {
      // AyaOps reads are URL-grounded via Vertex AI Search.
      // Mutations remain explicit DB write tools.
      const ayaopsFunctionDeclarations = [
        ACCESS_HUB_DECLARATION,
        INGEST_MARGIN_PAYLOAD_DECLARATION,
        ...AYAOPS_READ_TOOL_DECLARATIONS,
        ...(enableAyaopsSandbox
          ? [...AYAOPS_WRITE_TOOL_DECLARATIONS, ...SANDBOX_TOOL_DECLARATIONS]
          : AYAOPS_WRITE_TOOL_DECLARATIONS),
      ];
      tools = [
        {
          retrieval: {
            vertexAiSearch: {
              datastore: VERTEX_AI_AYAOPS_URL_DATASTORE,
            },
          },
        },
        {
          functionDeclarations: ayaopsFunctionDeclarations,
        },
      ];
      if (allowExternalGroundingInAyaops) {
        tools.push({ googleSearch: {} });
      }
    } else if (hasImage || isInternalRecord) {
      tools = [];
    } else if (activeMode === "code") {
      tools = [{ googleSearch: {} }, { codeExecution: {} }];
    } else if (activeMode === "healthcare" && RAG_CORPUS) {
      tools = [
        { googleSearch: {} },
        { retrieval: { vertexRagStore: {
          ragResources: [{ ragCorpus: RAG_CORPUS }],
          similarityTopK: 5,
        }}},
      ];
    } else {
      tools = [{ googleSearch: {} }];
      if (activeMode === "sports") {
        tools.push({ functionDeclarations: [ACCESS_HUB_DECLARATION] });
      }
      if (activeMode === "worldcup") {
        tools.push({ functionDeclarations: SANDBOX_TOOL_DECLARATIONS });
      }
    }

    const declaredToolNames =
      activeMode === "ayaops"
        ? [...AYAOPS_WRITE_TOOL_DECLARATIONS, ...AYAOPS_READ_TOOL_DECLARATIONS, ACCESS_HUB_DECLARATION, INGEST_MARGIN_PAYLOAD_DECLARATION]
          .map((tool) => String((tool as { name?: string }).name || ""))
          .filter(Boolean)
        : [];

    const rawToolPolicy = classifyToolRequirement({
      // Important: classify write intent from the user's raw prompt only.
      // Using the expanded prompt can create false positives because
      // injected system notes contain verbs like "write"/"update".
      prompt,
      availableToolNames: declaredToolNames,
      mode: activeMode,
    });
    const toolPolicy =
      activeMode === "ayaops" &&
      hasPrefetchedAyaopsObservation &&
      rawToolPolicy.requiredToolKind === "read"
        ? {
            ...rawToolPolicy,
            readGroundingIntent: false,
            requiredToolKind: "none",
            toolRequired: false,
          }
        : rawToolPolicy;

    if (toolPolicy.toolRequired && !toolPolicy.hasMatchingRequiredTool) {
      const requiresWrite = toolPolicy.requiredToolKind === "write";
      const payload = {
        type: "error",
        code: requiresWrite
          ? "TOOL_UNAVAILABLE_FOR_WRITE_INTENT"
          : "TOOL_UNAVAILABLE_FOR_READ_INTENT",
        message: requiresWrite
          ? "This request requires a write-capable tool, but no matching write tool is currently available. Please use a supported execute path or ask for a read-only lookup."
          : "This request requires a grounded read tool, but no matching read tool is currently available. Please retry in AyaOps mode.",
      };

      console.warn(`[tool_policy] ${JSON.stringify({
        event: requiresWrite
          ? "TOOL_UNAVAILABLE_FOR_WRITE_INTENT"
          : "TOOL_UNAVAILABLE_FOR_READ_INTENT",
        tool_required: true,
        tool_called: false,
        tool_name: "",
        tool_execution_success: false,
        simulated_tool_text_detected: false,
        retry_count: 0,
        matched_verb: toolPolicy.matchedVerb,
        required_tool_kind: toolPolicy.requiredToolKind,
      })}`);

      const encoder = new TextEncoder();
      const earlyStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      return new Response(earlyStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Model-Provider": route.provider,
          "X-Model-Id": route.model,
          "X-Route-Reason": route.reason,
        },
      });
    }

    // Cache or inline system prompt.
    // Gemini rejects requests that include cachedContent together with tools/systemInstruction.
    // We only use cache for tool-less requests.
    let cachedContentName: string | null = null;
    if (!hasImage && !isInternalRecord && tools.length === 0) {
      cachedContentName = await getOrCreateCache(activeMode, geminiModel, systemPrompt);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: any = cachedContentName
      ? { cachedContent: cachedContentName, temperature: 1.0 }
      : { tools, temperature: 1.0, systemInstruction: systemPrompt };

    const responseStream = await ai.models.generateContentStream({
      model: geminiModel,
      contents,
      config,
    });

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const encoder = new TextEncoder();
          let hasSentGrounding = false;

          // ── Function-calling loop (ayaops DB tools) ──────────
          // Collect first response. If it contains functionCall parts,
          // execute tools and re-call the model before streaming.
          if (activeMode === "ayaops") {
            const MAX_TOOL_ROUNDS = 4;
            const MAX_STRICT_RETRIES = 1;
            const emit = (payload: Record<string, unknown>) => {
              const normalized =
                String(payload.type || "") === "write_result"
                  ? buildWriteResultEvent(payload)
                  : payload;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(normalized)}\n\n`));
            };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const collectRound = async (stream: any): Promise<{
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              parts: any[];
              groundingQueries: string[];
              citations: Array<{ title: string; uri: string }>;
            }> => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const parts: any[] = [];
              const queries = new Set<string>();
              const citationByUri = new Map<string, { title: string; uri: string }>();

              for await (const chunk of stream) {
                const chunkParts = chunk.candidates?.[0]?.content?.parts;
                if (chunkParts) parts.push(...chunkParts);
                const meta = chunk.candidates?.[0]?.groundingMetadata;
                if (meta) {
                  const payload = extractGroundingPayload(meta);
                  for (const query of payload.queries) queries.add(query);
                  for (const citation of payload.citations) {
                    if (!citationByUri.has(citation.uri)) {
                      citationByUri.set(citation.uri, citation);
                    }
                  }
                }
              }

              return {
                parts,
                groundingQueries: Array.from(queries),
                citations: Array.from(citationByUri.values()),
              };
            };

            let round = 1;
            let didEmitTerminal = false;
            let retryCount = 0;
            let hasExecutedTool = preIngestExecuted && !requireFollowupWriteAfterIngest;
            let sandboxTaskCreated = false;
            const preIngestAction =
              preIngestWriteEvent && typeof preIngestWriteEvent.action === "string"
                ? preIngestWriteEvent.action
                : preIngestExecuted
                  ? "ingest_nova_profile"
                  : "";
            const calledToolNames = new Set<string>(preIngestAction ? [preIngestAction] : []);
            const internalRefIds = new Set<string>();
            const internalReferences: Array<{
              ref_id: string;
              label: string;
              source_table: string;
              source_key: string;
              uri?: string | null;
            }> = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let roundContents: any[] = [...contents];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let roundStream: any = responseStream;

            const telemetry = {
              tool_required: toolPolicy.toolRequired,
              tool_called: preIngestExecuted,
              tool_name: "",
              tool_execution_success: preIngestExecuted && !requireFollowupWriteAfterIngest,
              simulated_tool_text_detected: false,
              retry_count: 0,
            };

            const logToolPolicy = (event: string, extra: Record<string, unknown> = {}) => {
              telemetry.tool_name = Array.from(calledToolNames).join(",");
              console.log(`[tool_policy] ${JSON.stringify({
                event,
                ...telemetry,
                ...extra,
              })}`);
            };

            const candidateScopedTools = new Set([
              "update_candidate_status",
              "update_candidate_profession",
              "add_candidate_note",
              "create_com_draft_email",
            ]);
            const allowedAyaopsTools = new Set<string>([
              "access_hub",
              ...declaredToolNames,
              ...SANDBOX_TOOL_NAMES,
            ]);
            let activeCandidateInput = selectedContextCandidateInput;
            let activeCandidateEmail = selectedContext?.candidate_email || "";
            let lastNonEmptyModelText = "";
            let lastHubReadResult: Record<string, unknown> | null = null;

            if (preIngestWriteEvent) {
              emit(preIngestWriteEvent);
            }

            while (round <= MAX_TOOL_ROUNDS) {
              const roundBundle = await collectRound(roundStream);
              const roundParts = roundBundle.parts;
              if (!hasSentGrounding && roundBundle.citations.length > 0) {
                emit({
                  type: "grounding",
                  queries: roundBundle.groundingQueries,
                  citations: roundBundle.citations,
                });
                hasSentGrounding = true;
              }
              const functionCalls = roundParts.filter((p) => p.functionCall);
              const finalText = roundParts
                .filter((p) => typeof p.text === "string" && p.text.trim().length > 0)
                .map((part) => String(part.text))
                .join("");
              if (finalText.trim().length > 0) {
                lastNonEmptyModelText = finalText.trim();
              }
              const simulatedToolTextDetected = detectSimulatedToolText(finalText);
              if (simulatedToolTextDetected) {
                telemetry.simulated_tool_text_detected = true;
              }

              const turnDecision = evaluateToolRequiredTurn({
                toolRequired: toolPolicy.toolRequired,
                hasFunctionCalls: functionCalls.length > 0,
                hasText: finalText.trim().length > 0,
                simulatedToolTextDetected,
                hasExecutedTool,
                retryCount,
                maxRetries: MAX_STRICT_RETRIES,
              });

              if (turnDecision.action === "execute_tools") {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const toolResponses: any[] = [];
                const executedNames: string[] = [];
                const executionOutcomes: Array<{ ok: boolean; name: string; error?: string }> = [];

                for (const fc of functionCalls) {
                  const name = typeof fc.functionCall?.name === "string" ? fc.functionCall.name : "";
                  const rawArgs = fc.functionCall?.args;
                  const args = rawArgs && typeof rawArgs === "object" ? rawArgs : {};
                  const toolArgs = asJsonRecord(args) ? { ...(args as Record<string, unknown>) } : {};
                  const isWriteTool =
                    name === "update_candidate_status" ||
                    name === "update_candidate_profession" ||
                    name === "add_candidate_note" ||
                    name === "create_com_draft_email" ||
                    name === "ingest_margin_payload";
                  const isSandboxTool = SANDBOX_TOOL_NAMES.has(name);

                  if (!name) continue;
                  if (!allowedAyaopsTools.has(name)) {
                    executionOutcomes.push({
                      ok: false,
                      name,
                      error: `Tool '${name}' is not available in the current mode.`,
                    });
                    toolResponses.push({
                      functionResponse: {
                        name,
                        response: {
                          result: null,
                          error: `Tool '${name}' is not available in the current mode.`,
                        },
                      },
                    });
                    continue;
                  }

                  telemetry.tool_called = true;
                  calledToolNames.add(name);
                  executedNames.push(name);

                  if (candidateScopedTools.has(name)) {
                    const explicitCandidateInput = readString(
                      toolArgs.candidate_id || toolArgs.candidateId || toolArgs.id,
                    );
                    if (!explicitCandidateInput && activeCandidateInput) {
                      toolArgs.candidate_id = activeCandidateInput;
                    }
                  }

                  if (name === "create_com_draft_email") {
                    const explicitToEmail = readString(toolArgs.to_email || toolArgs.toEmail);
                    if (!explicitToEmail && activeCandidateEmail) {
                      toolArgs.to_email = activeCandidateEmail;
                    }
                  }

                  // ── Tool status: emit BEFORE execution ──
                  emit({
                    type: "tool_status",
                    tool: name,
                    status: "running",
                    label: TOOL_LABELS[name] || name.replace(/_/g, " "),
                  });

                  const toolStartTime = Date.now();
                  let toolResult: { result: unknown; error?: string; error_code?: string; retryable?: boolean };

                  if (isSandboxTool) {
                    const sandbox = toSandboxChunk(name, toolArgs, prompt);
                    if ("error" in sandbox) {
                      executionOutcomes.push({ ok: false, name, error: sandbox.error });
                      toolResponses.push({
                        functionResponse: {
                          name,
                          response: { result: null, error: sandbox.error },
                        },
                      });
                      continue;
                    }

                    sandboxTaskCreated = true;
                    emit(sandbox.chunk);
                    executionOutcomes.push({ ok: true, name });
                    toolResponses.push({
                      functionResponse: {
                        name,
                        response: { result: sandbox.toolResponse },
                      },
                    });
                    continue;
                  } else {
                    try {
                      if (name === "access_hub") {
                        const hubPath = typeof toolArgs.path === "string" ? toolArgs.path : "";
                        const hubResult = await resolveHub(hubPath);
                        toolResult = { result: hubResult };
                      } else if (name === "ingest_margin_payload") {
                        const inputRows = Array.isArray(toolArgs.rows)
                          ? toolArgs.rows
                              .map((entry) => asJsonRecord(entry))
                              .filter((entry): entry is Record<string, unknown> => Boolean(entry))
                          : [];
                        const marginResult = await ingestMarginLedgerCapture({
                          view_type: readString(toolArgs.view_type || toolArgs.viewType) || "pay_package_screenshot",
                          source_kind: readString(toolArgs.source_kind || toolArgs.sourceKind) || "screenshot_vision",
                          source_url: readString(toolArgs.source_url || toolArgs.sourceUrl) || null,
                          screenshot_id: readString(toolArgs.screenshot_id || toolArgs.screenshotId || imageRecordId) || null,
                          captured_at: readString(toolArgs.captured_at || toolArgs.capturedAt) || new Date().toISOString(),
                          raw_capture_json: toolArgs,
                          rows: inputRows,
                        });
                        const canonicalUpserted = Number(marginResult.canonical_upserted || 0);
                        const canonicalUpdated = Number(marginResult.canonical_updated || 0);
                        const rowsUpdated = canonicalUpserted + canonicalUpdated;
                        const outcome =
                          canonicalUpserted > 0
                            ? "inserted"
                            : canonicalUpdated > 0
                              ? "updated"
                              : "no_change";
                        toolResult = {
                          result: {
                            ...marginResult,
                            action: "ingest_margin_payload",
                            object_type: "margin_ledger_capture",
                            rows_updated: rowsUpdated,
                            outcome,
                          },
                        };
                      } else {
                        toolResult = await executeDbTool(name, toolArgs);
                      }
                    } catch (toolErr) {
                      console.error(`[db_tool] ${name} FAILED:`, toolErr);
                      toolResult = {
                        result: null,
                        error: toolErr instanceof Error ? toolErr.message : "unknown error",
                      };
                    }
                  }

                  // ── Tool status: emit AFTER execution ──
                  emit({
                    type: "tool_status",
                    tool: name,
                    status: toolResult.error ? "failed" : "ok",
                    latency_ms: Date.now() - toolStartTime,
                    label: toolResult.error
                      ? (TOOL_LABELS_DONE[name] || name.replace(/_/g, " ")) + " failed"
                      : TOOL_LABELS_DONE[name] || `${name.replace(/_/g, " ")} complete`,
                  });

                  if (isWriteTool) {
                    if (toolResult.error) {
                      const errorCode = /CANDIDATE_NOT_FOUND/i.test(toolResult.error)
                        ? "CANDIDATE_NOT_FOUND"
                        : /CANDIDATE_EMAIL_MISSING/i.test(toolResult.error)
                          ? "CANDIDATE_EMAIL_MISSING"
                        : /INVALID_UPDATE_PAYLOAD/i.test(toolResult.error)
                          ? "INVALID_UPDATE_PAYLOAD"
                          : "TOOL_EXECUTION_FAILED";
                      emit({
                        type: "write_result",
                        outcome: "failed",
                        action: name,
                        rowsUpdated: null,
                        code: errorCode,
                        payload: {
                          action: name,
                          error: toolResult.error,
                          code: errorCode,
                        },
                      });
                    } else {
                      const resultObj =
                        toolResult.result && typeof toolResult.result === "object"
                          ? (toolResult.result as Record<string, unknown>)
                          : {};

                      const actionName =
                        typeof resultObj.action === "string" ? resultObj.action : name;
                      const objectType =
                        typeof resultObj.object_type === "string" ? resultObj.object_type : undefined;
                      const rawRows =
                        typeof resultObj.rows_updated === "number"
                          ? resultObj.rows_updated
                          : typeof resultObj.rows_updated === "string"
                            ? Number(resultObj.rows_updated)
                            : null;
                      const rowsUpdated =
                        typeof rawRows === "number" && Number.isFinite(rawRows) ? rawRows : null;

                      const rawOutcome =
                        typeof resultObj.outcome === "string"
                          ? resultObj.outcome.toLowerCase()
                          : null;
                      let outcome: "updated" | "inserted" | "no_change" | "failed" = "updated";
                      if (rawOutcome === "inserted" || rawOutcome === "updated" || rawOutcome === "no_change" || rawOutcome === "failed") {
                        outcome = rawOutcome;
                      } else if (rowsUpdated === 0) {
                        outcome = "no_change";
                      } else if (actionName === "update_candidate_status") {
                        outcome = "updated";
                      } else {
                        outcome = "inserted";
                      }

                      emit({
                        type: "write_result",
                        outcome,
                        action: actionName,
                        objectType,
                        rowsUpdated,
                        code: null,
                        payload: resultObj,
                      });

                      const resultCandidateId = readString(resultObj.candidate_id);
                      const resultNovaId = readString(resultObj.nova_id);
                      const resultToEmail = readString(resultObj.to_email);
                      if (resultCandidateId || resultNovaId) {
                        activeCandidateInput = resultCandidateId || resultNovaId;
                      }
                      if (resultToEmail) {
                        activeCandidateEmail = resultToEmail;
                      }
                    }
                  }

                  if (toolResult.error) {
                    executionOutcomes.push({ ok: false, name, error: toolResult.error });
                  } else {
                    executionOutcomes.push({ ok: true, name });
                    if (name === "access_hub" && toolResult.result && typeof toolResult.result === "object") {
                      lastHubReadResult = toolResult.result as Record<string, unknown>;
                    }

                    if (name === "get_internal_grounding_context" && toolResult.result && typeof toolResult.result === "object") {
                      const refs = (toolResult.result as { references?: unknown }).references;
                      if (Array.isArray(refs)) {
                        for (const ref of refs) {
                          if (!ref || typeof ref !== "object") continue;
                          const refId = String((ref as { ref_id?: unknown }).ref_id || "").trim();
                          if (!refId || internalRefIds.has(refId)) continue;
                          internalRefIds.add(refId);
                          internalReferences.push({
                            ref_id: refId,
                            label: String((ref as { label?: unknown }).label || "Internal reference"),
                            source_table: String((ref as { source_table?: unknown }).source_table || "unknown_table"),
                            source_key: String((ref as { source_key?: unknown }).source_key || "unknown_key"),
                            uri: (ref as { uri?: unknown }).uri ? String((ref as { uri?: unknown }).uri) : null,
                          });
                        }
                      }
                    }
                  }

                  toolResponses.push({
                    functionResponse: {
                      name,
                      response: toolResult,
                    },
                  });
                }

                console.log(
                  `[ayaops_loop] round=${round} tool_calls=${executedNames.join(",") || "none"} call_count=${functionCalls.length}`
                );

                if (toolResponses.length === 0) {
                  logToolPolicy("TOOL_CALL_INVALID", { round });
                  emit({
                    type: "error",
                    code: "TOOL_CALL_INVALID",
                    message: "No valid internal lookup call was returned. Please retry with candidate name or ID.",
                  });
                  didEmitTerminal = true;
                  break;
                }

                const executionSummary = summarizeToolExecution(executionOutcomes);
                telemetry.tool_execution_success = executionSummary.ok;
                hasExecutedTool = true;

                if (!executionSummary.ok) {
                  const firstError = executionSummary.failed[0];
                  logToolPolicy("TOOL_EXECUTION_FAILED", {
                    round,
                    failed_tool: firstError?.name || "",
                  });
	                  emit({
	                    type: "error",
	                    code: "TOOL_EXECUTION_FAILED",
	                    message: buildUserFacingLookupErrorMessage(
	                      firstError?.name || "tool",
	                      firstError?.error || "",
	                    ),
	                  });
                  didEmitTerminal = true;
                  break;
                }

                roundContents = [
                  ...roundContents,
                  { role: "model", parts: roundParts },
                  { role: "user", parts: toolResponses },
                ];

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const followupConfig: any = cachedContentName
                  ? { cachedContent: cachedContentName, temperature: 1.0 }
                  : { tools, temperature: 1.0, systemInstruction: systemPrompt };

                roundStream = await ai.models.generateContentStream({
                  model: geminiModel,
                  contents: roundContents,
                  config: followupConfig,
                });

                round += 1;
                continue;
              }

              if (turnDecision.action === "retry_strict") {
                retryCount += 1;
                telemetry.retry_count = retryCount;
                logToolPolicy("TOOL_NOT_CALLED_WHEN_REQUIRED", {
                  round,
                  terminal_state: turnDecision.code || "TOOL_NOT_CALLED_WHEN_REQUIRED",
                });

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const strictRetryConfig: any = {
                  tools,
                  temperature: 0.2,
                  systemInstruction: `${systemPrompt}\n\n${STRICT_TOOL_CALL_SYSTEM_MESSAGE}`,
                };

                roundStream = await ai.models.generateContentStream({
                  model: geminiModel,
                  contents: roundContents,
                  config: strictRetryConfig,
                });
                round += 1;
                continue;
              }

              if (turnDecision.action === "emit_text") {
                let textToEmit = finalText;
                if (sandboxTaskCreated) {
                  textToEmit = "Preview ready. Review in Sandbox.";
                }
                if (internalReferences.length > 0 && !/\[INT-\d+\]/i.test(textToEmit)) {
                  const refLines = internalReferences
                    .map(
                      (ref) => `- [${ref.ref_id}] ${ref.label} (${ref.source_table}:${ref.source_key})`
                    )
                    .join("\n");
                  textToEmit = `${textToEmit}\n\n**Internal References**\n${refLines}`.trim();
                }

                const linkableInternalCitations = internalReferences
                  .filter((ref) => typeof ref.uri === "string" && ref.uri.length > 0)
                  .map((ref) => ({
                    title: `${ref.ref_id} ${ref.label}`,
                    uri: String(ref.uri),
                  }));
                if (linkableInternalCitations.length > 0) {
                  emit({
                    type: "grounding",
                    queries: ["internal_grounding_context"],
                    citations: linkableInternalCitations,
                  });
                }

                emit({ type: "text", text: textToEmit });
                console.log(`[ayaops_loop] round=${round} terminal=text chars=${textToEmit.length}`);
                logToolPolicy("TERMINAL_TEXT", { round, chars: textToEmit.length });
                didEmitTerminal = true;
                break;
              }

              const errorCode =
                String(turnDecision.code || "TOOL_REQUIRED_FLOW_FAILED").toUpperCase();
              if (
                errorCode === "TOOL_NOT_CALLED_WHEN_REQUIRED" &&
                toolPolicy.requiredToolKind === "read"
              ) {
                const fallbackHubPath = deriveAyaopsReadFallbackHubPath(
                  prompt,
                  activeCandidateInput || selectedContextCandidateInput || "",
                );
                if (fallbackHubPath) {
                  emit({
                    type: "tool_status",
                    tool: "access_hub",
                    status: "running",
                    label: TOOL_LABELS.access_hub || "Hub lookup",
                  });

                  let fallbackResult: Awaited<ReturnType<typeof resolveHub>> | null = null;
                  let fallbackError = "";
                  const fallbackStart = Date.now();
                  try {
                    fallbackResult = await resolveHub(fallbackHubPath);
                  } catch (fallbackErr) {
                    fallbackError =
                      fallbackErr instanceof Error ? fallbackErr.message : "hub fallback failed";
                  }

                  emit({
                    type: "tool_status",
                    tool: "access_hub",
                    status: fallbackError ? "failed" : "ok",
                    latency_ms: Date.now() - fallbackStart,
                    label: fallbackError
                      ? `${TOOL_LABELS_DONE.access_hub || "Record loaded"} failed`
                      : TOOL_LABELS_DONE.access_hub || "Record loaded",
                  });

                  if (!fallbackError && fallbackResult) {
                    telemetry.tool_called = true;
                    telemetry.tool_execution_success = true;
                    hasExecutedTool = true;
                    calledToolNames.add("access_hub");
                    lastHubReadResult = fallbackResult as Record<string, unknown>;
                    logToolPolicy("TOOL_AUTO_READ_FALLBACK", {
                      round,
                      fallback_path: fallbackHubPath,
                    });

                    roundContents = [
                      ...roundContents,
                      { role: "model", parts: roundParts },
                      {
                        role: "user",
                        parts: [
                          {
                            functionResponse: {
                              name: "access_hub",
                              response: { result: fallbackResult },
                            },
                          },
                        ],
                      },
                    ];

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const fallbackConfig: any = cachedContentName
                      ? { cachedContent: cachedContentName, temperature: 1.0 }
                      : { tools, temperature: 1.0, systemInstruction: systemPrompt };

                    roundStream = await ai.models.generateContentStream({
                      model: geminiModel,
                      contents: roundContents,
                      config: fallbackConfig,
                    });
                    round += 1;
                    continue;
                  }
                }
              }
              if (errorCode === "EMPTY_RESPONSE" && lastHubReadResult) {
                const fallbackText = buildAyaopsHubFallbackText(lastHubReadResult);
                if (fallbackText) {
                  emit({ type: "text", text: fallbackText });
                  logToolPolicy("TERMINAL_TEXT_FROM_HUB_FALLBACK", { round });
                  didEmitTerminal = true;
                  break;
                }
              }
              if (sandboxTaskCreated && errorCode !== "TOOL_EXECUTION_FAILED") {
                emit({ type: "text", text: "Preview ready. Review in Sandbox." });
                didEmitTerminal = true;
                break;
              }
              const errorMessage =
                errorCode === "TOOL_NOT_CALLED_WHEN_REQUIRED"
                  ? "Tool-required request was not executed. Please retry with candidate details."
                  : "No response was returned after internal lookup. Please retry with candidate name or ID.";

              logToolPolicy(errorCode, { round });
              emit({
                type: "error",
                code: errorCode,
                message: errorMessage,
              });
              didEmitTerminal = true;
              break;
            }

            if (!didEmitTerminal) {
              console.warn(`[ayaops_loop] terminal=max_rounds_reached rounds=${MAX_TOOL_ROUNDS}`);
              const resolutionReason =
                selectedContextCandidateInput || selectedContext?.candidate_name
                  ? "selected_context_missing"
                  : "name_match_ambiguous";
              logToolPolicy("CANDIDATE_RESOLUTION_FAILED", {
                rounds: MAX_TOOL_ROUNDS,
                reason: resolutionReason,
              });
              if (lastNonEmptyModelText) {
                emit({
                  type: "text",
                  text: `${lastNonEmptyModelText}\n\nI could not safely resolve a single candidate before the lookup limit. Retry with one candidate name or ID.`,
                });
              }
              emit({
                type: "error",
                code: "CANDIDATE_RESOLUTION_FAILED",
                reason: resolutionReason,
                message:
                  resolutionReason === "selected_context_missing"
                    ? "I could not resolve the selected candidate context before the lookup loop limit."
                    : "I could not resolve a unique candidate from name-only lookup before the lookup loop limit.",
              });
            }

            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }

          // ── Standard streaming (non-ayaops) ──────────────────
          let sandboxTaskCreated = false;
          let standardTextEmitted = false;
          for await (const chunk of responseStream) {
            if (!hasSentGrounding && chunk.candidates?.[0]?.groundingMetadata) {
              hasSentGrounding = true;
              const meta = chunk.candidates[0].groundingMetadata;
              const { queries, citations } = extractGroundingPayload(meta);
              
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "grounding", queries, citations })}\n\n`
                )
              );
            }

            const parts = chunk.candidates?.[0]?.content?.parts;
            if (parts) {
              for (const part of parts) {
                if (part.functionCall?.name && SANDBOX_TOOL_NAMES.has(String(part.functionCall.name))) {
                  const sandbox = toSandboxChunk(String(part.functionCall.name), part.functionCall.args, prompt);
                  if ("error" in sandbox) {
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({
                          type: "error",
                          code: "SANDBOX_TOOL_CALL_INVALID",
                          message: sandbox.error,
                        })}\n\n`,
                      ),
                    );
                  } else {
                    sandboxTaskCreated = true;
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify(sandbox.chunk)}\n\n`),
                    );
                  }
                }
                if (part.executableCode) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({
                        type: "executableCode",
                        code: part.executableCode.code || "",
                        language: part.executableCode.language || "PYTHON",
                      })}\n\n`
                    )
                  );
                }
                if (part.codeExecutionResult) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({
                        type: "codeExecutionResult",
                        outcome: part.codeExecutionResult.outcome || "UNKNOWN",
                        output: part.codeExecutionResult.output || "",
                      })}\n\n`
                    )
                  );
                }
              }
            }

            if (chunk.text && !sandboxTaskCreated) {
              standardTextEmitted = true;
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "text", text: chunk.text })}\n\n`
                )
              );
            }
          }

          if (sandboxTaskCreated && !standardTextEmitted) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "text", text: "Preview ready. Review in Sandbox." })}\n\n`,
              ),
            );
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Model-Provider": route.provider,
        "X-Model-Id": route.model,
        "X-Route-Reason": route.reason,
      },
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
  }
}

// ── Spanner DB Tools — Phase 2 (Read + Single Write Path) ───────
// Typed backend tools for Gemini function calling.
// The model calls these tools; backend owns all SQL.
// No raw SQL is ever exposed to the model.

import { randomUUID } from "node:crypto";
import { mapCandidateRow } from "@/lib/mappers/candidate";
import type { CandidateRecord } from "@/lib/types/candidate";
import { normalizeUSHomeState } from "@/lib/spanner/state-normalization";
import { getRecruitingDb } from "@/lib/spanner-pool";

const db = getRecruitingDb();

// ── Structured Tool Result Contract ─────────────────────────────
export type ToolResultOk = { ok: true; result: unknown };
export type ToolResultError = {
  ok: false;
  result: null;
  error_code:
    | "AMBIGUOUS_MATCH"
    | "NOT_FOUND"
    | "TIMEOUT"
    | "VALIDATION_ERROR"
    | "TOOL_EXECUTION_FAILED";
  message: string;
  retryable: boolean;
  alternatives?: Array<{ id: string; nova_id: string | null; name: string }>;
};
export type ToolResult = ToolResultOk | ToolResultError;

// ── Shared SQL fragment ─────────────────────────────────────────
const CANDIDATE_SELECT = `
  SELECT c.id, c.nova_id, c.first_name, c.last_name, c.specialty, c.profession,
         c.home_state, c.compliance_risk_level, c.source,
         a.status as assignment_status, a.start_date, a.end_date,
         a.weekly_gross, a.hourly_rate,
         f.name as facility_name, f.city as facility_city, f.state as facility_state,
         f.vms_platform, f.beds as facility_beds
  FROM hc_candidates c
  LEFT JOIN hc_assignments a ON a.id = (
    SELECT a1.id
    FROM hc_assignments a1
    WHERE a1.candidate_id = c.id
      AND LOWER(COALESCE(a1.status, '')) IN ('pending_start', 'active', 'in_pipeline')
    ORDER BY
      CASE
        WHEN LOWER(a1.status) = 'pending_start'
          AND SAFE_CAST(a1.start_date AS DATE) IS NOT NULL
          AND SAFE_CAST(a1.start_date AS DATE) >= CURRENT_DATE() THEN 0
        WHEN LOWER(a1.status) = 'active' THEN 1
        WHEN LOWER(a1.status) = 'in_pipeline' THEN 2
        WHEN LOWER(a1.status) = 'pending_start' THEN 3
        WHEN LOWER(a1.status) IN ('completed', 'cancelled') THEN 4
        ELSE 5
      END,
      CASE
        WHEN LOWER(a1.status) = 'pending_start'
          AND SAFE_CAST(a1.start_date AS DATE) IS NOT NULL
          AND SAFE_CAST(a1.start_date AS DATE) >= CURRENT_DATE()
          THEN SAFE_CAST(a1.start_date AS DATE)
        WHEN LOWER(a1.status) = 'active'
          THEN COALESCE(SAFE_CAST(a1.end_date AS DATE), DATE '9999-12-31')
        WHEN LOWER(a1.status) = 'in_pipeline'
          THEN COALESCE(SAFE_CAST(a1.start_date AS DATE), DATE '9999-12-31')
        ELSE COALESCE(SAFE_CAST(a1.start_date AS DATE), DATE '0001-01-01')
      END ASC,
      COALESCE(SAFE_CAST(a1.start_date AS DATE), DATE '0001-01-01') DESC,
      a1.id DESC
    LIMIT 1
  )
  LEFT JOIN hc_facilities f ON a.facility_id = f.id`;

const MAX_RESULTS = 25;
const WRITE_STATUS_ALLOWED = ["active", "pending_start", "completed", "in_pipeline", "cancelled"];
const NOTE_TYPE_ALLOWED = ["prep_note", "follow_up", "compliance", "general"];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANDIDATE_NOT_FOUND_CODE = "CANDIDATE_NOT_FOUND";

// ══════════════════════════════════════════════════════════════════
// TOOL DECLARATIONS (Gemini function-calling schema)
// ══════════════════════════════════════════════════════════════════

export const DB_TOOL_DECLARATIONS = [
  {
    name: "get_candidate_by_id",
    description: "Retrieve a single internal candidate record by their unique ID. Returns full candidate profile including assignment status, facility, dates, and compliance info.",
    parameters: {
      type: "object" as const,
      properties: {
        id: { type: "string" as const, description: "Candidate internal UUID or Nova numeric ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "list_candidates_by_status",
    description: "List internal candidates filtered by their current assignment status. Valid statuses: 'On Assignment', 'Starting Soon', 'Completed', 'Wrapped Up', 'In Pipeline', 'Cancelled'. Returns up to 25 candidates.",
    parameters: {
      type: "object" as const,
      properties: {
        status: { type: "string" as const, description: "Assignment status to filter by (e.g. 'On Assignment', 'Starting Soon', 'Completed')" },
        limit: { type: "number" as const, description: "Max results to return (default 25, max 25)" },
      },
      required: ["status"],
    },
  },
  {
    name: "list_stale_prospects",
    description:
      "List prospect candidates (latest assignment status = in_pipeline) who have not been contacted in N+ days. Last contact is derived from latest outbound sent activity or follow_up notes.",
    parameters: {
      type: "object" as const,
      properties: {
        days_without_contact: {
          type: "number" as const,
          description: "Minimum days since last contact. Defaults to 30.",
        },
        limit: {
          type: "number" as const,
          description: "Max prospects to return (default 25, max 25).",
        },
      },
      required: [],
    },
  },
  {
    name: "search_candidates",
    description: "Search internal candidates by name, with optional specialty and state filters. Performs partial name matching. Returns up to 25 candidates.",
    parameters: {
      type: "object" as const,
      properties: {
        query: { type: "string" as const, description: "Partial or full candidate name to search for" },
        specialty: { type: "string" as const, description: "Optional specialty filter (e.g. 'Respiratory Therapy', 'ICU')" },
        state: { type: "string" as const, description: "Optional home state filter (e.g. 'CA', 'TX')" },
        limit: { type: "number" as const, description: "Max results to return (default 25, max 25)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_candidate_profile_link",
    description: "Get the Nova profile URL for a candidate by their ID. Returns the candidate's name and direct Nova link.",
    parameters: {
      type: "object" as const,
      properties: {
        id: { type: "string" as const, description: "Candidate internal UUID or Nova numeric ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_internal_grounding_context",
    description:
      "Fetch citation-ready internal truth context for a candidate from hc_candidates, hc_assignments, hc_submittals, hc_facilities, and job_orders. Use this for policy/rule/job/submittal grounding.",
    parameters: {
      type: "object" as const,
      properties: {
        candidate_id: { type: "string" as const, description: "Candidate internal UUID or Nova numeric ID" },
      },
      required: ["candidate_id"],
    },
  },
  {
    name: "ingest_nova_profile",
    description:
      "Ingest or upsert a full Nova candidate profile payload into hc_candidates. Resolves candidate by internal UUID or nova_id, writes canonical candidate row, and returns a DB-grounded confirmation payload.",
    parameters: {
      type: "object" as const,
      properties: {
        candidate_profile: {
          type: "object" as const,
          description:
            "Full Nova profile object. Must include source='nova_candidate_profile' plus candidate identity fields.",
        },
        payload_json: {
          type: "string" as const,
          description:
            "Optional raw JSON string of the full Nova profile payload. Used when passing the profile as text.",
        },
      },
      required: [],
    },
  },
  {
    name: "update_candidate_status",
    description:
      "Update candidate assignment status for the latest assignment row. This performs a real DB write and returns a DB-grounded confirmation payload including candidate_id, changed fields, rows_updated, and write timestamp.",
    parameters: {
      type: "object" as const,
      properties: {
        candidate_id: { type: "string" as const, description: "Candidate internal UUID or Nova numeric ID" },
        new_status: {
          type: "string" as const,
          description:
            "Target status. Accepted: active, pending_start, completed, in_pipeline, cancelled (plus common aliases like On Assignment, Starting Soon, Done).",
        },
      },
      required: ["candidate_id", "new_status"],
    },
  },
  {
    name: "update_candidate_profession",
    description:
      "Update candidate profession and/or specialty on hc_candidates. Accepts internal UUID or Nova numeric ID and returns a DB-grounded confirmation payload with changed fields and outcome.",
    parameters: {
      type: "object" as const,
      properties: {
        candidate_id: { type: "string" as const, description: "Candidate internal UUID or Nova numeric ID" },
        profession: {
          type: "string" as const,
          description:
            "Optional profession value to set. Omit to leave unchanged. Pass null (via tool args) to clear explicitly.",
        },
        specialty: {
          type: "string" as const,
          description:
            "Optional specialty value to set. Omit to leave unchanged. Pass null (via tool args) to clear explicitly.",
        },
      },
      required: ["candidate_id"],
    },
  },
  {
    name: "update_candidate_name",
    description:
      "Update a candidate's primary display and legal name (first_name and last_name) on hc_candidates. Accepts internal UUID or Nova numeric ID.",
    parameters: {
      type: "object" as const,
      properties: {
        candidate_id: { type: "string" as const, description: "Candidate internal UUID or Nova numeric ID" },
        first_name: {
          type: "string" as const,
          description: "Optional new first name. Omit to leave unchanged.",
        },
        last_name: {
          type: "string" as const,
          description: "Optional new last name. Omit to leave unchanged.",
        },
      },
      required: ["candidate_id"],
    },
  },
  {
    name: "add_candidate_note",
    description:
      "Create a candidate note in hc_notes. Performs a real DB write and returns a DB-grounded confirmation payload including candidate_id, note id, rows_updated, and write timestamp.",
    parameters: {
      type: "object" as const,
      properties: {
        candidate_id: { type: "string" as const, description: "Candidate internal UUID or Nova numeric ID" },
        content: { type: "string" as const, description: "Plain-text note content to save" },
        note_type: {
          type: "string" as const,
          description:
            "Optional note category. Accepted: prep_note, follow_up, compliance, general. Defaults to prep_note.",
        },
      },
      required: ["candidate_id", "content"],
    },
  },
  {
    name: "create_com_draft_email",
    description:
      "Create an outbound communication draft in activities and optionally save a note trace in hc_notes. Returns DB-grounded confirmation including draft_id, recipients, and optional note trace id.",
    parameters: {
      type: "object" as const,
      properties: {
        candidate_id: { type: "string" as const, description: "Candidate internal UUID or Nova numeric ID" },
        subject: { type: "string" as const, description: "Draft email subject line" },
        body: { type: "string" as const, description: "Draft email body content (plain text or markdown)" },
        to_email: { type: "string" as const, description: "Optional primary recipient. Defaults to candidate email when omitted." },
        cc: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Optional CC email list",
        },
        save_note_trace: {
          type: "boolean" as const,
          description: "When true (default), adds a short note trace to hc_notes with draft metadata.",
        },
      },
      required: ["candidate_id", "subject", "body"],
    },
  },
];

// ══════════════════════════════════════════════════════════════════
// TOOL EXECUTORS
// ══════════════════════════════════════════════════════════════════

export async function executeDbTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ result: unknown; error?: string; error_code?: string; retryable?: boolean }> {
  const start = Date.now();
  try {
    let result: unknown;

    switch (toolName) {
      case "get_candidate_by_id":
        result = await getCandidateById(String(args.id));
        break;
      case "list_candidates_by_status":
        result = await listCandidatesByStatus(
          String(args.status),
          Math.min(Number(args.limit) || MAX_RESULTS, MAX_RESULTS),
        );
        break;
      case "list_stale_prospects":
        result = await listStaleProspects({
          daysWithoutContact: Math.min(
            Math.max(Number(args.days_without_contact) || 30, 1),
            365,
          ),
          limit: Math.min(Number(args.limit) || MAX_RESULTS, MAX_RESULTS),
        });
        break;
      case "search_candidates":
        result = await searchCandidates(
          String(args.query),
          args.specialty ? String(args.specialty) : undefined,
          args.state ? String(args.state) : undefined,
          Math.min(Number(args.limit) || MAX_RESULTS, MAX_RESULTS),
        );
        break;
      case "get_candidate_profile_link":
        result = await getCandidateProfileLink(String(args.id));
        break;
      case "get_internal_grounding_context":
        result = await getInternalGroundingContext(String(args.candidate_id));
        break;
      case "ingest_nova_profile":
        result = await ingestNovaProfile({
          candidateProfile:
            args.candidate_profile && typeof args.candidate_profile === "object"
              ? (args.candidate_profile as Record<string, unknown>)
              : null,
          payloadJson: typeof args.payload_json === "string" ? args.payload_json : null,
        });
        break;
      case "update_candidate_status":
        result = await updateCandidateStatus(
          String(args.candidate_id),
          String(args.new_status),
        );
        break;
      case "update_candidate_profession":
        result = await updateCandidateProfession({
          candidateInput: String(args.candidate_id),
          professionInput: Object.prototype.hasOwnProperty.call(args, "profession")
            ? (args.profession as unknown)
            : undefined,
          specialtyInput: Object.prototype.hasOwnProperty.call(args, "specialty")
            ? (args.specialty as unknown)
            : undefined,
        });
        break;
      case "update_candidate_name":
        result = await updateCandidateName({
          candidateInput: String(args.candidate_id),
          firstNameInput: Object.prototype.hasOwnProperty.call(args, "first_name")
            ? (args.first_name as unknown)
            : undefined,
          lastNameInput: Object.prototype.hasOwnProperty.call(args, "last_name")
            ? (args.last_name as unknown)
            : undefined,
        });
        break;
      case "add_candidate_note":
        result = await addCandidateNote(
          String(args.candidate_id),
          String(args.content),
          args.note_type ? String(args.note_type) : undefined,
        );
        break;
      case "create_com_draft_email":
        result = await createComDraftEmail({
          candidateId: String(args.candidate_id),
          subjectInput: String(args.subject),
          bodyInput: String(args.body),
          toEmailInput: args.to_email ? String(args.to_email) : undefined,
          ccInput: Array.isArray(args.cc) ? args.cc.map((value) => String(value)) : [],
          saveNoteTraceInput:
            typeof args.save_note_trace === "boolean" ? Boolean(args.save_note_trace) : true,
        });
        break;
      default:
        return { result: null, error: `Unknown tool: ${toolName}` };
    }

    const latency = Date.now() - start;
    console.log(`[db_tool] ${toolName} ok latency=${latency}ms args=${JSON.stringify(args)}`);
    return { result };
  } catch (err) {
    const latency = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[db_tool] ${toolName} FAILED latency=${latency}ms error=${msg}`);

    // Classify into structured error codes
    let error_code: ToolResultError["error_code"] = "TOOL_EXECUTION_FAILED";
    let retryable = false;
    if (/CANDIDATE_NOT_FOUND/i.test(msg)) {
      error_code = "NOT_FOUND";
    } else if (/CANDIDATE_IDENTITY_AMBIGUOUS|AMBIGUOUS_MATCH/i.test(msg)) {
      error_code = "AMBIGUOUS_MATCH";
    } else if (/DEADLINE_EXCEEDED|timeout/i.test(msg)) {
      error_code = "TIMEOUT";
      retryable = true;
    } else if (/INVALID_UPDATE_PAYLOAD|VALIDATION/i.test(msg)) {
      error_code = "VALIDATION_ERROR";
    }
    return { result: null, error: msg, error_code, retryable };
  }
}

// ── Individual executors ────────────────────────────────────────

type CandidateIdentity = {
  id: string;
  nova_id: string | null;
  display_name: string;
};

type CandidateResolutionResult =
  | { ok: true; identity: CandidateIdentity }
  | ToolResultError;

async function resolveCandidateIdentity(candidateInput: string): Promise<CandidateResolutionResult> {
  const raw = String(candidateInput || "").trim();
  if (!raw) {
    return {
      ok: false,
      result: null,
      error_code: "NOT_FOUND",
      message: "candidate_id is required",
      retryable: false,
    };
  }

  const [rows] = await db.run({
    sql: `SELECT id, nova_id, first_name, last_name
          FROM hc_candidates
          WHERE id = @candidateInput
             OR CAST(nova_id AS STRING) = @candidateInput
          LIMIT 3`,
    params: { candidateInput: raw },
    types: { candidateInput: { type: "string" } },
  });

  if (rows.length === 0) {
    const mode = UUID_REGEX.test(raw) ? "uuid" : "nova_id";
    return {
      ok: false,
      result: null,
      error_code: "NOT_FOUND",
      message: `No candidate found for ${mode} ${raw}`,
      retryable: false,
    };
  }

  if (rows.length > 1) {
    const alternatives = rows.map((r: any) => {
      const j = r.toJSON();
      return {
        id: String(j.id),
        nova_id: j.nova_id != null ? String(j.nova_id) : null,
        name: [String(j.first_name || "").trim(), String(j.last_name || "").trim()].filter(Boolean).join(" "),
      };
    });
    return {
      ok: false,
      result: null,
      error_code: "AMBIGUOUS_MATCH",
      message: `Multiple candidates match "${raw}". Options: ${alternatives.map((a: { name: string; id: string }) => `${a.name} (${a.id})`).join(", ")}`,
      retryable: false,
      alternatives,
    };
  }

  const row = rows[0].toJSON();
  const firstName = String(row.first_name || "").trim();
  const lastName = String(row.last_name || "").trim();
  return {
    ok: true,
    identity: {
      id: String(row.id),
      nova_id: row.nova_id != null ? String(row.nova_id) : null,
      display_name: [firstName, lastName].filter(Boolean).join(" "),
    },
  };
}

// Thin wrapper: throws on failure (preserves existing caller API)
// Use resolveCandidateIdentity() directly for structured error handling
async function requireCandidateIdentity(candidateInput: string): Promise<CandidateIdentity> {
  const result = await resolveCandidateIdentity(candidateInput);
  if (!result.ok) {
    throw new Error(`${result.error_code}: ${result.message}`);
  }
  return result.identity;
}

async function getCandidateById(id: string): Promise<CandidateRecord | null> {
  const resolution = await resolveCandidateIdentity(id);
  if (!resolution.ok) {
    if (resolution.error_code === "NOT_FOUND") return null;
    // For AMBIGUOUS_MATCH, throw so executeDbTool catches it with the structured code
    throw new Error(`${resolution.error_code}: ${resolution.message}`);
  }

  const [rows] = await db.run({
    sql: `${CANDIDATE_SELECT} WHERE c.id = @candidateId`,
    params: { candidateId: resolution.identity.id },
    types: { candidateId: { type: "string" } },
  });

  if (rows.length === 0) return null;
  return mapCandidateRow(rows[0].toJSON());
}

async function listCandidatesByStatus(status: string, limit: number): Promise<{ candidates: CandidateRecord[]; count: number }> {
  // Map display status to DB values for the WHERE clause
  const statusMap: Record<string, string[]> = {
    "on assignment": ["active"],
    "starting soon": ["pending_start"],
    "completed": ["completed"],
    "wrapped up": ["completed"],
    "in pipeline": ["in_pipeline"],
    "cancelled": ["cancelled"],
  };
  const dbStatuses = statusMap[status.toLowerCase()] || [status.toLowerCase()];

  const [rows] = await db.run({
    sql: `${CANDIDATE_SELECT} WHERE LOWER(a.status) IN UNNEST(@statuses) ORDER BY c.last_name LIMIT @lim`,
    params: { statuses: dbStatuses, lim: limit },
    types: {
      statuses: { type: "array", child: { type: "string" } },
      lim: { type: "int64" },
    },
  });

  const candidates = rows.map((r: any) => mapCandidateRow(r.toJSON()));
  return { candidates, count: candidates.length };
}

async function listStaleProspects(input: {
  daysWithoutContact: number;
  limit: number;
}): Promise<{
  prospects: Array<
    CandidateRecord & {
      last_contact_at: string | null;
      days_since_contact: number | null;
      contact_source: "activity" | "note" | "none";
    }
  >;
  count: number;
  days_threshold: number;
  as_of: string;
  prospect_definition: string;
  contact_source_of_truth: string;
}> {
  const daysThreshold = Math.min(Math.max(Number(input.daysWithoutContact) || 30, 1), 365);
  const safeLimit = Math.min(Math.max(Number(input.limit) || MAX_RESULTS, 1), MAX_RESULTS);
  const cutoffDate = new Date(Date.now() - daysThreshold * 24 * 60 * 60 * 1000);
  const asOf = new Date().toISOString();

  const [rows] = await db.run({
    sql: `WITH last_sent_activity AS (
            SELECT candidate_id, MAX(created_at) AS last_sent_activity_at
            FROM activities
            WHERE direction = 'outbound'
              AND (
                LOWER(activity_type) IN ('com_sent_email', 'email_sent')
                OR LOWER(JSON_VALUE(metadata, '$.state')) = 'sent'
              )
            GROUP BY candidate_id
          ),
          last_contact_note AS (
            SELECT candidate_id, MAX(created_at) AS last_contact_note_at
            FROM hc_notes
            WHERE note_type = 'follow_up'
            GROUP BY candidate_id
          )
          SELECT
            c.id,
            c.nova_id,
            c.first_name,
            c.last_name,
            c.specialty,
            c.profession,
            c.home_state,
            c.compliance_risk_level,
            c.source,
            a.status AS assignment_status,
            a.start_date,
            a.end_date,
            c.last_name AS sort_last_name,
            act.last_sent_activity_at,
            nt.last_contact_note_at
          FROM hc_candidates c
          LEFT JOIN hc_assignments a
            ON a.id = (
              SELECT a1.id
              FROM hc_assignments a1
              WHERE a1.candidate_id = c.id
              ORDER BY
                CASE
                  WHEN LOWER(a1.status) IN ('in_pipeline') THEN 0
                  WHEN LOWER(a1.status) IN ('active', 'pending_start') THEN 1
                  WHEN LOWER(a1.status) IN ('completed', 'cancelled') THEN 2
                  ELSE 3
                END,
                COALESCE(a1.end_date, '9999-12-31') DESC,
                COALESCE(a1.start_date, '0001-01-01') DESC,
                a1.id DESC
              LIMIT 1
            )
          LEFT JOIN last_sent_activity act
            ON act.candidate_id = c.id
          LEFT JOIN last_contact_note nt
            ON nt.candidate_id = c.id
          WHERE LOWER(COALESCE(a.status, '')) = 'in_pipeline'
          ORDER BY c.last_name
          LIMIT @lim`,
    params: { lim: safeLimit * 5 },
    types: {
      lim: { type: "int64" },
    },
  });

  const prospects = rows
    .map((r: any) => r.toJSON() as Record<string, unknown>)
    .map((row: any) => {
      const candidate = mapCandidateRow(row);
      const lastActivityAt = row.last_sent_activity_at ? new Date(String(row.last_sent_activity_at)) : null;
      const lastNoteAt = row.last_contact_note_at ? new Date(String(row.last_contact_note_at)) : null;

      let lastContact: Date | null = null;
      let contactSource: "activity" | "note" | "none" = "none";
      if (lastActivityAt && lastNoteAt) {
        if (lastActivityAt >= lastNoteAt) {
          lastContact = lastActivityAt;
          contactSource = "activity";
        } else {
          lastContact = lastNoteAt;
          contactSource = "note";
        }
      } else if (lastActivityAt) {
        lastContact = lastActivityAt;
        contactSource = "activity";
      } else if (lastNoteAt) {
        lastContact = lastNoteAt;
        contactSource = "note";
      }

      const daysSinceContact = lastContact
        ? Math.floor((Date.now() - lastContact.getTime()) / (24 * 60 * 60 * 1000))
        : null;

      return {
        ...candidate,
        last_contact_at: lastContact ? lastContact.toISOString() : null,
        days_since_contact: daysSinceContact,
        contact_source: contactSource,
      };
    })
    .filter((candidate: any) => {
      if (!candidate.last_contact_at) return true;
      const date = new Date(candidate.last_contact_at);
      return date.getTime() <= cutoffDate.getTime();
    })
    .slice(0, safeLimit);

  return {
    prospects,
    count: prospects.length,
    days_threshold: daysThreshold,
    as_of: asOf,
    prospect_definition: "latest_assignment_status=in_pipeline",
    contact_source_of_truth:
      "latest outbound sent activity (activities.state=sent/com_sent_email) OR latest follow_up note",
  };
}

async function searchCandidates(
  query: string,
  specialty?: string,
  state?: string,
  limit?: number,
): Promise<{ candidates: CandidateRecord[]; count: number }> {
  const safeLimit = Math.min(limit || MAX_RESULTS, MAX_RESULTS);
  const namePattern = `%${query}%`;

  let sql = `${CANDIDATE_SELECT} WHERE (LOWER(c.first_name) LIKE LOWER(@namePattern) OR LOWER(c.last_name) LIKE LOWER(@namePattern))`;
  const params: Record<string, unknown> = { namePattern };
  const types: Record<string, { type: string }> = { namePattern: { type: "string" } };

  if (specialty) {
    sql += ` AND LOWER(c.specialty) LIKE LOWER(@specPattern)`;
    params.specPattern = `%${specialty}%`;
    types.specPattern = { type: "string" };
  }

  if (state) {
    sql += ` AND LOWER(c.home_state) = LOWER(@stateFilter)`;
    params.stateFilter = state;
    types.stateFilter = { type: "string" };
  }

  sql += ` ORDER BY c.last_name LIMIT @lim`;
  params.lim = safeLimit;
  types.lim = { type: "int64" };

  const [rows] = await db.run({ sql, params, types });
  const candidates = rows.map((r: any) => mapCandidateRow(r.toJSON()));
  return { candidates, count: candidates.length };
}

async function getCandidateProfileLink(id: string): Promise<{ id: string; nova_id: string | null; name: string; novaUrl: string | null } | null> {
  let identity: CandidateIdentity;
  try {
    identity = await requireCandidateIdentity(id);
  } catch (error) {
    if (error instanceof Error && /NOT_FOUND/i.test(error.message)) {
      return null;
    }
    throw error;
  }

  const [rows] = await db.run({
    sql: `SELECT c.id, c.nova_id, c.first_name, c.last_name FROM hc_candidates c WHERE c.id = @candidateId`,
    params: { candidateId: identity.id },
    types: { candidateId: { type: "string" } },
  });

  if (rows.length === 0) return null;
  const row = rows[0].toJSON();
  const name = [String(row.first_name || "").trim(), String(row.last_name || "").trim()].filter(Boolean).join(" ");
  const novaId = row.nova_id ? String(row.nova_id) : null;
  const novaUrl = novaId ? `https://nova.ayahealthcare.com/#/recruiting/candidates/${novaId}/new-profile/about` : null;
  return { id: String(row.id), nova_id: novaId, name, novaUrl };
}

type InternalReference = {
  ref_id: string;
  label: string;
  source_table: string;
  source_key: string;
  fields: string[];
  uri: string | null;
};

async function getInternalGroundingContext(candidateInput: string): Promise<{
  object_type: "internal_grounding_context";
  candidate_id: string;
  nova_id: string | null;
  snapshot_timestamp: string;
  candidate: Record<string, unknown>;
  assignment: Record<string, unknown> | null;
  submittal: Record<string, unknown> | null;
  facility: Record<string, unknown> | null;
  job_order: Record<string, unknown> | null;
  references: InternalReference[];
}> {
  const snapshotTimestamp = new Date().toISOString();
  const identity = await requireCandidateIdentity(candidateInput);
  const candidateId = identity.id;

  const [candidateRows] = await db.run({
    sql: `SELECT id, nova_id, first_name, last_name, email, profession, specialty, home_state, compliance_risk_level, source
          FROM hc_candidates
          WHERE id = @candidateId
          LIMIT 1`,
    params: { candidateId },
    types: { candidateId: { type: "string" } },
  });
  if (candidateRows.length === 0) {
    throw new Error(`No candidate found for candidate_id ${candidateId}`);
  }

  const candidate = candidateRows[0].toJSON();
  const novaId = candidate.nova_id ? String(candidate.nova_id) : null;
  const candidateUri = novaId
    ? `https://nova.ayahealthcare.com/#/recruiting/candidates/${novaId}/new-profile/about`
    : null;

  const [assignmentRows] = await db.run({
    sql: `SELECT id, candidate_id, facility_id, job_id, status, start_date, end_date, weekly_gross, hourly_rate, stipend_weekly
          FROM hc_assignments
          WHERE candidate_id = @candidateId
          ORDER BY
            CASE
              WHEN LOWER(status) = 'pending_start'
                AND SAFE_CAST(start_date AS DATE) IS NOT NULL
                AND SAFE_CAST(start_date AS DATE) >= CURRENT_DATE() THEN 0
              WHEN LOWER(status) = 'active' THEN 1
              WHEN LOWER(status) = 'in_pipeline' THEN 2
              WHEN LOWER(status) = 'pending_start' THEN 3
              WHEN LOWER(status) IN ('completed', 'cancelled') THEN 4
              ELSE 5
            END,
            CASE
              WHEN LOWER(status) = 'pending_start'
                AND SAFE_CAST(start_date AS DATE) IS NOT NULL
                AND SAFE_CAST(start_date AS DATE) >= CURRENT_DATE()
                THEN SAFE_CAST(start_date AS DATE)
              WHEN LOWER(status) = 'active'
                THEN COALESCE(SAFE_CAST(end_date AS DATE), DATE '9999-12-31')
              WHEN LOWER(status) = 'in_pipeline'
                THEN COALESCE(SAFE_CAST(start_date AS DATE), DATE '9999-12-31')
              ELSE COALESCE(SAFE_CAST(start_date AS DATE), DATE '0001-01-01')
            END ASC,
            COALESCE(SAFE_CAST(start_date AS DATE), DATE '0001-01-01') DESC
          LIMIT 1`,
    params: { candidateId },
    types: { candidateId: { type: "string" } },
  });
  const assignment = assignmentRows.length > 0 ? assignmentRows[0].toJSON() : null;

  const [submittalRows] = await db.run({
    sql: `SELECT id, candidate_id, facility_id, job_id, status, submitted_at, interview_date, offer_date, created_at
          FROM hc_submittals
          WHERE candidate_id = @candidateId
          ORDER BY submitted_at DESC, created_at DESC
          LIMIT 1`,
    params: { candidateId },
    types: { candidateId: { type: "string" } },
  });
  const submittal = submittalRows.length > 0 ? submittalRows[0].toJSON() : null;

  const facilityId =
    assignment?.facility_id ? String(assignment.facility_id) :
    submittal?.facility_id ? String(submittal.facility_id) :
    null;

  let facility: Record<string, unknown> | null = null;
  if (facilityId) {
    const [facilityRows] = await db.run({
      sql: `SELECT id, name, city, state, vms_platform, msp_provider, emr, beds, is_teaching, trauma_level, accepts_locals, requires_compact
            FROM hc_facilities
            WHERE id = @facilityId
            LIMIT 1`,
      params: { facilityId },
      types: { facilityId: { type: "string" } },
    });
    facility = facilityRows.length > 0 ? (facilityRows[0].toJSON() as Record<string, unknown>) : null;
  }

  const jobId =
    assignment?.job_id ? String(assignment.job_id) :
    submittal?.job_id ? String(submittal.job_id) :
    null;

  let jobOrder: Record<string, unknown> | null = null;
  if (jobId) {
    const [jobRows] = await db.run({
      sql: `SELECT job_order_id, title, profession, specialty, description, requirements, city, state, employment_type, shift, status, notes
            FROM job_orders
            WHERE job_order_id = @jobId
            LIMIT 1`,
      params: { jobId },
      types: { jobId: { type: "string" } },
    });
    jobOrder = jobRows.length > 0 ? (jobRows[0].toJSON() as Record<string, unknown>) : null;
  }

  const references: InternalReference[] = [];
  const pushRef = (label: string, sourceTable: string, sourceKey: string, fields: string[], uri: string | null = null) => {
    references.push({
      ref_id: `INT-${references.length + 1}`,
      label,
      source_table: sourceTable,
      source_key: sourceKey,
      fields,
      uri,
    });
  };

  pushRef(
    "Candidate master record",
    "hc_candidates",
    String(candidate.id),
    ["id", "profession", "specialty", "home_state", "compliance_risk_level", "source"],
    candidateUri,
  );

  if (assignment) {
    pushRef(
      "Latest assignment record",
      "hc_assignments",
      String(assignment.id),
      ["status", "start_date", "end_date", "weekly_gross", "hourly_rate", "facility_id", "job_id"],
    );
  }

  if (submittal) {
    pushRef(
      "Latest submittal record",
      "hc_submittals",
      String(submittal.id),
      ["status", "submitted_at", "interview_date", "offer_date", "facility_id", "job_id"],
    );
  }

  if (facility) {
    pushRef(
      "Facility policy/rule profile",
      "hc_facilities",
      String(facility.id || facilityId),
      ["vms_platform", "msp_provider", "emr", "accepts_locals", "requires_compact", "trauma_level"],
    );
  }

  if (jobOrder) {
    pushRef(
      "Job order instruction profile",
      "job_orders",
      String(jobOrder.job_order_id || jobId),
      ["title", "profession", "specialty", "requirements", "employment_type", "shift", "status", "notes"],
    );
  }

  return {
    object_type: "internal_grounding_context",
    candidate_id: String(candidate.id),
    nova_id: novaId,
    snapshot_timestamp: snapshotTimestamp,
    candidate: {
      id: String(candidate.id),
      nova_id: novaId,
      name: [String(candidate.first_name || "").trim(), String(candidate.last_name || "").trim()].filter(Boolean).join(" "),
      profession: candidate.profession ? String(candidate.profession) : null,
      specialty: candidate.specialty ? String(candidate.specialty) : null,
      home_state: candidate.home_state ? String(candidate.home_state) : null,
      compliance_risk_level: candidate.compliance_risk_level ? String(candidate.compliance_risk_level) : null,
      source: candidate.source ? String(candidate.source) : null,
      profile_url: candidateUri,
    },
    assignment: assignment
      ? {
          id: String(assignment.id),
          status: assignment.status ? String(assignment.status) : null,
          start_date: assignment.start_date ? String(assignment.start_date) : null,
          end_date: assignment.end_date ? String(assignment.end_date) : null,
          weekly_gross: assignment.weekly_gross != null ? Number(assignment.weekly_gross) : null,
          hourly_rate: assignment.hourly_rate != null ? Number(assignment.hourly_rate) : null,
          stipend_weekly: assignment.stipend_weekly != null ? Number(assignment.stipend_weekly) : null,
          facility_id: assignment.facility_id ? String(assignment.facility_id) : null,
          job_id: assignment.job_id ? String(assignment.job_id) : null,
        }
      : null,
    submittal: submittal
      ? {
          id: String(submittal.id),
          status: submittal.status ? String(submittal.status) : null,
          submitted_at: submittal.submitted_at ? String(submittal.submitted_at) : null,
          interview_date: submittal.interview_date ? String(submittal.interview_date) : null,
          offer_date: submittal.offer_date ? String(submittal.offer_date) : null,
          facility_id: submittal.facility_id ? String(submittal.facility_id) : null,
          job_id: submittal.job_id ? String(submittal.job_id) : null,
        }
      : null,
    facility: facility
      ? {
          id: facility.id ? String(facility.id) : facilityId,
          name: facility.name ? String(facility.name) : null,
          city: facility.city ? String(facility.city) : null,
          state: facility.state ? String(facility.state) : null,
          vms_platform: facility.vms_platform ? String(facility.vms_platform) : null,
          msp_provider: facility.msp_provider ? String(facility.msp_provider) : null,
          emr: facility.emr ? String(facility.emr) : null,
          beds: facility.beds != null ? Number(facility.beds) : null,
          is_teaching: facility.is_teaching != null ? Boolean(facility.is_teaching) : null,
          trauma_level: facility.trauma_level ? String(facility.trauma_level) : null,
          accepts_locals: facility.accepts_locals != null ? Boolean(facility.accepts_locals) : null,
          requires_compact: facility.requires_compact != null ? Boolean(facility.requires_compact) : null,
        }
      : null,
    job_order: jobOrder
      ? {
          id: jobOrder.job_order_id ? String(jobOrder.job_order_id) : jobId,
          title: jobOrder.title ? String(jobOrder.title) : null,
          profession: jobOrder.profession ? String(jobOrder.profession) : null,
          specialty: jobOrder.specialty ? String(jobOrder.specialty) : null,
          description: jobOrder.description ? String(jobOrder.description) : null,
          requirements: jobOrder.requirements ?? null,
          city: jobOrder.city ? String(jobOrder.city) : null,
          state: jobOrder.state ? String(jobOrder.state) : null,
          employment_type: jobOrder.employment_type ? String(jobOrder.employment_type) : null,
          shift: jobOrder.shift ? String(jobOrder.shift) : null,
          status: jobOrder.status ? String(jobOrder.status) : null,
          notes: jobOrder.notes ? String(jobOrder.notes) : null,
        }
      : null,
    references,
  };
}

function normalizeNoteType(raw?: string): string {
  const value = String(raw || "prep_note").toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (!NOTE_TYPE_ALLOWED.includes(value)) {
    throw new Error(
      `Unsupported note_type "${raw}". Allowed: ${NOTE_TYPE_ALLOWED.join(", ")}`
    );
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, maxLen: number): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLen);
}

function splitDisplayName(raw: string | null): { firstName: string | null; lastName: string | null } {
  const value = String(raw || "").trim();
  if (!value) return { firstName: null, lastName: null };
  const parts = value.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0].slice(0, 100), lastName: null };
  return {
    firstName: parts[0].slice(0, 100),
    lastName: parts.slice(1).join(" ").slice(0, 100),
  };
}

function extractNovaIdFromProfileUrl(profileUrl: string | null): string | null {
  const value = String(profileUrl || "").trim();
  if (!value) return null;
  const match = value.match(/\/candidates\/([0-9]+)/i);
  if (!match) return null;
  return match[1].slice(0, 20);
}

function resolveProfilePayload(input: {
  candidateProfile: Record<string, unknown> | null;
  payloadJson: string | null;
}): Record<string, unknown> {
  if (input.candidateProfile) return input.candidateProfile;
  if (input.payloadJson) {
    try {
      const parsed = JSON.parse(input.payloadJson);
      const payload = asRecord(parsed);
      if (payload) return payload;
    } catch (error) {
      throw new Error(
        `ingest_nova_profile payload_json must be valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  throw new Error("ingest_nova_profile requires candidate_profile object or payload_json");
}

async function resolveCandidateIdentityOptional(candidateInput: string | null): Promise<CandidateIdentity | null> {
  if (!candidateInput) return null;
  const result = await resolveCandidateIdentity(candidateInput);
  if (!result.ok) {
    if (result.error_code === "NOT_FOUND") return null;
    throw new Error(`${result.error_code}: ${result.message}`);
  }
  return result.identity;
}

async function ingestNovaProfile(input: {
  candidateProfile: Record<string, unknown> | null;
  payloadJson: string | null;
}): Promise<{
  object_type: "candidate_profile";
  candidate_id: string;
  nova_id: string | null;
  action: "ingest_nova_profile";
  write_timestamp: string;
  rows_updated: number;
  outcome: "inserted" | "updated";
  profile_url: string | null;
  candidate: {
    display_name: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    specialty: string | null;
    profession: string | null;
    home_state: string | null;
    source: string | null;
  };
}> {
  const payload = resolveProfilePayload(input);
  const sourceValue = asString(payload.source, 50)?.toLowerCase() || "";
  if (sourceValue && !sourceValue.includes("nova")) {
    throw new Error("ingest_nova_profile expects source='nova_candidate_profile' payloads");
  }

  const rawCandidateId = asString(payload.candidate_id, 64);
  const payloadNovaId = asString(payload.nova_id, 20);
  const profileUrl = asString(payload.profile_url, 2048);
  const uuidInput = rawCandidateId && UUID_REGEX.test(rawCandidateId) ? rawCandidateId : null;
  const parsedNovaIdFromCandidateId =
    rawCandidateId && !UUID_REGEX.test(rawCandidateId) ? rawCandidateId.replace(/[^0-9A-Za-z_-]/g, "").slice(0, 20) : null;
  const novaId =
    payloadNovaId ||
    parsedNovaIdFromCandidateId ||
    extractNovaIdFromProfileUrl(profileUrl);

  if (!uuidInput && !novaId) {
    throw new Error("ingest_nova_profile requires candidate_id or nova_id");
  }

  const displayNameRaw = asString(payload.display_name, 250) || asString(payload.legal_name, 250);
  const displayNameParts = splitDisplayName(displayNameRaw);
  const firstName = asString(payload.first_name, 100) || displayNameParts.firstName;
  const lastName = asString(payload.last_name, 100) || displayNameParts.lastName;

  const contact = asRecord(payload.contact);
  const address = asRecord(contact?.address);
  const specialtyExperience = Array.isArray(payload.specialty_experience)
    ? payload.specialty_experience.map((entry) => asRecord(entry)).find((entry) => Boolean(entry)) || null
    : null;

  const email = asString(contact?.email, 200) || asString(payload.email, 200);
  const phone = asString(contact?.primary_phone, 20) || asString(payload.phone, 20);
  const specialty =
    asString(specialtyExperience?.specialty, 100) ||
    asString(payload.specialty_title, 100) ||
    asString(payload.specialty, 100);
  const profession = asString(payload.profession, 10);
  const homeState =
    normalizeUSHomeState(payload.home_state) ||
    normalizeUSHomeState(address?.current) ||
    normalizeUSHomeState(address?.home);
  const source = "nova";

  let existingIdentity = await resolveCandidateIdentityOptional(uuidInput);
  if (!existingIdentity) {
    existingIdentity = await resolveCandidateIdentityOptional(novaId);
  }

  const candidateId = existingIdentity?.id || randomUUID();
  const writeDate = new Date();
  const writeTimestamp = writeDate.toISOString();
  let rowsUpdated = 0;

  await db.runTransactionAsync(async (tx: any) => {
    if (existingIdentity) {
      const [count] = await tx.runUpdate({
        sql: `UPDATE hc_candidates
              SET nova_id = COALESCE(@novaId, nova_id),
                  first_name = COALESCE(@firstName, first_name),
                  last_name = COALESCE(@lastName, last_name),
                  email = COALESCE(@email, email),
                  phone = COALESCE(@phone, phone),
                  specialty = COALESCE(@specialty, specialty),
                  profession = COALESCE(@profession, profession),
                  home_state = COALESCE(@homeState, home_state),
                  source = COALESCE(@source, source),
                  updated_at = @updatedAt
              WHERE id = @candidateId`,
        params: {
          candidateId,
          novaId,
          firstName,
          lastName,
          email,
          phone,
          specialty,
          profession,
          homeState,
          source,
          updatedAt: writeDate,
        },
        types: {
          candidateId: { type: "string" },
          novaId: { type: "string" },
          firstName: { type: "string" },
          lastName: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          specialty: { type: "string" },
          profession: { type: "string" },
          homeState: { type: "string" },
          source: { type: "string" },
          updatedAt: { type: "timestamp" },
        },
      });
      rowsUpdated = Number(count);
    } else {
      const [count] = await tx.runUpdate({
        sql: `INSERT INTO hc_candidates (
                id, nova_id, first_name, last_name, email, phone, specialty, profession, home_state, source, created_at, updated_at
              ) VALUES (
                @candidateId, @novaId, @firstName, @lastName, @email, @phone, @specialty, @profession, @homeState, @source, @createdAt, @updatedAt
              )`,
        params: {
          candidateId,
          novaId,
          firstName,
          lastName,
          email,
          phone,
          specialty,
          profession,
          homeState,
          source,
          createdAt: writeDate,
          updatedAt: writeDate,
        },
        types: {
          candidateId: { type: "string" },
          novaId: { type: "string" },
          firstName: { type: "string" },
          lastName: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          specialty: { type: "string" },
          profession: { type: "string" },
          homeState: { type: "string" },
          source: { type: "string" },
          createdAt: { type: "timestamp" },
          updatedAt: { type: "timestamp" },
        },
      });
      rowsUpdated = Number(count);
    }
    await tx.commit();
  });

  if (rowsUpdated < 1) {
    throw new Error("ingest_nova_profile completed with zero affected rows");
  }

  const [rows] = await db.run({
    sql: `SELECT id, nova_id, first_name, last_name, email, phone, specialty, profession, home_state, source
          FROM hc_candidates
          WHERE id = @candidateId
          LIMIT 1`,
    params: { candidateId },
    types: { candidateId: { type: "string" } },
  });

  if (rows.length === 0) {
    throw new Error(`Candidate ingest not visible after commit for id ${candidateId}`);
  }

  const row = rows[0].toJSON();
  const resolvedFirstName = row.first_name ? String(row.first_name) : null;
  const resolvedLastName = row.last_name ? String(row.last_name) : null;
  const resolvedDisplayName = [resolvedFirstName, resolvedLastName].filter(Boolean).join(" ").trim();

  return {
    object_type: "candidate_profile",
    candidate_id: String(row.id || candidateId),
    nova_id: row.nova_id ? String(row.nova_id) : null,
    action: "ingest_nova_profile",
    write_timestamp: writeTimestamp,
    rows_updated: rowsUpdated,
    outcome: existingIdentity ? "updated" : "inserted",
    profile_url:
      profileUrl ||
      (row.nova_id
        ? `https://nova.ayahealthcare.com/#/recruiting/candidates/${String(row.nova_id)}/new-profile/about`
        : null),
    candidate: {
      display_name: resolvedDisplayName || displayNameRaw || "Unknown Candidate",
      first_name: resolvedFirstName,
      last_name: resolvedLastName,
      email: row.email ? String(row.email) : null,
      phone: row.phone ? String(row.phone) : null,
      specialty: row.specialty ? String(row.specialty) : null,
      profession: row.profession ? String(row.profession) : null,
      home_state: row.home_state ? String(row.home_state) : null,
      source: row.source ? String(row.source) : null,
    },
  };
}

function sanitizeNoteContent(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) throw new Error("Note content is required");
  if (value.length > 2000) {
    throw new Error("Note content too long (max 2000 chars)");
  }
  return value;
}

async function getCandidateContact(
  candidateInput: string,
): Promise<{ id: string; nova_id: string | null; email: string | null; firstName: string; lastName: string }> {
  const identity = await requireCandidateIdentity(candidateInput);
  const [rows] = await db.run({
    sql: `SELECT id, email, first_name, last_name
          FROM hc_candidates
          WHERE id = @candidateId
          LIMIT 1`,
    params: { candidateId: identity.id },
    types: { candidateId: { type: "string" } },
  });
  if (rows.length === 0) {
    throw new Error(`${CANDIDATE_NOT_FOUND_CODE}: No candidate found for candidate_id ${candidateInput}`);
  }
  const row = rows[0].toJSON();
  return {
    id: identity.id,
    nova_id: identity.nova_id,
    email: row.email ? String(row.email).trim() : null,
    firstName: String(row.first_name || "").trim(),
    lastName: String(row.last_name || "").trim(),
  };
}

function sanitizeEmail(input: string | undefined, label: string): string {
  const value = String(input || "").trim().toLowerCase();
  if (!value) {
    throw new Error(`${label} is required`);
  }
  if (!EMAIL_REGEX.test(value)) {
    throw new Error(`Invalid email format for ${label}: ${input}`);
  }
  return value;
}

function sanitizeSubject(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) throw new Error("Draft subject is required");
  if (value.length > 500) throw new Error("Draft subject too long (max 500 chars)");
  return value;
}

function sanitizeDraftBody(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) throw new Error("Draft body is required");
  if (value.length > 20000) throw new Error("Draft body too long (max 20000 chars)");
  return value;
}

function sanitizeCc(rawCc: string[]): string[] {
  const cc = Array.isArray(rawCc) ? rawCc : [];
  if (cc.length > 20) throw new Error("CC list too large (max 20)");
  return cc.map((email, index) => sanitizeEmail(email, `cc[${index}]`));
}

async function addCandidateNote(
  candidateInput: string,
  contentInput: string,
  noteTypeInput?: string,
): Promise<{
  object_type: "candidate_note";
  candidate_id: string;
  nova_id: string | null;
  action: "add_candidate_note";
  write_timestamp: string;
  rows_updated: number;
  changed_fields: {
    content: { from: null; to: string };
    note_type: { from: null; to: string };
  };
  note: {
    id: string;
    note_type: string;
    content: string;
    created_at: string;
  };
  outcome: "inserted";
}> {
  const content = sanitizeNoteContent(contentInput);
  const noteType = normalizeNoteType(noteTypeInput);
  const identity = await requireCandidateIdentity(candidateInput);
  const candidateId = identity.id;

  const noteId = randomUUID();
  const writeTimestamp = new Date().toISOString();
  const writeDate = new Date(writeTimestamp);

  let rowsUpdated = 0;
  await db.runTransactionAsync(async (tx: any) => {
    const [count] = await tx.runUpdate({
      sql: `INSERT INTO hc_notes (
              id, candidate_id, content, note_type, created_at, updated_at
            ) VALUES (
              @id, @candidateId, @content, @noteType, @createdAt, @updatedAt
            )`,
      params: {
        id: noteId,
        candidateId,
        content,
        noteType,
        createdAt: writeDate,
        updatedAt: writeDate,
      },
      types: {
        id: { type: "string" },
        candidateId: { type: "string" },
        content: { type: "string" },
        noteType: { type: "string" },
        createdAt: { type: "timestamp" },
        updatedAt: { type: "timestamp" },
      },
    });
    rowsUpdated = Number(count);
    await tx.commit();
  });

  if (rowsUpdated < 1) {
    throw new Error(`No note row inserted for candidate ${candidateId}`);
  }

  const [rows] = await db.run({
    sql: `SELECT id, candidate_id, content, note_type, created_at
          FROM hc_notes
          WHERE id = @noteId
          LIMIT 1`,
    params: { noteId },
    types: { noteId: { type: "string" } },
  });

  if (rows.length === 0) {
    throw new Error(`Note insert not visible after commit for id ${noteId}`);
  }

  const inserted = rows[0].toJSON();
  return {
    object_type: "candidate_note",
    candidate_id: String(inserted.candidate_id || candidateId),
    nova_id: identity.nova_id,
    action: "add_candidate_note",
    write_timestamp: writeTimestamp,
    rows_updated: rowsUpdated,
    changed_fields: {
      content: { from: null, to: content },
      note_type: { from: null, to: noteType },
    },
    note: {
      id: String(inserted.id || noteId),
      note_type: String(inserted.note_type || noteType),
      content: String(inserted.content || content),
      created_at: String(inserted.created_at || writeTimestamp),
    },
    outcome: "inserted",
  };
}

async function createComDraftEmail(input: {
  candidateId: string;
  subjectInput: string;
  bodyInput: string;
  toEmailInput?: string;
  ccInput: string[];
  saveNoteTraceInput: boolean;
}): Promise<{
  object_type: "com_draft_email";
  candidate_id: string;
  nova_id: string | null;
  action: "create_com_draft_email";
  write_timestamp: string;
  rows_updated: number;
  changed_fields: {
    subject: { from: null; to: string };
    body: { from: null; to: string };
    to_email: { from: null; to: string };
    cc: { from: string[]; to: string[] };
    save_note_trace: { from: null; to: boolean };
  };
  outcome: "inserted";
  draft_id: string;
  subject: string;
  to_email: string;
  cc: string[];
  note_trace: { created: boolean; note_id: string | null };
}> {
  const candidate = await getCandidateContact(input.candidateId);
  const subject = sanitizeSubject(input.subjectInput);
  const body = sanitizeDraftBody(input.bodyInput);
  const explicitToEmail = String(input.toEmailInput || "").trim();
  const resolvedToEmail = explicitToEmail || candidate.email || "";
  if (!resolvedToEmail) {
    throw new Error(
      `CANDIDATE_EMAIL_MISSING: Candidate ${candidate.id} has no email on record and to_email was not provided.`,
    );
  }
  const toEmail = sanitizeEmail(resolvedToEmail, "to_email");
  const cc = sanitizeCc(input.ccInput);
  const saveNoteTrace = Boolean(input.saveNoteTraceInput);

  const draftId = randomUUID();
  const writeTimestamp = new Date().toISOString();
  const metadataJson = JSON.stringify({
    to_email: toEmail,
    cc,
    channel: "email",
    state: "draft",
  });

  let draftRowsUpdated = 0;
  await db.runTransactionAsync(async (tx: any) => {
    const [count] = await tx.runUpdate({
      sql: `INSERT INTO activities (
              activity_id, candidate_id, activity_type, subject, body, direction, created_by, metadata, created_at
            ) VALUES (
              @activityId, @candidateId, @activityType, @subject, @body, @direction, @createdBy, PARSE_JSON(@metadataJson), PENDING_COMMIT_TIMESTAMP()
            )`,
      params: {
        activityId: draftId,
        candidateId: candidate.id,
        activityType: "com_draft_email",
        subject,
        body,
        direction: "outbound",
        createdBy: "ayaops_agent",
        metadataJson,
      },
      types: {
        activityId: { type: "string" },
        candidateId: { type: "string" },
        activityType: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        direction: { type: "string" },
        createdBy: { type: "string" },
        metadataJson: { type: "string" },
      },
    });
    draftRowsUpdated = Number(count);
    await tx.commit();
  });

  if (draftRowsUpdated < 1) {
    throw new Error(`No draft inserted for candidate ${candidate.id}`);
  }

  const [draftRows] = await db.run({
    sql: `SELECT activity_id
          FROM activities
          WHERE activity_id = @activityId
          LIMIT 1`,
    params: { activityId: draftId },
    types: { activityId: { type: "string" } },
  });
  if (draftRows.length === 0) {
    throw new Error(`Draft insert not visible after commit for id ${draftId}`);
  }

  let noteTrace: { created: boolean; note_id: string | null } = {
    created: false,
    note_id: null,
  };
  let totalRowsUpdated = draftRowsUpdated;
  if (saveNoteTrace) {
    const name = [candidate.firstName, candidate.lastName].filter(Boolean).join(" ").trim();
    const noteContent = [
      `Outreach draft created${name ? ` for ${name}` : ""}.`,
      `To: ${toEmail}`,
      `CC: ${cc.length > 0 ? cc.join(", ") : "none"}`,
      `Subject: ${subject}`,
      `Draft Created At: ${writeTimestamp}`,
      `Draft ID: ${draftId}`,
    ].join("\n");
    const noteResult = await addCandidateNote(candidate.id, noteContent, "prep_note");
    noteTrace = {
      created: true,
      note_id: noteResult.note.id,
    };
    totalRowsUpdated += noteResult.rows_updated;
  }

  return {
    object_type: "com_draft_email",
    candidate_id: candidate.id,
    nova_id: candidate.nova_id,
    action: "create_com_draft_email",
    write_timestamp: writeTimestamp,
    rows_updated: totalRowsUpdated,
    changed_fields: {
      subject: { from: null, to: subject },
      body: { from: null, to: body },
      to_email: { from: null, to: toEmail },
      cc: { from: [], to: cc },
      save_note_trace: { from: null, to: saveNoteTrace },
    },
    outcome: "inserted",
    draft_id: draftId,
    subject,
    to_email: toEmail,
    cc,
    note_trace: noteTrace,
  };
}

function normalizeStatusInput(raw: string): string {
  const value = String(raw || "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  const aliasMap: Record<string, string> = {
    on_assignment: "active",
    working: "active",
    start_soon: "pending_start",
    starting_soon: "pending_start",
    prestart: "pending_start",
    pre_start: "pending_start",
    done: "completed",
    wrapped_up: "completed",
    review: "in_pipeline",
    submitted: "in_pipeline",
    offer: "in_pipeline",
  };
  const canonical = aliasMap[value] || value;
  if (!WRITE_STATUS_ALLOWED.includes(canonical)) {
    throw new Error(
      `Unsupported status "${raw}". Allowed: ${WRITE_STATUS_ALLOWED.join(", ")}`
    );
  }
  return canonical;
}

async function updateCandidateStatus(
  candidateInput: string,
  newStatusInput: string,
): Promise<{
  object_type: "assignment_status";
  candidate_id: string;
  nova_id: string | null;
  candidate_name: string | null;
  action: "update_candidate_status";
  write_timestamp: string;
  rows_updated: number;
  changed_fields: { status: { from: string; to: string } };
  target_assignment: { start_date: string | null; end_date: string | null; facility_id: string | null };
  outcome: "updated" | "no_change";
}> {
  const newStatus = normalizeStatusInput(newStatusInput);
  const identity = await requireCandidateIdentity(candidateInput);
  const candidateId = identity.id;

  const [rows] = await db.run({
    sql: `SELECT candidate_id, status, start_date, end_date, facility_id
          FROM hc_assignments
          WHERE candidate_id = @candidateId
          ORDER BY
            CASE
              WHEN LOWER(status) = 'pending_start'
                AND SAFE_CAST(start_date AS DATE) IS NOT NULL
                AND SAFE_CAST(start_date AS DATE) >= CURRENT_DATE() THEN 0
              WHEN LOWER(status) = 'active' THEN 1
              WHEN LOWER(status) = 'in_pipeline' THEN 2
              WHEN LOWER(status) = 'pending_start' THEN 3
              WHEN LOWER(status) IN ('completed', 'cancelled') THEN 4
              ELSE 5
            END,
            CASE
              WHEN LOWER(status) = 'pending_start'
                AND SAFE_CAST(start_date AS DATE) IS NOT NULL
                AND SAFE_CAST(start_date AS DATE) >= CURRENT_DATE()
                THEN SAFE_CAST(start_date AS DATE)
              WHEN LOWER(status) = 'active'
                THEN COALESCE(SAFE_CAST(end_date AS DATE), DATE '9999-12-31')
              WHEN LOWER(status) = 'in_pipeline'
                THEN COALESCE(SAFE_CAST(start_date AS DATE), DATE '9999-12-31')
              ELSE COALESCE(SAFE_CAST(start_date AS DATE), DATE '0001-01-01')
            END ASC,
            COALESCE(SAFE_CAST(start_date AS DATE), DATE '0001-01-01') DESC
          LIMIT 1`,
    params: { candidateId },
    types: { candidateId: { type: "string" } },
  });

  if (rows.length === 0) {
    const writeTimestamp = new Date().toISOString();
    await db.runTransactionAsync(async (tx: any) => {
      await tx.runUpdate({
        sql: `INSERT INTO hc_assignments (id, candidate_id, status, created_at, updated_at) 
              VALUES (GENERATE_UUID(), @candidateId, @newStatus, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
        params: { candidateId, newStatus },
      });
      await tx.commit();
    });
    
    return {
      object_type: "assignment_status",
      candidate_id: candidateId,
      nova_id: identity.nova_id,
      candidate_name: identity.display_name || null,
      action: "update_candidate_status",
      write_timestamp: writeTimestamp,
      rows_updated: 1,
      changed_fields: { status: { from: "none", to: newStatus } },
      target_assignment: { start_date: null, end_date: null, facility_id: null },
      outcome: "updated",
    };
  }

  const row = rows[0].toJSON();
  const currentStatus = String(row.status || "").toLowerCase().trim();
  const startDate = row.start_date ? String(row.start_date) : null;
  const endDate = row.end_date ? String(row.end_date) : null;
  const facilityId = row.facility_id ? String(row.facility_id) : null;
  const writeTimestamp = new Date().toISOString();

  if (currentStatus === newStatus) {
    return {
      object_type: "assignment_status",
      candidate_id: candidateId,
      nova_id: identity.nova_id,
      candidate_name: identity.display_name || null,
      action: "update_candidate_status",
      write_timestamp: writeTimestamp,
      rows_updated: 0,
      changed_fields: { status: { from: currentStatus, to: newStatus } },
      target_assignment: {
        start_date: startDate,
        end_date: endDate,
        facility_id: facilityId,
      },
      outcome: "no_change",
    };
  }

  let updatedCount = 0;
  await db.runTransactionAsync(async (tx: any) => {
    const [count] = await tx.runUpdate({
      sql: `UPDATE hc_assignments
            SET status = @newStatus
            WHERE candidate_id = @candidateId
              AND status = @currentStatus
              AND (
                (@startDate IS NULL AND start_date IS NULL) OR start_date = @startDate
              )
              AND (
                (@endDate IS NULL AND end_date IS NULL) OR end_date = @endDate
              )`,
      params: {
        candidateId,
        currentStatus,
        newStatus,
        startDate,
        endDate,
      },
      types: {
        candidateId: { type: "string" },
        currentStatus: { type: "string" },
        newStatus: { type: "string" },
        startDate: { type: "string" },
        endDate: { type: "string" },
      },
    });
    updatedCount = Number(count);
    await tx.commit();
  });

  if (updatedCount < 1) {
    throw new Error(
      `No rows updated for candidate ${candidateId}. Assignment snapshot may be stale; please retry lookup.`
    );
  }

  return {
    object_type: "assignment_status",
    candidate_id: candidateId,
    nova_id: identity.nova_id,
    candidate_name: identity.display_name || null,
    action: "update_candidate_status",
    write_timestamp: writeTimestamp,
    rows_updated: Number(updatedCount),
    changed_fields: { status: { from: currentStatus, to: newStatus } },
    target_assignment: {
      start_date: startDate,
      end_date: endDate,
      facility_id: facilityId,
    },
    outcome: "updated",
  };
}

function normalizeOptionalUpdateField(
  input: unknown,
  fieldName: "profession" | "specialty",
): { provided: boolean; value: string | null } {
  if (input === undefined) return { provided: false, value: null };
  if (input === null) return { provided: true, value: null };

  const value = String(input).trim();
  if (!value) {
    throw new Error(`INVALID_UPDATE_PAYLOAD: ${fieldName} cannot be blank`);
  }
  if (value.length > 200) {
    throw new Error(`INVALID_UPDATE_PAYLOAD: ${fieldName} is too long (max 200 chars)`);
  }
  return { provided: true, value };
}

async function updateCandidateProfession(input: {
  candidateInput: string;
  professionInput: unknown;
  specialtyInput: unknown;
}): Promise<{
  object_type: "candidate_profession";
  candidate_id: string;
  nova_id: string | null;
  action: "update_candidate_profession";
  write_timestamp: string;
  rows_updated: number;
  changed_fields: {
    profession?: { from: string | null; to: string | null };
    specialty?: { from: string | null; to: string | null };
  };
  outcome: "updated" | "no_change";
}> {
  const profession = normalizeOptionalUpdateField(input.professionInput, "profession");
  const specialty = normalizeOptionalUpdateField(input.specialtyInput, "specialty");
  if (!profession.provided && !specialty.provided) {
    throw new Error(
      "INVALID_UPDATE_PAYLOAD: Provide at least one updatable field: profession or specialty",
    );
  }

  const identity = await requireCandidateIdentity(input.candidateInput);
  const candidateId = identity.id;

  const [rows] = await db.run({
    sql: `SELECT profession, specialty
          FROM hc_candidates
          WHERE id = @candidateId
          LIMIT 1`,
    params: { candidateId },
    types: { candidateId: { type: "string" } },
  });

  if (rows.length === 0) {
    throw new Error(`${CANDIDATE_NOT_FOUND_CODE}: No candidate found for candidate_id ${candidateId}`);
  }

  const row = rows[0].toJSON();
  const currentProfession = row.profession != null ? String(row.profession) : null;
  const currentSpecialty = row.specialty != null ? String(row.specialty) : null;

  const nextProfession = profession.provided ? profession.value : currentProfession;
  const nextSpecialty = specialty.provided ? specialty.value : currentSpecialty;

  const changedFields: {
    profession?: { from: string | null; to: string | null };
    specialty?: { from: string | null; to: string | null };
  } = {};

  if (profession.provided) {
    changedFields.profession = { from: currentProfession, to: nextProfession };
  }
  if (specialty.provided) {
    changedFields.specialty = { from: currentSpecialty, to: nextSpecialty };
  }

  const noChange =
    (!profession.provided || currentProfession === nextProfession) &&
    (!specialty.provided || currentSpecialty === nextSpecialty);
  const writeTimestamp = new Date().toISOString();

  if (noChange) {
    return {
      object_type: "candidate_profession",
      candidate_id: candidateId,
      nova_id: identity.nova_id,
      action: "update_candidate_profession",
      write_timestamp: writeTimestamp,
      rows_updated: 0,
      changed_fields: changedFields,
      outcome: "no_change",
    };
  }

  const setClauses: string[] = [];
  const params: Record<string, unknown> = {
    candidateId,
    updatedAt: new Date(writeTimestamp),
  };
  const types: Record<string, { type: string }> = {
    candidateId: { type: "string" },
    updatedAt: { type: "timestamp" },
  };

  if (profession.provided) {
    setClauses.push("profession = @profession");
    params.profession = nextProfession;
    types.profession = { type: "string" };
  }
  if (specialty.provided) {
    setClauses.push("specialty = @specialty");
    params.specialty = nextSpecialty;
    types.specialty = { type: "string" };
  }
  setClauses.push("updated_at = @updatedAt");

  let rowsUpdated = 0;
  await db.runTransactionAsync(async (tx: any) => {
    const [count] = await tx.runUpdate({
      sql: `UPDATE hc_candidates
            SET ${setClauses.join(", ")}
            WHERE id = @candidateId`,
      params,
      types,
    });
    rowsUpdated = Number(count);
    await tx.commit();
  });

  if (rowsUpdated < 1) {
    throw new Error(
      `No rows updated for candidate ${candidateId}. Candidate snapshot may be stale; please retry lookup.`,
    );
  }

  return {
    object_type: "candidate_profession",
    candidate_id: candidateId,
    nova_id: identity.nova_id,
    action: "update_candidate_profession",
    write_timestamp: writeTimestamp,
    rows_updated: rowsUpdated,
    changed_fields: changedFields,
    outcome: "updated",
  };
}

async function updateCandidateName(input: {
  candidateInput: string;
  firstNameInput: unknown;
  lastNameInput: unknown;
}): Promise<{
  object_type: "candidate_name";
  candidate_id: string;
  nova_id: string | null;
  action: "update_candidate_name";
  write_timestamp: string;
  rows_updated: number;
  changed_fields: {
    first_name?: { from: string | null; to: string | null };
    last_name?: { from: string | null; to: string | null };
  };
  outcome: "updated" | "no_change";
}> {
  const firstName = normalizeOptionalUpdateField(input.firstNameInput, "profession");
  const lastName = normalizeOptionalUpdateField(input.lastNameInput, "specialty"); // using same check
  if (!firstName.provided && !lastName.provided) {
    throw new Error("INVALID_UPDATE_PAYLOAD: Provide at least one updatable field: first_name or last_name");
  }

  const identity = await requireCandidateIdentity(input.candidateInput);
  const candidateId = identity.id;

  const [rows] = await db.run({
    sql: `SELECT first_name, last_name FROM hc_candidates WHERE id = @candidateId LIMIT 1`,
    params: { candidateId },
    types: { candidateId: { type: "string" } },
  });

  if (rows.length === 0) {
    throw new Error(`${CANDIDATE_NOT_FOUND_CODE}: No candidate found for candidate_id ${candidateId}`);
  }

  const row = rows[0].toJSON();
  const currentFirstName = row.first_name != null ? String(row.first_name) : null;
  const currentLastName = row.last_name != null ? String(row.last_name) : null;

  const nextFirstName = firstName.provided ? firstName.value : currentFirstName;
  const nextLastName = lastName.provided ? lastName.value : currentLastName;

  const changedFields: {
    first_name?: { from: string | null; to: string | null };
    last_name?: { from: string | null; to: string | null };
  } = {};

  if (firstName.provided) {
    changedFields.first_name = { from: currentFirstName, to: nextFirstName };
  }
  if (lastName.provided) {
    changedFields.last_name = { from: currentLastName, to: nextLastName };
  }

  const noChange =
    (!firstName.provided || currentFirstName === nextFirstName) &&
    (!lastName.provided || currentLastName === nextLastName);
  const writeTimestamp = new Date().toISOString();

  if (noChange) {
    return {
      object_type: "candidate_name",
      candidate_id: candidateId,
      nova_id: identity.nova_id,
      action: "update_candidate_name",
      write_timestamp: writeTimestamp,
      rows_updated: 0,
      changed_fields: changedFields,
      outcome: "no_change",
    };
  }

  const setClauses: string[] = [];
  const params: Record<string, unknown> = { candidateId, updatedAt: new Date(writeTimestamp) };
  const types: Record<string, { type: string }> = { candidateId: { type: "string" }, updatedAt: { type: "timestamp" } };

  if (firstName.provided) {
    setClauses.push("first_name = @firstName");
    params.firstName = nextFirstName;
    types.firstName = { type: "string" };
  }
  if (lastName.provided) {
    setClauses.push("last_name = @lastName");
    params.lastName = nextLastName;
    types.lastName = { type: "string" };
  }
  setClauses.push("updated_at = @updatedAt");

  let rowsUpdated = 0;
  await db.runTransactionAsync(async (tx: any) => {
    const [count] = await tx.runUpdate({
      sql: `UPDATE hc_candidates SET ${setClauses.join(", ")} WHERE id = @candidateId`,
      params,
      types,
    });
    rowsUpdated = Number(count);
    await tx.commit();
  });

  return {
    object_type: "candidate_name",
    candidate_id: candidateId,
    nova_id: identity.nova_id,
    action: "update_candidate_name",
    write_timestamp: writeTimestamp,
    rows_updated: rowsUpdated,
    changed_fields: changedFields,
    outcome: "updated",
  };
}

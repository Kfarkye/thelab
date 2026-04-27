// ── Candidate Resolver ───────────────────────────────────────────
// Wraps existing resolveCandidateIdentifier + loadCandidateSnapshotForIdentifier
// into the Hub response format with HATEOAS links.

import {
  resolveCandidateIdentifier,
  loadCandidateSnapshotForIdentifier,
  type CandidateSnapshot,
} from "@/lib/ayaops/candidate-grounding-hub";
import { getDb } from "@/lib/spanner-pool";
import { mapCandidateRow } from "@/lib/mappers/candidate";
import { buildCandidateLinks } from "./links";

export type HubResponse = {
  type: string;
  id?: string;
  status: string;
  summary: string;
  novaUrl?: string;
  data: Record<string, unknown> | null;
  links: Record<string, unknown>;
  alternatives?: Array<{
    name: string;
    id: string;
    nova_id: string | null;
    status: string | null;
    specialty: string | null;
    confidence: number;
  }>;
};

type CandidateCollectionResolveInput = {
  identifier: string;
  query: URLSearchParams;
  entityHint?: string;
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const STATUS_FILTER_MAP: Record<string, string[]> = {
  working: ["active"],
  active: ["active"],
  prestart: ["pending_start"],
  pending_start: ["pending_start"],
  pending: ["pending_start"],
  pipeline: ["in_pipeline"],
  submitted: ["in_pipeline"],
  in_pipeline: ["in_pipeline"],
  completed: ["completed"],
  wrapped: ["completed"],
  cancelled: ["cancelled"],
  canceled: ["cancelled"],
};
const STATUS_FILTER_KEYS = new Set(Object.keys(STATUS_FILTER_MAP));

function readString(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function toIsoTimestamp(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeStatusFilter(input: string): string[] {
  const normalized = input.trim().toLowerCase();
  return STATUS_FILTER_MAP[normalized] || [normalized];
}

function normalizeLimit(rawLimit: string): number {
  const parsed = Number(rawLimit || DEFAULT_LIMIT);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(parsed)));
}

function buildCollectionSummary(input: {
  count: number;
  specialty: string;
  profession: string;
  status: string;
  search: string;
}): string {
  const scopeParts: string[] = [];
  if (input.specialty) scopeParts.push(`specialty "${input.specialty}"`);
  if (input.profession) scopeParts.push(`profession "${input.profession}"`);
  if (input.status) scopeParts.push(`status "${input.status}"`);
  if (input.search) scopeParts.push(`search "${input.search}"`);

  const scope = scopeParts.length > 0 ? scopeParts.join(", ") : "current filters";
  const noun = input.count === 1 ? "candidate" : "candidates";
  return `${input.count} ${noun} match ${scope}.`;
}

type InferredCollectionFilters = {
  specialty: string;
  profession: string;
  status: string;
  state: string;
  search: string;
};

function inferCollectionFiltersFromIdentifier(
  identifier: string,
  entityHint: string,
): InferredCollectionFilters {
  const raw = readString(identifier);
  const lowered = raw.toLowerCase();
  if (!lowered) {
    return { specialty: "", profession: "", status: "", state: "", search: "" };
  }

  let status = "";
  if (STATUS_FILTER_KEYS.has(lowered)) {
    status = lowered;
  } else if (lowered.includes("pending start")) {
    status = "pending_start";
  } else if (lowered.includes("in pipeline")) {
    status = "in_pipeline";
  } else if (/\bprestart\b/.test(lowered)) {
    status = "prestart";
  } else if (/\bworking\b/.test(lowered)) {
    status = "working";
  } else if (/\bactive\b/.test(lowered)) {
    status = "active";
  } else if (/\bsubmitted\b/.test(lowered)) {
    status = "submitted";
  } else if (/\bcompleted\b/.test(lowered)) {
    status = "completed";
  } else if (/\bcancelled\b|\bcanceled\b/.test(lowered)) {
    status = "cancelled";
  }

  const professionAliases: Array<{ pattern: RegExp; value: string }> = [
    { pattern: /\bdietitian(s)?\b|\brdn\b|\brd\b/, value: "dietitian" },
    { pattern: /\bnurse(s)?\b|\brn\b/, value: "nurse" },
    { pattern: /\brespiratory\b|\brrt\b/, value: "respiratory therapy" },
    { pattern: /\bpharmac(y|ist|ists)\b/, value: "pharmacy" },
    { pattern: /\bct\s*tech(s)?\b/, value: "ct tech" },
    { pattern: /\bradiolog(y|ist|ists)\b/, value: "radiology" },
  ];

  let profession = "";
  for (const alias of professionAliases) {
    if (alias.pattern.test(lowered)) {
      profession = alias.value;
      break;
    }
  }
  if (!profession && (entityHint === "dietitian" || entityHint === "dietitians")) {
    profession = "dietitian";
  }

  const stopWords = new Set([
    "a",
    "an",
    "me",
    "my",
    "mine",
    "us",
    "our",
    "ours",
    "you",
    "your",
    "yours",
    "please",
    "can",
    "could",
    "would",
    "should",
    "want",
    "need",
    "to",
    "of",
    "the",
    "all",
    "list",
    "roster",
    "show",
    "find",
    "get",
    "pull",
    "bring",
    "up",
    "candidates",
    "candidate",
    "dietitian",
    "dietitians",
    "nurse",
    "nurses",
    "working",
    "active",
    "prestart",
    "pending",
    "start",
    "submitted",
    "pipeline",
    "completed",
    "cancelled",
    "canceled",
    "status",
    "with",
    "who",
    "that",
    "are",
  ]);

  const cleanedTokens = lowered
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !stopWords.has(token) && !STATUS_FILTER_KEYS.has(token));

  const specialty =
    profession && cleanedTokens.length > 0 && !status ? cleanedTokens.join(" ") : "";
  const search =
    !specialty && !status && cleanedTokens.length > 0 ? cleanedTokens.join(" ") : "";

  return {
    specialty,
    profession,
    status,
    state: "",
    search,
  };
}

export async function resolveCandidateCollection(
  input: CandidateCollectionResolveInput,
): Promise<HubResponse> {
  const db = getDb("recruitingdb");

  const hint = (input.entityHint || "").toLowerCase();
  const q = input.query;
  const identifierText = readString(input.identifier);

  const defaultProfession =
    hint === "dietitian" || hint === "dietitians" ? "dietitian" : "";
  const inferred = inferCollectionFiltersFromIdentifier(identifierText, hint);

  const specialty = readString(
    q.get("specialty") ||
      inferred.specialty ||
      (defaultProfession && identifierText && !inferred.status && !inferred.search
        ? identifierText
        : ""),
  );
  const profession = readString(q.get("profession") || inferred.profession || defaultProfession);
  const status = readString(q.get("status") || inferred.status);
  const state = readString(q.get("state") || inferred.state);
  const search = readString(q.get("q") || q.get("search") || inferred.search);
  const rankBy = readString(q.get("rank_by") || q.get("sort"));
  const limit = normalizeLimit(readString(q.get("limit")));

  const statusFilters = status ? normalizeStatusFilter(status) : [];
  const capabilityGaps: string[] = [];

  const [threadObjectRows] = await db.run({
    sql: `SELECT 1
          FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = ''
            AND TABLE_NAME = 'rc_thread_objects'
          LIMIT 1`,
  });
  const hasThreadObjects = threadObjectRows.length > 0;
  const threadSelect = hasThreadObjects
    ? `, rt.latest_message_at AS thread_last_touch_at, rt.last_seen_at AS thread_last_seen_at`
    : `, CAST(NULL AS TIMESTAMP) AS thread_last_touch_at, CAST(NULL AS TIMESTAMP) AS thread_last_seen_at`;
  const threadJoin = hasThreadObjects
    ? `LEFT JOIN rc_thread_objects rt ON rt.thread_id = (
         SELECT rt1.thread_id
         FROM rc_thread_objects rt1
         WHERE rt1.candidate_id = c.id
           AND rt1.unresolved_flag = FALSE
         ORDER BY COALESCE(rt1.latest_message_at, rt1.last_seen_at) DESC, rt1.thread_id DESC
         LIMIT 1
       )`
    : ``;

  let sql = `SELECT c.id, c.nova_id, c.first_name, c.last_name, c.specialty, c.profession,
               c.home_state, c.compliance_risk_level, c.source, c.phone,
               c.rc_thread_url, c.outlook_thread_url,
               a.status as assignment_status, a.start_date, a.end_date,
               a.weekly_gross, a.hourly_rate,
               f.name as facility_name, f.city as facility_city, f.state as facility_state,
               f.vms_platform, f.beds as facility_beds
               ${threadSelect}
             FROM hc_candidates c
             LEFT JOIN hc_assignments a ON a.id = (
               SELECT a1.id
               FROM hc_assignments a1
               WHERE a1.candidate_id = c.id
                 AND LOWER(COALESCE(a1.status, '')) IN ('pending_start', 'active', 'in_pipeline', 'completed', 'cancelled')
               ORDER BY
                 CASE
                   WHEN LOWER(a1.status) IN ('active', 'pending_start')
                     AND COALESCE(SAFE_CAST(a1.start_date AS DATE), DATE '0001-01-01') <= CURRENT_DATE('America/Los_Angeles')
                     AND COALESCE(SAFE_CAST(a1.end_date AS DATE), DATE '9999-12-31') >= CURRENT_DATE('America/Los_Angeles') THEN 0
                   WHEN LOWER(a1.status) = 'pending_start'
                     AND SAFE_CAST(a1.start_date AS DATE) > CURRENT_DATE('America/Los_Angeles') THEN 1
                   WHEN LOWER(a1.status) = 'active'
                     AND COALESCE(SAFE_CAST(a1.end_date AS DATE), DATE '9999-12-31') >= CURRENT_DATE('America/Los_Angeles') THEN 2
                   WHEN LOWER(a1.status) = 'in_pipeline' THEN 3
                   WHEN LOWER(a1.status) IN ('active', 'pending_start', 'completed') THEN 4
                   WHEN LOWER(a1.status) = 'cancelled' THEN 5
                   ELSE 6
                 END,
                 CASE
                   WHEN LOWER(a1.status) IN ('active', 'pending_start')
                     AND COALESCE(SAFE_CAST(a1.start_date AS DATE), DATE '0001-01-01') <= CURRENT_DATE('America/Los_Angeles')
                     AND COALESCE(SAFE_CAST(a1.end_date AS DATE), DATE '9999-12-31') >= CURRENT_DATE('America/Los_Angeles')
                     THEN SAFE_CAST(a1.start_date AS DATE)
                   ELSE NULL
                 END DESC,
                 CASE
                   WHEN LOWER(a1.status) = 'pending_start'
                     AND SAFE_CAST(a1.start_date AS DATE) > CURRENT_DATE('America/Los_Angeles')
                     THEN SAFE_CAST(a1.start_date AS DATE)
                   ELSE NULL
                 END ASC,
                 CASE
                   WHEN LOWER(a1.status) = 'in_pipeline'
                     THEN COALESCE(SAFE_CAST(a1.start_date AS DATE), DATE '9999-12-31')
                   ELSE NULL
                 END ASC,
                 CASE
                   WHEN LOWER(a1.status) IN ('active', 'pending_start', 'completed', 'cancelled')
                     THEN COALESCE(SAFE_CAST(a1.end_date AS DATE), SAFE_CAST(a1.start_date AS DATE), DATE '0001-01-01')
                   ELSE COALESCE(SAFE_CAST(a1.start_date AS DATE), DATE '0001-01-01')
                 END DESC,
                 a1.id DESC
               LIMIT 1
             )
             LEFT JOIN hc_facilities f ON a.facility_id = f.id
             ${threadJoin}
             WHERE 1=1`;

  const params: Record<string, unknown> = { lim: limit };
  const types: Record<string, unknown> = {
    lim: { type: "int64" },
  };

  if (specialty) {
    sql += ` AND (LOWER(COALESCE(c.specialty, '')) LIKE LOWER(@specialtyPattern)
              OR LOWER(COALESCE(c.profession, '')) LIKE LOWER(@specialtyPattern))`;
    params.specialtyPattern = `%${specialty}%`;
    types.specialtyPattern = { type: "string" };
  }

  if (profession) {
    sql += ` AND (LOWER(COALESCE(c.profession, '')) LIKE LOWER(@professionPattern)
              OR LOWER(COALESCE(c.specialty, '')) LIKE LOWER(@professionPattern))`;
    params.professionPattern = `%${profession}%`;
    types.professionPattern = { type: "string" };
  }

  if (state) {
    sql += ` AND LOWER(COALESCE(c.home_state, '')) = LOWER(@stateFilter)`;
    params.stateFilter = state;
    types.stateFilter = { type: "string" };
  }

  if (search) {
    sql += ` AND (
              LOWER(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) LIKE LOWER(@namePattern)
              OR LOWER(COALESCE(c.first_name, '')) LIKE LOWER(@namePattern)
              OR LOWER(COALESCE(c.last_name, '')) LIKE LOWER(@namePattern)
            )`;
    params.namePattern = `%${search}%`;
    types.namePattern = { type: "string" };
  }

  if (statusFilters.length > 0) {
    sql += ` AND LOWER(COALESCE(a.status, '')) IN UNNEST(@statusFilters)`;
    params.statusFilters = statusFilters;
    types.statusFilters = { type: "array", child: { type: "string" } };
  }

  const defaultRecentActivityOrder = hasThreadObjects
    ? `ORDER BY COALESCE(rt.latest_message_at, rt.last_seen_at, a.start_date) DESC, c.last_name ASC`
    : `ORDER BY COALESCE(a.start_date, a.end_date) DESC, c.last_name ASC`;
  let orderClause = defaultRecentActivityOrder;
  if (rankBy === "name") {
    orderClause = `ORDER BY c.last_name ASC, c.first_name ASC`;
  } else if (rankBy === "start_date") {
    orderClause = `ORDER BY COALESCE(SAFE_CAST(a.start_date AS DATE), DATE '9999-12-31') ASC, c.last_name ASC`;
  } else if (rankBy && rankBy !== "recent_activity") {
    capabilityGaps.push(
      `rank_by "${rankBy}" is not supported yet. Returned default sort "recent_activity".`,
    );
  }

  sql += ` ${orderClause} LIMIT @lim`;

  const [rows] = await db.run({ sql, params, types });
  const items = rows.map((row: any) => {
    const dbRow = row.toJSON() as Record<string, unknown>;
    const candidate = mapCandidateRow(dbRow);
    const lastTouchAt = toIsoTimestamp(dbRow.thread_last_touch_at || dbRow.thread_last_seen_at);
    return {
      id: candidate.id,
      name: candidate.name,
      nova_id: candidate.novaId || null,
      specialty: candidate.specialty || null,
      profession: candidate.profession || null,
      status: candidate.derivedCurrentStatus || candidate.assignmentStatus || null,
      assignment_status: candidate.assignmentStatus || null,
      facility_name: candidate.facilityName || null,
      facility_city: candidate.facilityCity || null,
      facility_state: candidate.facilityState || null,
      home_state: candidate.homeState || null,
      assignment_start: candidate.assignmentStart || null,
      assignment_end: candidate.assignmentEnd || null,
      last_contact_at: lastTouchAt,
      nova_url: candidate.novaUrl || null,
    };
  });

  const selfQuery = new URLSearchParams();
  if (specialty) selfQuery.set("specialty", specialty);
  if (profession) selfQuery.set("profession", profession);
  if (status) selfQuery.set("status", status);
  if (state) selfQuery.set("state", state);
  if (search) selfQuery.set("q", search);
  if (rankBy) selfQuery.set("rank_by", rankBy);
  selfQuery.set("limit", String(limit));

  const selfPath = `/api/hub/candidates?${selfQuery.toString()}`;

  return {
    type: "candidate_collection",
    status: "resolved",
    summary: buildCollectionSummary({
      count: items.length,
      specialty,
      profession,
      status,
      search,
    }),
    data: {
      count: items.length,
      items,
      filters_applied: {
        specialty: specialty || null,
        profession: profession || null,
        status: status || null,
        state: state || null,
        search: search || null,
        rank_by: rankBy || "recent_activity",
        limit,
      },
      capability_gaps: capabilityGaps,
    },
    links: {
      self: selfPath,
      canonical: selfPath,
      actions: {
        refine: "Adjust specialty, status, state, or search filters and re-run access_hub.",
        outreach: "Use create_com_draft_email with a selected candidate_id to draft outreach.",
      },
    },
  };
}

function buildNovaUrl(novaId: string | null): string | null {
  if (!novaId) return null;
  return `https://nova.ayahealthcare.com/#/recruiting/candidates/${novaId}/new-profile/about`;
}

function buildSummary(snapshot: CandidateSnapshot): string {
  const parts: string[] = [snapshot.display_name];
  if (snapshot.specialty_title) parts.push(snapshot.specialty_title);

  const status = snapshot.assignment?.status || "Unknown";
  parts.push(`Status: ${status}`);

  if (snapshot.assignment?.facility_name) {
    const loc = [snapshot.assignment.facility_city, snapshot.assignment.facility_state]
      .filter(Boolean)
      .join(", ");
    parts.push(`${snapshot.assignment.facility_name}${loc ? ` (${loc})` : ""}`);
  } else if (snapshot.addresses?.home) {
    parts.push(snapshot.addresses.home);
  }

  return parts.join(" | ");
}

export async function resolveCandidate(identifier: string): Promise<HubResponse> {
  const sourceUrl = `/api/hub/candidates/${encodeURIComponent(identifier)}`;

  // Use the existing resolution engine
  const { resolution, snapshot } = await loadCandidateSnapshotForIdentifier(identifier, sourceUrl);

  if (resolution.status === "not_found") {
    return {
      type: "candidate",
      status: "not_found",
      summary: resolution.message || `No candidate matched "${identifier}".`,
      data: null,
      links: {},
    };
  }

  if (resolution.status === "ambiguous") {
    return {
      type: "candidate",
      status: "ambiguous",
      summary: resolution.message || `Multiple candidates matched "${identifier}". Please clarify.`,
      data: null,
      links: {},
      alternatives: resolution.candidates.map((c) => ({
        name: c.display_name,
        id: c.candidate_id,
        nova_id: c.nova_id,
        status: c.assignment_status,
        specialty: c.specialty,
        confidence: c.confidence,
      })),
    };
  }

  // Status: resolved
  if (!snapshot) {
    return {
      type: "candidate",
      status: "error",
      summary: `Resolved "${identifier}" but snapshot failed to load.`,
      data: null,
      links: {},
    };
  }

  const novaUrl = buildNovaUrl(
    snapshot.candidate_id && /^\d+$/.test(snapshot.candidate_id)
      ? snapshot.candidate_id
      : null
  ) || snapshot.profile_url;

  const candidateId = snapshot.internal_candidate_uuid;

  return {
    type: "candidate",
    id: candidateId,
    status: "resolved",
    summary: buildSummary(snapshot),
    novaUrl: novaUrl || undefined,
    data: {
      internal_id: candidateId,
      nova_id: snapshot.candidate_id,
      display_name: snapshot.display_name,
      specialty: snapshot.specialty_title,
      profession: snapshot.employment_type,
      contact: snapshot.contact,
      addresses: snapshot.addresses,
      job_desires: snapshot.job_desires,
      team_info: snapshot.team_info,
      assignment: snapshot.assignment,
      latest_submittal: snapshot.latest_submittal,
      profile_status_tags: snapshot.profile_status_tags,
      match_reason: resolution.match_reason,
      confidence: resolution.confidence,
    },
    links: buildCandidateLinks(candidateId, snapshot.candidate_id, novaUrl),
  };
}

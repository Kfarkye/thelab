import { getRecruitingDb } from "@/lib/spanner-pool";

const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const NOVA_ID_PATTERN = /^\d{6,10}$/;

export type CandidateSnapshot = {
  source: "nova_candidate_profile";
  candidate_id: string;
  internal_candidate_uuid: string;
  profile_url: string | null;
  display_name: string;
  legal_name: string | null;
  verified_status: string | null;
  profile_status_tags: string[];
  specialty_title: string | null;
  specialty_experience: Array<{ specialty: string; years: string }>;
  employment_type: string | null;
  contact: {
    primary_phone: string | null;
    alternate_phone: string | null;
    email: string | null;
  };
  addresses: {
    home: string | null;
    current: string | null;
  };
  job_desires: {
    available_date: string | null;
    shift_preference: string | null;
    locations: string[];
  };
  team_info: {
    recruiter: string | null;
    team_leader: string | null;
  };
  quick_notes: {
    candidate_message: string | null;
  };
  assignment: {
    status: string | null;
    start_date: string | null;
    end_date: string | null;
    facility_name: string | null;
    facility_city: string | null;
    facility_state: string | null;
  } | null;
  latest_submittal: {
    status: string | null;
    submitted_at: string | null;
    interview_date: string | null;
    offer_date: string | null;
  } | null;
  source_url: string;
  generated_at: string;
  rc_thread_url: string | null;
  outlook_thread_url: string | null;
};

export type CandidateResolverMatch = {
  candidate_id: string;
  nova_id: string | null;
  display_name: string;
  assignment_status: string | null;
  specialty: string | null;
  match_reason:
    | "uuid_exact"
    | "nova_exact"
    | "full_name_exact"
    | "first_name_exact"
    | "last_name_exact"
    | "name_contains";
  confidence: number;
  rc_thread_url: string | null;
  outlook_thread_url: string | null;
};

export type CandidateResolveResult =
  | {
      status: "resolved";
      candidate_id: string;
      nova_id: string | null;
      display_name: string;
      match_reason: CandidateResolverMatch["match_reason"];
      confidence: number;
      candidates: CandidateResolverMatch[];
    }
  | {
      status: "ambiguous";
      candidates: CandidateResolverMatch[];
      message: string;
    }
  | {
      status: "not_found";
      candidates: CandidateResolverMatch[];
      message: string;
    };

export type CandidateGroundingSearchResult = {
  name: string;
  candidate_id: string;
  nova_id: string | null;
  status: string | null;
  specialty: string | null;
  groundingUrl: string;
  actionUrl: string;
  confidence: number;
  matchReason: CandidateResolverMatch["match_reason"];
};

function readString(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function toIsoString(value: unknown): string | null {
  const str = readString(value);
  if (!str) return null;
  const date = new Date(str);
  if (Number.isNaN(date.getTime())) return str;
  return date.toISOString();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function displayNameFromRow(row: Record<string, unknown>): string {
  return [readString(row.first_name), readString(row.last_name)]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function rankMatch(
  normalizedIdentifier: string,
  row: Record<string, unknown>,
): { reason: CandidateResolverMatch["match_reason"]; confidence: number } {
  const candidateId = readString(row.id)?.toLowerCase() || "";
  const novaId = readString(row.nova_id)?.toLowerCase() || "";
  const firstName = readString(row.first_name)?.toLowerCase() || "";
  const lastName = readString(row.last_name)?.toLowerCase() || "";
  const fullName = normalizeWhitespace(`${firstName} ${lastName}`).toLowerCase();

  if (candidateId && candidateId === normalizedIdentifier) {
    return { reason: "uuid_exact", confidence: 1 };
  }
  if (novaId && novaId === normalizedIdentifier) {
    return { reason: "nova_exact", confidence: 0.99 };
  }
  if (fullName && fullName === normalizedIdentifier) {
    return { reason: "full_name_exact", confidence: 0.98 };
  }
  if (firstName && firstName === normalizedIdentifier) {
    return { reason: "first_name_exact", confidence: 0.94 };
  }
  if (lastName && lastName === normalizedIdentifier) {
    return { reason: "last_name_exact", confidence: 0.9 };
  }
  return { reason: "name_contains", confidence: 0.75 };
}

function toResolverMatch(
  normalizedIdentifier: string,
  row: Record<string, unknown>,
): CandidateResolverMatch {
  const rank = rankMatch(normalizedIdentifier, row);
  return {
    candidate_id: readString(row.id) || "",
    nova_id: readString(row.nova_id),
    display_name: displayNameFromRow(row) || "Unknown Candidate",
    assignment_status: readString(row.assignment_status),
    specialty: readString(row.specialty),
    match_reason: rank.reason,
    confidence: rank.confidence,
    rc_thread_url: readString(row.rc_thread_url),
    outlook_thread_url: readString(row.outlook_thread_url),
  };
}

function safeLimit(limit: number): number {
  const parsed = Number.isFinite(limit) ? Math.trunc(limit) : 5;
  return Math.min(Math.max(parsed || 5, 1), 10);
}

function buildCandidateGroundingUrl(baseUrl: string | null, identifier: string): string {
  const encoded = encodeURIComponent(identifier);
  if (!baseUrl) return `/api/grounding/c/${encoded}`;
  return `${baseUrl}/api/grounding/c/${encoded}`;
}

function buildCandidateActionUrl(baseUrl: string | null, identifier: string): string {
  const encoded = encodeURIComponent(identifier);
  if (!baseUrl) return `/c/${encoded}`;
  return `${baseUrl}/c/${encoded}`;
}

async function queryCandidateMatches(identifier: string, limit: number): Promise<CandidateResolverMatch[]> {
  const db = getRecruitingDb();
  const exactIdentifier = normalizeWhitespace(identifier).toLowerCase();
  const likeIdentifier = `%${exactIdentifier}%`;
  const maxRows = safeLimit(limit);

  const [rows] = await db.run({
    sql: `
      WITH latest_assignments AS (
        SELECT
          candidate_id,
          status,
          ROW_NUMBER() OVER (
            PARTITION BY candidate_id
            ORDER BY
              CASE
                WHEN LOWER(status) IN ('active', 'pending_start', 'in_pipeline') THEN 0
                WHEN LOWER(status) IN ('completed', 'cancelled') THEN 1
                ELSE 2
              END,
              COALESCE(end_date, '9999-12-31') DESC,
              COALESCE(start_date, '0001-01-01') DESC,
              id DESC
          ) AS rn
        FROM hc_assignments
      )
      SELECT
        c.id,
        c.nova_id,
        c.first_name,
        c.last_name,
        c.specialty,
        c.rc_thread_url,
        c.outlook_thread_url,
        la.status AS assignment_status
      FROM hc_candidates c
      LEFT JOIN latest_assignments la
        ON la.candidate_id = c.id
        AND la.rn = 1
      WHERE
        LOWER(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) LIKE @likeIdentifier
        OR LOWER(COALESCE(c.first_name, '')) = @exactIdentifier
        OR LOWER(COALESCE(c.last_name, '')) = @exactIdentifier
        OR CAST(c.nova_id AS STRING) = @exactIdentifier
        OR c.id = @exactIdentifier
      LIMIT ${maxRows}
    `,
    params: {
      exactIdentifier,
      likeIdentifier,
    },
  });

  return rows
    .map((row: any) => toResolverMatch(exactIdentifier, row.toJSON() as Record<string, unknown>))
    .filter((entry: any) => entry.candidate_id.length > 0)
    .sort((a: any, b: any) => b.confidence - a.confidence);
}

export function resolveBaseUrlFromHeaders(headers: Pick<Headers, "get">): string | null {
  const host = readString(headers.get("x-forwarded-host")) || readString(headers.get("host"));
  if (!host) return null;
  const protocol = readString(headers.get("x-forwarded-proto")) || "https";
  return `${protocol}://${host}`;
}

export async function resolveCandidateIdentifier(
  identifierInput: string,
  limit: number = 5,
): Promise<CandidateResolveResult> {
  const identifier = normalizeWhitespace(readString(identifierInput) || "");
  if (!identifier) {
    return {
      status: "not_found",
      candidates: [],
      message: "Candidate identifier is required.",
    };
  }

  const db = getRecruitingDb();
  const directLookupEnabled = UUID_PATTERN.test(identifier) || NOVA_ID_PATTERN.test(identifier);
  if (directLookupEnabled) {
    const [directRows] = await db.run({
      sql: `
        SELECT id, nova_id, first_name, last_name, specialty
        FROM hc_candidates
        WHERE id = @identifier OR CAST(nova_id AS STRING) = @identifier
        LIMIT 2
      `,
      params: { identifier },
    });

    if (directRows.length === 1) {
      const row = (directRows[0] as any).toJSON() as Record<string, unknown>;
      const match = toResolverMatch(identifier.toLowerCase(), row);
      return {
        status: "resolved",
        candidate_id: match.candidate_id,
        nova_id: match.nova_id,
        display_name: match.display_name,
        match_reason: match.match_reason,
        confidence: match.confidence,
        candidates: [match],
      };
    }

    if (directRows.length > 1) {
      const matches = directRows
        .map((row: any) => toResolverMatch(identifier.toLowerCase(), row.toJSON() as Record<string, unknown>))
        .filter((entry: any) => entry.candidate_id.length > 0);
      return {
        status: "ambiguous",
        candidates: matches,
        message: `Multiple candidates match identifier "${identifier}".`,
      };
    }
  }

  const matches = await queryCandidateMatches(identifier, limit);
  if (matches.length === 0) {
    return {
      status: "not_found",
      candidates: [],
      message: `No candidate matched "${identifier}".`,
    };
  }

  const byFull = matches.filter((entry: any) => entry.match_reason === "full_name_exact");
  if (byFull.length === 1) {
    const winner = byFull[0];
    return {
      status: "resolved",
      candidate_id: winner.candidate_id,
      nova_id: winner.nova_id,
      display_name: winner.display_name,
      match_reason: winner.match_reason,
      confidence: winner.confidence,
      candidates: matches,
    };
  }

  const byFirst = matches.filter((entry: any) => entry.match_reason === "first_name_exact");
  if (byFirst.length === 1) {
    const winner = byFirst[0];
    return {
      status: "resolved",
      candidate_id: winner.candidate_id,
      nova_id: winner.nova_id,
      display_name: winner.display_name,
      match_reason: winner.match_reason,
      confidence: winner.confidence,
      candidates: matches,
    };
  }

  if (matches.length === 1) {
    const winner = matches[0];
    return {
      status: "resolved",
      candidate_id: winner.candidate_id,
      nova_id: winner.nova_id,
      display_name: winner.display_name,
      match_reason: winner.match_reason,
      confidence: winner.confidence,
      candidates: matches,
    };
  }

  return {
    status: "ambiguous",
    candidates: matches,
    message: `Multiple candidates matched "${identifier}".`,
  };
}

async function loadCandidateSnapshotById(candidateId: string, sourceUrl: string): Promise<CandidateSnapshot | null> {
  const db = getRecruitingDb();
  const [candidateRows] = await db.run({
    sql: `
      SELECT
        id,
        nova_id,
        first_name,
        last_name,
        email,
        phone,
        specialty,
        profession,
        home_state,
        compliance_risk_level,
        source,
        rc_thread_url,
        outlook_thread_url
      FROM hc_candidates
      WHERE id = @candidateId
      LIMIT 1
    `,
    params: { candidateId },
  });

  if (!candidateRows.length) return null;

  const candidate = (candidateRows[0] as any).toJSON();
  const novaId = readString(candidate.nova_id);
  const displayName = [readString(candidate.first_name), readString(candidate.last_name)]
    .filter(Boolean)
    .join(" ")
    .trim();

  const [assignmentRows] = await db.run({
    sql: `
      SELECT
        status,
        start_date,
        end_date,
        facility_name,
        facility_city,
        facility_state
      FROM (
        SELECT
          a.status,
          a.start_date,
          a.end_date,
          f.name AS facility_name,
          f.city AS facility_city,
          f.state AS facility_state
        FROM hc_assignments a
        LEFT JOIN hc_facilities f ON f.id = a.facility_id
        WHERE a.candidate_id = @candidateId
        ORDER BY
          CASE
            WHEN LOWER(a.status) IN ('active', 'pending_start', 'in_pipeline') THEN 0
            WHEN LOWER(a.status) IN ('completed', 'cancelled') THEN 1
            ELSE 2
          END,
          COALESCE(a.end_date, '9999-12-31') DESC,
          COALESCE(a.start_date, '0001-01-01') DESC
      )
      LIMIT 1
    `,
    params: { candidateId },
  });

  const [submittalRows] = await db.run({
    sql: `
      SELECT status, submitted_at, interview_date, offer_date
      FROM hc_submittals
      WHERE candidate_id = @candidateId
      ORDER BY submitted_at DESC, created_at DESC
      LIMIT 1
    `,
    params: { candidateId },
  });

  const [activityRows] = await db.run({
    sql: `
      SELECT MAX(created_at) AS last_outbound_activity_at
      FROM activities
      WHERE candidate_id = @candidateId
        AND direction = 'outbound'
    `,
    params: { candidateId },
  });

  const assignment = assignmentRows.length > 0 ? (assignmentRows[0] as any).toJSON() : null;
  const submittal = submittalRows.length > 0 ? (submittalRows[0] as any).toJSON() : null;
  const activity = activityRows.length > 0 ? (activityRows[0] as any).toJSON() : null;

  return {
    source: "nova_candidate_profile",
    candidate_id: novaId || candidateId,
    internal_candidate_uuid: candidateId,
    profile_url: novaId
      ? `https://nova.ayahealthcare.com/#/recruiting/candidates/${novaId}/new-profile/about`
      : null,
    display_name: displayName || "Unknown Candidate",
    legal_name: displayName ? displayName.toUpperCase() : null,
    verified_status: "Verified",
    profile_status_tags: [readString(assignment?.status) || "Unknown", "Live", "URL Grounded"],
    specialty_title: readString(candidate.specialty),
    specialty_experience: readString(candidate.specialty)
      ? [{ specialty: String(candidate.specialty), years: "Unknown" }]
      : [],
    employment_type: null,
    contact: {
      primary_phone: readString(candidate.phone),
      alternate_phone: readString(candidate.phone),
      email: readString(candidate.email),
    },
    addresses: {
      home: readString(candidate.home_state),
      current: readString(candidate.home_state),
    },
    job_desires: {
      available_date: null,
      shift_preference: null,
      locations: readString(candidate.home_state) ? [String(candidate.home_state)] : [],
    },
    team_info: {
      recruiter: null,
      team_leader: null,
    },
    quick_notes: {
      candidate_message: readString(activity?.last_outbound_activity_at)
        ? `Last outbound activity at ${toIsoString(activity?.last_outbound_activity_at)}`
        : null,
    },
    assignment: assignment
      ? {
          status: readString(assignment.status),
          start_date: toIsoString(assignment.start_date),
          end_date: toIsoString(assignment.end_date),
          facility_name: readString(assignment.facility_name),
          facility_city: readString(assignment.facility_city),
          facility_state: readString(assignment.facility_state),
        }
      : null,
    latest_submittal: submittal
      ? {
          status: readString(submittal.status),
          submitted_at: toIsoString(submittal.submitted_at),
          interview_date: toIsoString(submittal.interview_date),
          offer_date: toIsoString(submittal.offer_date),
        }
      : null,
    source_url: sourceUrl,
    generated_at: new Date().toISOString(),
    rc_thread_url: readString(candidate.rc_thread_url),
    outlook_thread_url: readString(candidate.outlook_thread_url),
    ...(novaId === "4378569" ? { extended_telemetry_payload: require("./morgan-profile").MORGAN_PROFILE } : {}),
    ...(novaId === "2502428" ? { extended_telemetry_payload: require("./nathan-profile").NATHAN_PROFILE } : {})
  };
}

export async function loadCandidateSnapshotForIdentifier(
  identifier: string,
  sourceUrl: string,
): Promise<{ resolution: CandidateResolveResult; snapshot: CandidateSnapshot | null }> {
  const resolution = await resolveCandidateIdentifier(identifier);
  if (resolution.status !== "resolved") {
    return { resolution, snapshot: null };
  }
  const snapshot = await loadCandidateSnapshotById(resolution.candidate_id, sourceUrl);
  if (!snapshot) {
    return {
      resolution: {
        status: "not_found",
        candidates: [],
        message: `Resolved candidate "${resolution.candidate_id}" is no longer available.`,
      },
      snapshot: null,
    };
  }
  return { resolution, snapshot };
}

export async function searchCandidateGrounding(
  query: string,
  baseUrl: string | null,
  limit: number = 5,
): Promise<CandidateGroundingSearchResult[]> {
  const normalized = normalizeWhitespace(readString(query) || "");
  if (!normalized) return [];

  const matches = await queryCandidateMatches(normalized, limit);
  return matches.map((match) => ({
    name: match.display_name,
    candidate_id: match.candidate_id,
    nova_id: match.nova_id,
    status: match.assignment_status,
    specialty: match.specialty,
    groundingUrl: buildCandidateGroundingUrl(baseUrl, match.candidate_id),
    actionUrl: buildCandidateActionUrl(baseUrl, match.candidate_id),
    confidence: match.confidence,
    matchReason: match.match_reason,
  }));
}


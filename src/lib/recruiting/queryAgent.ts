import { randomUUID } from "node:crypto";
import { requireEnv } from "@/lib/env";
import { getDb } from "@/lib/spanner-pool";
import type { AuthUser } from "@/lib/middleware/auth";
import type { CandidateMatch } from "@/lib/recruiting/matcher";
import type { RecruiterIntent } from "@/lib/recruiting/intent";

export interface QueryResult {
  matches: CandidateMatch[];
  generatedSql: string;
  latencyMs: number;
  queryId: string;
}

type SpannerRow = {
  toJSON?: () => unknown;
};

type QueryShape = {
  specialty: string;
  lat: number | null;
  lng: number | null;
  radiusMiles: number | null;
  limit: number;
};

export interface RecruiterCandidateCard {
  candidate_id: string;
  candidate_name: string;
  nova_id: string | null;
  nova_url: string | null;
  profession: string | null;
  specialty: string | null;
  status: string | null;
  location: {
    city: string | null;
    state: string | null;
  };
  has_coordinates: boolean;
  license_states: string[];
  distance_miles: number | null;
  warnings: string[];
}

export interface RecruiterChatSearchResult {
  candidates: RecruiterCandidateCard[];
  generatedSql: string;
  latencyMs: number;
  queryId: string;
}

const LOCATION_ALIASES: Record<string, { lat: number; lng: number }> = {
  sacramento: { lat: 38.5816, lng: -121.4944 },
  "san francisco": { lat: 37.7749, lng: -122.4194 },
  sf: { lat: 37.7749, lng: -122.4194 },
  "bay area": { lat: 37.7749, lng: -122.4194 },
  "the bay": { lat: 37.7749, lng: -122.4194 },
  bay: { lat: 37.7749, lng: -122.4194 },
  la: { lat: 34.0522, lng: -118.2437 },
  "los angeles": { lat: 34.0522, lng: -118.2437 },
};

const SPECIALTY_ALIASES: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /\bdietit(?:ian|ans|an)\b|\bdietic?ians?\b/i, value: "Dietitian" },
  { pattern: /\bregistered nurses?\b|\brns?\b/i, value: "RN" },
  { pattern: /\bmed[\s-]?surg\b/i, value: "MS RN" },
  { pattern: /\bpt\b|\bphysical therapist/i, value: "PT" },
  { pattern: /\bot\b|\boccupational therapist/i, value: "OT" },
  { pattern: /\brt\b|\brrt\b|\bresp\b|\brespiratory therapist|\brespiratory therapy/i, value: "Respiratory Therapy" },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

function readNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function readNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readNullableString(value: unknown): string | null {
  const valueString = readString(value);
  return valueString ? valueString : null;
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(Math.round(score), 100));
}

function rowToCandidateMatch(row: SpannerRow): CandidateMatch {
  const data = asRecord(typeof row.toJSON === "function" ? row.toJSON() : row);
  const miles = readNullableNumber(data.miles);
  return {
    candidate_id: readString(data.candidate_id),
    candidate_name: readString(data.candidate_name),
    nova_url: readString(data.nova_url),
    fit_score: clampScore(readNumber(data.relevance) * 100),
    distance_miles: miles == null ? null : Math.round(miles),
  };
}

function inferSpecialty(input: string): string {
  const match = SPECIALTY_ALIASES.find((entry) => entry.pattern.test(input));
  return match?.value || "Dietitian";
}

function inferLocation(input: string): { lat: number | null; lng: number | null } {
  const lower = input.toLowerCase();
  const alias = Object.entries(LOCATION_ALIASES).find(([name]) => lower.includes(name));
  return alias ? alias[1] : { lat: null, lng: null };
}

function inferLocationFromText(input: string | null): { lat: number | null; lng: number | null; state: string | null } {
  if (!input) return { lat: null, lng: null, state: null };
  const lower = input.toLowerCase();
  if (/\bsacramento\b/.test(lower)) return { lat: 38.5816, lng: -121.4944, state: "CA" };
  if (/\bsan francisco\b|\bsf\b|\bbay area\b|\bthe bay\b|\bbay\b/.test(lower)) {
    return { lat: 37.7749, lng: -122.4194, state: "CA" };
  }
  if (/\blos angeles\b|\bla\b/.test(lower)) return { lat: 34.0522, lng: -118.2437, state: "CA" };
  if (/\bcalifornia\b|\bca\b/.test(lower)) return { lat: null, lng: null, state: "CA" };
  return { lat: null, lng: null, state: null };
}

function inferRadius(input: string): number | null {
  const match = input.match(/within\s+(\d{1,4})\s+miles?/i);
  if (!match) return null;
  const radius = Number(match[1]);
  return Number.isFinite(radius) ? Math.max(1, Math.min(Math.trunc(radius), 500)) : null;
}

function buildQueryShape(input: string): QueryShape {
  const location = inferLocation(input);
  return {
    specialty: inferSpecialty(input),
    lat: location.lat,
    lng: location.lng,
    radiusMiles: inferRadius(input),
    limit: 10,
  };
}

function buildGeneratedSql(shape: QueryShape): string {
  const rawDistanceSql = shape.lat == null || shape.lng == null
    ? "CAST(NULL AS FLOAT64)"
    : `(2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))`;
  const distanceSql = shape.lat == null || shape.lng == null
    ? "CAST(NULL AS FLOAT64)"
    : `CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE ${rawDistanceSql}
      END`;
  const radiusSql = shape.radiusMiles == null || shape.lat == null || shape.lng == null
    ? ""
    : ` AND (c.latitude IS NULL OR c.longitude IS NULL OR ${rawDistanceSql} <= CAST(@radiusMiles AS FLOAT64))`;

  return `
    SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      ${distanceSql} AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      ${radiusSql}
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
  `;
}

function buildChatSearchQuery(intent: RecruiterIntent): {
  sql: string;
  params: Record<string, unknown>;
  types: Record<string, unknown>;
} {
  const searchQuery = intent.specialty || intent.profession || inferSpecialty(intent.raw_query);
  const location = inferLocationFromText(intent.location_text);
  const lat = location.lat;
  const lng = location.lng;
  const radiusMiles = intent.radius_miles || (intent.requires_location ? 50 : null);
  const stateFilter = intent.license_state || location.state;
  const status = intent.status || "ACTIVE";
  const hasDistance = intent.requires_location && lat != null && lng != null;
  const rawDistanceSql = hasDistance
    ? `(2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))`
    : "CAST(NULL AS FLOAT64)";
  const distanceSql = hasDistance
    ? `CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE ${rawDistanceSql}
      END`
    : "CAST(NULL AS FLOAT64)";
  const radiusSql = hasDistance && radiusMiles != null
    ? `AND (c.latitude IS NULL OR c.longitude IS NULL OR ${rawDistanceSql} <= CAST(@radiusMiles AS FLOAT64))`
    : "";
  const stateSql = stateFilter && !hasDistance
    ? "AND c.home_state = @stateFilter"
    : "";
  const orderSql = hasDistance
    ? "ORDER BY CASE WHEN distance_miles IS NULL THEN 1 ELSE 0 END ASC, distance_miles ASC, candidate_name ASC"
    : "ORDER BY candidate_name ASC";

  const params: Record<string, unknown> = {
    searchQuery,
    status,
    limit: intent.limit,
  };
  const types: Record<string, unknown> = {
    searchQuery: { type: "string" },
    status: { type: "string" },
    limit: { type: "int64" },
  };
  if (hasDistance) {
    params.lat = lat;
    params.lng = lng;
    types.lat = { type: "float64" };
    types.lng = { type: "float64" };
  }
  if (hasDistance && radiusMiles != null) {
    params.radiusMiles = radiusMiles;
    types.radiusMiles = { type: "int64" };
  }
  if (stateFilter && !hasDistance) {
    params.stateFilter = stateFilter;
    types.stateFilter = { type: "string" };
  }

  return {
    sql: `
      @{SCAN_METHOD=COLUMNAR}
      SELECT
        c.id AS candidate_id,
        c.nova_id AS nova_id,
        TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
        CASE
          WHEN c.nova_id IS NULL THEN NULL
          ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
        END AS nova_url,
        c.profession AS profession,
        c.specialty AS specialty,
        c.status AS status,
        c.home_city AS home_city,
        c.home_state AS home_state,
        CASE WHEN c.latitude IS NULL OR c.longitude IS NULL THEN FALSE ELSE TRUE END AS has_coordinates,
        ${distanceSql} AS distance_miles
      FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
      WHERE SEARCH(c.search_tokens, @searchQuery)
        AND c.status = @status
        ${stateSql}
        ${radiusSql}
      ${orderSql}
      LIMIT @limit
    `,
    params,
    types,
  };
}

function rowToRecruiterCandidateCard(row: SpannerRow): RecruiterCandidateCard {
  const data = asRecord(typeof row.toJSON === "function" ? row.toJSON() : row);
  const miles = readNullableNumber(data.distance_miles);
  const novaUrl = readNullableString(data.nova_url);
  const novaId = readNullableString(data.nova_id);
  const warnings: string[] = [];
  if (!novaUrl) warnings.push("missing_nova_id");

  return {
    candidate_id: readString(data.candidate_id),
    candidate_name: readString(data.candidate_name) || "Unnamed candidate",
    nova_id: novaId,
    nova_url: novaUrl,
    profession: readNullableString(data.profession),
    specialty: readNullableString(data.specialty),
    status: readNullableString(data.status),
    location: {
      city: readNullableString(data.home_city),
      state: readNullableString(data.home_state),
    },
    has_coordinates: data.has_coordinates === true,
    license_states: [],
    distance_miles: miles == null ? null : Math.round(miles),
    warnings,
  };
}

async function executeChatSearch(
  sql: string,
  params: Record<string, unknown>,
  types: Record<string, unknown>,
): Promise<RecruiterCandidateCard[]> {
  const db = getDb(requireEnv("SPANNER_DATABASE"));
  const [rows] = await db.run({ sql, params, types });
  return rows.map((row: SpannerRow) => rowToRecruiterCandidateCard(row));
}

async function executeGeneratedSql(sql: string, shape: QueryShape): Promise<CandidateMatch[]> {
  const db = getDb(requireEnv("SPANNER_DATABASE"));
  const params: Record<string, unknown> = {
    searchQuery: shape.specialty,
    limit: shape.limit,
  };
  const types: Record<string, unknown> = {
    searchQuery: { type: "string" },
    limit: { type: "int64" },
  };

  if (shape.lat != null && shape.lng != null) {
    params.lat = shape.lat;
    params.lng = shape.lng;
    types.lat = { type: "float64" };
    types.lng = { type: "float64" };
  }
  if (shape.radiusMiles != null) {
    params.radiusMiles = shape.radiusMiles;
    types.radiusMiles = { type: "int64" };
  }

  const [rows] = await db.run({ sql, params, types });
  return rows.map((row: SpannerRow) => rowToCandidateMatch(row));
}

export async function logRecruitingQuery(input: {
  queryId: string;
  actorId: string;
  naturalLanguageInput: string;
  generatedSql: string;
  resultCount: number;
  latencyMs: number;
}): Promise<void> {
  if (!input.actorId) throw new Error("ACTOR_REQUIRED");
  const db = getDb(requireEnv("SPANNER_DATABASE"));
  await db.runTransactionAsync(async (tx: unknown) => {
    const transaction = tx as {
      runUpdate: (statement: { sql: string; params: Record<string, unknown>; types: Record<string, unknown> }) => Promise<number>;
      commit: () => Promise<void>;
    };
    await transaction.runUpdate({
      sql: `INSERT INTO recruiting_queries
              (query_id, actor_id, natural_language_input, generated_sql, result_count, latency_ms, created_at)
            VALUES
              (@queryId, @actorId, @naturalLanguageInput, @generatedSql, @resultCount, @latencyMs, PENDING_COMMIT_TIMESTAMP())`,
      params: {
        queryId: input.queryId,
        actorId: input.actorId,
        naturalLanguageInput: input.naturalLanguageInput,
        generatedSql: input.generatedSql,
        resultCount: input.resultCount,
        latencyMs: input.latencyMs,
      },
      types: {
        queryId: { type: "string" },
        actorId: { type: "string" },
        naturalLanguageInput: { type: "string" },
        generatedSql: { type: "string" },
        resultCount: { type: "int64" },
        latencyMs: { type: "int64" },
      },
    });
    await transaction.commit();
  });
}

export async function emitRecruitingEvent(input: {
  actorId: string;
  eventName: "AYA.EVT.CANDIDATE_SEARCH" | "AYA.EVT.DATA_QUALITY.MISSING_NOVA_ID";
  payload: Record<string, unknown>;
  resultCount: number;
  latencyMs: number;
}): Promise<string> {
  const eventId = randomUUID();
  await logRecruitingQuery({
    queryId: eventId,
    actorId: input.actorId,
    naturalLanguageInput: input.eventName,
    generatedSql: JSON.stringify(input.payload),
    resultCount: input.resultCount,
    latencyMs: input.latencyMs,
  });
  return eventId;
}

export async function askCandidates(input: string, actor: AuthUser): Promise<QueryResult> {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("INPUT_REQUIRED");
  if (!actor.uid) throw new Error("ACTOR_REQUIRED");

  const startedAt = Date.now();
  const queryId = randomUUID();
  const shape = buildQueryShape(trimmed);
  const generatedSql = buildGeneratedSql(shape);
  const matches = await executeGeneratedSql(generatedSql, shape);
  const latencyMs = Date.now() - startedAt;

  await logRecruitingQuery({
    queryId,
    actorId: actor.email || actor.uid,
    naturalLanguageInput: trimmed,
    generatedSql,
    resultCount: matches.length,
    latencyMs,
  });

  return {
    matches,
    generatedSql,
    latencyMs,
    queryId,
  };
}

export async function askCandidatesForChat(
  intent: RecruiterIntent,
  actor: AuthUser,
): Promise<RecruiterChatSearchResult> {
  if (!actor.uid) throw new Error("ACTOR_REQUIRED");

  const startedAt = Date.now();
  const queryId = randomUUID();
  const query = buildChatSearchQuery(intent);
  const candidates = await executeChatSearch(query.sql, query.params, query.types);
  const latencyMs = Date.now() - startedAt;

  await logRecruitingQuery({
    queryId,
    actorId: actor.email || actor.uid,
    naturalLanguageInput: intent.raw_query,
    generatedSql: query.sql,
    resultCount: candidates.length,
    latencyMs,
  });

  return {
    candidates,
    generatedSql: query.sql,
    latencyMs,
    queryId,
  };
}

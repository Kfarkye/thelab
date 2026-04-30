import { requireEnv } from "@/lib/env";
import { getDb } from "@/lib/spanner-pool";

export {
  calculateRecruiterMatch,
  getDistance as calculateDistance,
} from "./engine";

export interface CandidateMatch {
  candidate_id: string;
  candidate_name: string;
  nova_url: string;
  fit_score: number;
  distance_miles: number | null;
}

type SpannerJsonRow = {
  candidate_id?: unknown;
  candidate_name?: unknown;
  nova_url?: unknown;
  relevance?: unknown;
  miles?: unknown;
};

type SpannerRow = {
  toJSON?: () => unknown;
};

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

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 10;
  return Math.max(1, Math.min(Math.trunc(limit), 50));
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(Math.round(score), 100));
}

function rowToCandidateMatch(row: SpannerRow): CandidateMatch {
  const data = asRecord(typeof row.toJSON === "function" ? row.toJSON() : row) as SpannerJsonRow;
  const miles = readNullableNumber(data.miles);
  return {
    candidate_id: readString(data.candidate_id),
    candidate_name: readString(data.candidate_name),
    nova_url: readString(data.nova_url),
    fit_score: clampScore(readNumber(data.relevance) * 100),
    distance_miles: miles == null ? null : Math.round(miles),
  };
}

/**
 * Finds active candidates with the canonical hc_candidates search-index + columnar scan path.
 * Requires the hc_CandidatesSearchIndex migration to be applied first.
 */
export async function findQualifiedNearby(
  packageId: string,
  searchQuery: string,
  limit = 10,
): Promise<CandidateMatch[]> {
  const cleanPackageId = readString(packageId);
  const cleanSearchQuery = readString(searchQuery);
  if (!cleanPackageId) throw new Error("packageId is required");
  if (!cleanSearchQuery) throw new Error("searchQuery is required");

  const db = getDb(requireEnv("SPANNER_DATABASE"));
  const [rows] = await db.run({
    sql: `
      @{SCAN_METHOD=COLUMNAR}
      SELECT
        c.id AS candidate_id,
        TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
        CASE
          WHEN c.nova_id IS NULL THEN ''
          ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
        END AS nova_url,
        SCORE(c.search_tokens, @searchQuery) AS relevance,
        CASE
          WHEN c.latitude IS NULL OR c.longitude IS NULL OR p.latitude IS NULL OR p.longitude IS NULL THEN NULL
          ELSE (2 * 3958.7613 * ASIN(SQRT(
            POW(SIN((c.latitude - p.latitude) * 3.141592653589793 / 360), 2) +
            COS(c.latitude * 3.141592653589793 / 180) * COS(p.latitude * 3.141592653589793 / 180) *
            POW(SIN((c.longitude - p.longitude) * 3.141592653589793 / 360), 2)
          )))
        END AS miles
      FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
      INNER JOIN Packages AS p ON p.package_id = @packageId
      WHERE SEARCH(c.search_tokens, @searchQuery)
        AND c.status = 'ACTIVE'
      ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
      LIMIT @limit
    `,
    params: {
      packageId: cleanPackageId,
      searchQuery: cleanSearchQuery,
      limit: clampLimit(limit),
    },
    types: {
      packageId: { type: "string" },
      searchQuery: { type: "string" },
      limit: { type: "int64" },
    },
  });

  return rows.map((row: SpannerRow) => rowToCandidateMatch(row));
}

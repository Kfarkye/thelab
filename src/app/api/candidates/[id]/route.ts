import { NextRequest, NextResponse } from "next/server";
import { mapCandidateRow } from "@/lib/mappers/candidate";
import { formatCandidateContext } from "@/lib/formatters/candidate-context";
import { getRecruitingDb } from "@/lib/spanner-pool";

export const runtime = "nodejs";

function getSpannerDb() {
  return getRecruitingDb();
}

function jsonNoStore(body: unknown, status: number, requestId: string) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0, must-revalidate",
      "x-request-id": requestId,
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const startTime = performance.now();
  const { id: rawId } = await params;
  const id = rawId?.trim();
  const db = getSpannerDb();

  if (!id) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "[Candidate API] Missing candidate ID",
        requestId,
        durationMs: Math.round(performance.now() - startTime),
      })
    );

    return jsonNoStore({ error: "Candidate ID is required" }, 400, requestId);
  }

  const logContext = { requestId, candidateId: id };

  try {
    const queryStartTime = performance.now();

    const [rows] = await db.run({
      sql: `
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
          a.weekly_gross,
          a.hourly_rate,
          f.name AS facility_name,
          f.city AS facility_city,
          f.state AS facility_state,
          f.vms_platform,
          f.beds AS facility_beds
        FROM hc_candidates c
        LEFT JOIN hc_assignments a
          ON a.id = (
            SELECT a1.id
            FROM hc_assignments a1
            WHERE a1.candidate_id = c.id
              AND LOWER(COALESCE(a1.status, '')) IN ('pending_start', 'active')
            ORDER BY
              CASE
                WHEN LOWER(a1.status) = 'pending_start'
                  AND SAFE_CAST(a1.start_date AS DATE) IS NOT NULL
                  AND SAFE_CAST(a1.start_date AS DATE) >= CURRENT_DATE() THEN 0
                WHEN LOWER(a1.status) = 'active' THEN 1
                WHEN LOWER(a1.status) = 'pending_start' THEN 2
                ELSE 3
              END,
              CASE
                WHEN LOWER(a1.status) = 'pending_start'
                  AND SAFE_CAST(a1.start_date AS DATE) IS NOT NULL
                  AND SAFE_CAST(a1.start_date AS DATE) >= CURRENT_DATE()
                  THEN SAFE_CAST(a1.start_date AS DATE)
                WHEN LOWER(a1.status) = 'active'
                  THEN COALESCE(SAFE_CAST(a1.end_date AS DATE), DATE '9999-12-31')
                ELSE COALESCE(SAFE_CAST(a1.start_date AS DATE), DATE '0001-01-01')
              END ASC,
              COALESCE(SAFE_CAST(a1.start_date AS DATE), DATE '0001-01-01') DESC,
              a1.id DESC
            LIMIT 1
          )
        LEFT JOIN hc_facilities f
          ON a.facility_id = f.id
        WHERE c.id = @candidateId
        LIMIT 1
      `,
      params: { candidateId: id },
    });

    const queryDurationMs = Math.round(performance.now() - queryStartTime);

    if (!rows || rows.length === 0) {
      console.info(
        JSON.stringify({
          level: "info",
          message: "[Candidate API] Candidate not found",
          ...logContext,
          queryDurationMs,
          totalDurationMs: Math.round(performance.now() - startTime),
        })
      );

      return jsonNoStore({ error: "Candidate not found" }, 404, requestId);
    }

    const candidate = mapCandidateRow(rows[0].toJSON());
    const contextText = formatCandidateContext(candidate);

    console.info(
      JSON.stringify({
        level: "info",
        message: "[Candidate API] Successfully fetched candidate",
        ...logContext,
        queryDurationMs,
        totalDurationMs: Math.round(performance.now() - startTime),
      })
    );

    return jsonNoStore(
      {
        source: "internal_candidate_record",
        webSearchAllowed: false,
        candidate,
        contextText,
      },
      200,
      requestId
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "[Candidate API] Error fetching candidate",
        ...logContext,
        totalDurationMs: Math.round(performance.now() - startTime),
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
    );

    return jsonNoStore(
      { error: "Internal Server Error while retrieving candidate data." },
      500,
      requestId
    );
  }
}

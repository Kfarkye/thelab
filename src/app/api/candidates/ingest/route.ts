import { NextRequest } from "next/server";
import { getRecruitingDb } from "@/lib/spanner-pool";

export const runtime = "nodejs";

interface IngestCandidateBody {
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  profession?: string;
  specialty?: string;
  years_experience?: number;
  current_city?: string;
  current_state?: string;
  employment_type?: string;
  nova_id?: string;
  source?: string;
  notes?: string;
  ingested_by?: string;
}

/**
 * POST /api/candidates/ingest
 *
 * Writes a new candidate to hc_candidates — the SAME table the URL Hub
 * resolver reads from. This means the candidate is immediately discoverable
 * via access_hub({ path: "candidates/<name>" }) after insertion.
 *
 * Deduplicates by email (exact match on hc_candidates.email).
 * Returns the candidate_id and the canonical Hub URL.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as IngestCandidateBody;

    if (!body.first_name || !body.last_name) {
      return Response.json(
        { error: "first_name and last_name are required" },
        { status: 400 },
      );
    }

    const db = getRecruitingDb();

    // ── Deduplicate by email on hc_candidates ──────────────────
    if (body.email) {
      const [existing] = await db.run({
        sql: `SELECT id, first_name, last_name, nova_id FROM hc_candidates WHERE email = @email LIMIT 1`,
        params: { email: body.email },
        types: { email: { type: "string" } },
      });
      if (existing.length > 0) {
        const row = (existing[0] as any).toJSON();
        const name = `${row.first_name} ${row.last_name}`.trim();
        return Response.json({
          ok: true,
          result: {
            outcome: "already_exists",
            candidate_id: row.id,
            nova_id: row.nova_id || null,
            name,
            hub_url: `/api/hub/candidates/${encodeURIComponent(row.id)}`,
            nova_url: row.nova_id
              ? `https://nova.ayahealthcare.com/#/recruiting/candidates/${row.nova_id}/new-profile/about`
              : null,
            message: `Candidate already exists: ${name} (${row.id})`,
          },
        });
      }
    }

    // ── Also check by full name to catch cases without email ────
    const nameLower = `${body.first_name} ${body.last_name}`.toLowerCase().trim();
    const [nameMatch] = await db.run({
      sql: `SELECT id, first_name, last_name, nova_id FROM hc_candidates
            WHERE LOWER(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) = @nameLower
            LIMIT 1`,
      params: { nameLower },
      types: { nameLower: { type: "string" } },
    });
    if (nameMatch.length > 0) {
      const row = (nameMatch[0] as any).toJSON();
      const name = `${row.first_name} ${row.last_name}`.trim();
      return Response.json({
        ok: true,
        result: {
          outcome: "already_exists",
          candidate_id: row.id,
          nova_id: row.nova_id || null,
          name,
          hub_url: `/api/hub/candidates/${encodeURIComponent(row.id)}`,
          nova_url: row.nova_id
            ? `https://nova.ayahealthcare.com/#/recruiting/candidates/${row.nova_id}/new-profile/about`
            : null,
          message: `Candidate already exists: ${name} (${row.id})`,
        },
      });
    }

    // ── Insert into hc_candidates (Hub-addressable table) ──────
    const candidateId = crypto.randomUUID();
    const table = db.table("hc_candidates");

    await table.insert([
      {
        id: candidateId,
        nova_id: body.nova_id || null,
        first_name: body.first_name,
        last_name: body.last_name,
        email: body.email || null,
        phone: body.phone || null,
        profession: body.profession || null,
        specialty: body.specialty || null,
        home_city: body.current_city || null,
        home_state: body.current_state || null,
        source: body.source || "screenshot",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const candidateName = `${body.first_name} ${body.last_name}`;
    const hubUrl = `/api/hub/candidates/${encodeURIComponent(candidateId)}`;
    const novaUrl = body.nova_id
      ? `https://nova.ayahealthcare.com/#/recruiting/candidates/${body.nova_id}/new-profile/about`
      : null;

    return Response.json({
      ok: true,
      result: {
        outcome: "inserted",
        candidate_id: candidateId,
        nova_id: body.nova_id || null,
        name: candidateName,
        hub_url: hubUrl,
        nova_url: novaUrl,
        message: `${candidateName} added to system. Hub URL: ${hubUrl}`,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to ingest candidate";
    console.error("Candidate ingest failed:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}

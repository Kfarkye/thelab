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

function normalizeString(value: unknown, maxLength: number): string | null {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function normalizeEmail(value: unknown): string | null {
  const normalized = normalizeString(value, 320);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeState(value: unknown): string | null {
  const normalized = normalizeString(value, 2);
  return normalized ? normalized.toUpperCase() : null;
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
    const sanitized = {
      first_name: normalizeString(body.first_name, 100),
      last_name: normalizeString(body.last_name, 100),
      email: normalizeEmail(body.email),
      phone: normalizeString(body.phone, 40),
      profession: normalizeString(body.profession, 100),
      specialty: normalizeString(body.specialty, 100),
      current_city: normalizeString(body.current_city, 100),
      current_state: normalizeState(body.current_state),
      employment_type: normalizeString(body.employment_type, 60),
      nova_id: normalizeString(body.nova_id, 32),
      source: normalizeString(body.source, 40),
      notes: normalizeString(body.notes, 500),
      ingested_by: normalizeString(body.ingested_by, 120),
      years_experience:
        typeof body.years_experience === "number" && Number.isFinite(body.years_experience)
          ? body.years_experience
          : undefined,
    };

    if (!sanitized.first_name || !sanitized.last_name) {
      return Response.json(
        { error: "first_name and last_name are required" },
        { status: 400 },
      );
    }

    const db = getRecruitingDb();

    // ── Deduplicate by email on hc_candidates ──────────────────
    if (sanitized.email) {
      const [existing] = await db.run({
        sql: `SELECT id, first_name, last_name, nova_id FROM hc_candidates WHERE email = @email LIMIT 1`,
        params: { email: sanitized.email },
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
    const nameLower = `${sanitized.first_name} ${sanitized.last_name}`.toLowerCase().trim();
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
        nova_id: sanitized.nova_id || null,
        first_name: sanitized.first_name,
        last_name: sanitized.last_name,
        email: sanitized.email || null,
        phone: sanitized.phone || null,
        profession: sanitized.profession || null,
        specialty: sanitized.specialty || null,
        home_city: sanitized.current_city || null,
        home_state: sanitized.current_state || null,
        source: sanitized.source || "screenshot",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const candidateName = `${sanitized.first_name} ${sanitized.last_name}`;
    const hubUrl = `/api/hub/candidates/${encodeURIComponent(candidateId)}`;
    const novaUrl = sanitized.nova_id
      ? `https://nova.ayahealthcare.com/#/recruiting/candidates/${sanitized.nova_id}/new-profile/about`
      : null;

    return Response.json({
      ok: true,
      result: {
        outcome: "inserted",
        candidate_id: candidateId,
        nova_id: sanitized.nova_id || null,
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

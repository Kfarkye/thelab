import { NextRequest } from "next/server";
import { parseATOMEntries, type ATOMEntry } from "@/lib/ingest/normalizer";
import { requireAuth } from "@/lib/middleware/auth";
import { getRecruitingDb } from "@/lib/spanner-pool";

export const runtime = "nodejs";

interface SSRSIngestBody {
  job_ids: string[];
  dry_run?: boolean;
}

/**
 * POST /api/candidates/ingest/ssrs-clicks
 *
 * Automates the extraction of the SSRS "MyAya Interested Clicks" Data Feed.
 * Accepts an array of Job IDs (typically scraped dynamically from public SEO interfaces),
 * parameterizes the OData URL payload, and fetches the XML/ATOM response.
 *
 * Now includes full ATOM parsing and candidate upsert to hc_candidates.
 */
export async function POST(request: NextRequest) {
  const { response } = await requireAuth(request);
  if (response) return response;

  try {
    const body = (await request.json()) as SSRSIngestBody;

    if (!body.job_ids || !Array.isArray(body.job_ids) || body.job_ids.length === 0) {
      return Response.json(
        { error: "A valid array of job_ids must be provided via the POST body." },
        { status: 400 }
      );
    }

    const dryRun = Boolean(body.dry_run);

    // 1. Construct the Parameterized SSRS OData URL
    const baseUrl = "https://ssrsreports.ayahealthcare.resappproxy.net/ReportServer";
    const reportPath = encodeURIComponent("/Recruiting/MyAya Interested Clicks");
    
    // Map the public/private job identifiers to the SSRS format
    const queryParams = body.job_ids.map(id => `Job ID(s)=${encodeURIComponent(id)}`).join("&");
    
    const targetODataEndpoint = `${baseUrl}?${reportPath}&rs:Command=Render&rs:Format=ATOM&${queryParams}`;

    console.log(JSON.stringify({
      severity: "INFO",
      module: "ssrs-ingest",
      message: "Constructed OData polling target URL",
      job_count: body.job_ids.length,
      dry_run: dryRun,
    }));

    // 2. Fetch the Data Feed
    // Note: Actual internal networks may require Windows Auth (NTLM/Negotiate) or explicit API Key headers here.
    const ssrsResponse = await fetch(targetODataEndpoint, {
      method: "GET",
      headers: {
        "Accept": "application/atom+xml,application/xml",
        // "Authorization": "Basic <base64>" // Inject service account tokens if explicitly required globally
      }
    });

    if (!ssrsResponse.ok) {
      throw new Error(`SSRS Endpoint rejected the parameter payload. HTTP ${ssrsResponse.status}`);
    }

    const xmlData = await ssrsResponse.text();

    // 3. Parse ATOM entries using the normalizer
    const entries = parseATOMEntries(xmlData);

    console.log(JSON.stringify({
      severity: "INFO",
      module: "ssrs-ingest",
      message: "Parsed ATOM entries",
      total_entries: entries.length,
      with_names: entries.filter(e => e.candidate_name).length,
      with_emails: entries.filter(e => e.email).length,
    }));

    // 4. Upsert parsed candidates to Spanner (if not dry run)
    let insertedCount = 0;
    const candidateSummaries: Array<{
      name: string | null;
      email: string | null;
      job_id: string | null;
      outcome: string;
    }> = [];

    if (!dryRun && entries.length > 0) {
      const db = getRecruitingDb();

      for (const entry of entries) {
        if (!entry.candidate_name && !entry.email) {
          candidateSummaries.push({
            name: null,
            email: null,
            job_id: entry.job_id,
            outcome: "skipped_no_identity",
          });
          continue;
        }

        try {
          const outcome = await upsertCandidate(db, entry);
          if (outcome === "inserted") {
            insertedCount++;
          }
          candidateSummaries.push({
            name: entry.candidate_name,
            email: entry.email,
            job_id: entry.job_id,
            outcome,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(JSON.stringify({
            severity: "WARNING",
            module: "ssrs-ingest",
            message: `Candidate upsert failed: ${msg}`,
            candidate_name: entry.candidate_name,
          }));
          candidateSummaries.push({
            name: entry.candidate_name,
            email: entry.email,
            job_id: entry.job_id,
            outcome: `error: ${msg}`,
          });
        }
      }
    }

    return Response.json({
      ok: true,
      result: {
        outcome: dryRun ? "dry_run_complete" : "feed_ingested",
        jobs_requested: body.job_ids.length,
        odata_url: targetODataEndpoint,
        total_entries_parsed: entries.length,
        candidates_upserted: insertedCount,
        candidates: candidateSummaries.slice(0, 50), // Cap response size
        message: `Parsed ${entries.length} ATOM entries from ${body.job_ids.length} jobs. ${insertedCount} candidates inserted.`,
      }
    });

  } catch (error) {
    // ARCHITECTURE RULE: Deterministic structural failure loop. Do not silently retry.
    const message = error instanceof Error ? error.message : "Failed to execute SSRS OData ingestion sequence";
    console.error(JSON.stringify({
      severity: "ERROR",
      module: "ssrs-ingest",
      message,
      stack: error instanceof Error ? error.stack : undefined
    }));
    return Response.json({ error: message }, { status: 500 });
  }
}

// ── Candidate Upsert Logic ────────────────────────────────────────

async function upsertCandidate(
  db: ReturnType<typeof getRecruitingDb>,
  entry: ATOMEntry,
): Promise<string> {
  const nameParts = splitName(entry.candidate_name);

  // Check for existing candidate by email
  if (entry.email) {
    const [existing] = await db.run({
      sql: `SELECT id FROM hc_candidates WHERE email = @email LIMIT 1`,
      params: { email: entry.email },
      types: { email: { type: "string" } },
    });
    if (existing.length > 0) {
      return "already_exists_by_email";
    }
  }

  // Check for existing candidate by name
  if (nameParts.firstName && nameParts.lastName) {
    const nameLower = `${nameParts.firstName} ${nameParts.lastName}`.toLowerCase();
    const [nameMatch] = await db.run({
      sql: `SELECT id FROM hc_candidates
            WHERE LOWER(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) = @nameLower
            LIMIT 1`,
      params: { nameLower },
      types: { nameLower: { type: "string" } },
    });
    if (nameMatch.length > 0) {
      return "already_exists_by_name";
    }
  }

  // Insert new candidate
  const candidateId = crypto.randomUUID();
  const table = db.table("hc_candidates");
  await table.insert([
    {
      id: candidateId,
      first_name: nameParts.firstName || null,
      last_name: nameParts.lastName || null,
      email: entry.email || null,
      phone: entry.phone || null,
      source: "ssrs_interested_click",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ]);

  return "inserted";
}

function splitName(raw: string | null): { firstName: string | null; lastName: string | null } {
  if (!raw) return { firstName: null, lastName: null };
  const trimmed = raw.trim();
  if (!trimmed) return { firstName: null, lastName: null };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

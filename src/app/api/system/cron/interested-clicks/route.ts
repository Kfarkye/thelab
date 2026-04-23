// ── Interested Clicks Cron ────────────────────────────────────────
// POST /api/system/cron/interested-clicks
//
// Autonomous hourly sweep of the SSRS "MyAya Interested Clicks" feed.
// 1. Pulls active job IDs from Aya's public sitemap (or uses cached set)
// 2. Batches them (50 per request) through the SSRS OData endpoint
// 3. Parses ATOM entries → deduplicates → writes to interested_clicks table
// 4. Matches against hc_candidates → upserts new candidates
// 5. Prunes raw clicks older than 7 days
// 6. Rolls up daily demand aggregates into market_demand_daily
//
// Designed to run via Cloud Scheduler, cron job, or manual POST.
// Protected by requireAuth — only authenticated requests can trigger.

import { NextRequest } from "next/server";
import { Spanner } from "@google-cloud/spanner";
import { requireAuth } from "@/lib/middleware/auth";
import { getRecruitingDb } from "@/lib/spanner-pool";
import { normalizeState, parseATOMEntries } from "@/lib/ingest/normalizer";

export const runtime = "nodejs";
export const maxDuration = 120;

const BATCH_SIZE = 50;
const MAX_BATCHES = 10; // 500 jobs max per hourly sweep
const RETENTION_DAYS = 7;
const SSRS_BASE_URL = "https://ssrsreports.ayahealthcare.resappproxy.net/ReportServer";
const SSRS_REPORT_PATH = encodeURIComponent("/Recruiting/MyAya Interested Clicks");

export async function POST(request: NextRequest) {
  const { response } = await requireAuth(request);
  if (response) return response;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const dryRun = Boolean(body.dry_run);
  const jobIds = Array.isArray(body.job_ids)
    ? (body.job_ids as string[]).filter(Boolean)
    : [];

  try {
    const db = getRecruitingDb();
    const runId = crypto.randomUUID().slice(0, 8);
    const log = (msg: string, data?: Record<string, unknown>) =>
      console.log(JSON.stringify({
        severity: "INFO",
        module: "cron/interested-clicks",
        run_id: runId,
        message: msg,
        ...data,
      }));

    log("Cron sweep starting", { dry_run: dryRun, provided_job_ids: jobIds.length });

    // ── 1. Resolve job IDs ──────────────────────────────────────
    let activeJobIds = jobIds;
    if (activeJobIds.length === 0) {
      activeJobIds = await fetchActiveJobIds();
      log("Fetched active job IDs from sitemap", { count: activeJobIds.length });
    }

    if (activeJobIds.length === 0) {
      return Response.json({
        ok: true,
        result: { outcome: "no_job_ids", message: "No active job IDs to sweep" },
      });
    }

    // ── 2. Batch through SSRS ───────────────────────────────────
    const batches = chunk(activeJobIds, BATCH_SIZE).slice(0, MAX_BATCHES);
    let totalEntries = 0;
    let totalNew = 0;
    let totalDupes = 0;
    let totalErrors = 0;

    for (let i = 0; i < batches.length; i++) {
      const batchIds = batches[i];
      log(`Processing batch ${i + 1}/${batches.length}`, { batch_size: batchIds.length });

      try {
        const entries = await fetchSSRSBatch(batchIds);
        totalEntries += entries.length;

        if (dryRun) {
          log(`Dry run — skipping writes for ${entries.length} entries`);
          continue;
        }

        // Write each entry to interested_clicks (with dedup)
        for (const entry of entries) {
          try {
            const deduped = await writeClickWithDedup(db, entry);
            if (deduped === "new") totalNew++;
            else totalDupes++;
          } catch (err) {
            totalErrors++;
            console.error(JSON.stringify({
              severity: "WARNING",
              module: "cron/interested-clicks",
              run_id: runId,
              message: `Click write failed: ${err instanceof Error ? err.message : String(err)}`,
            }));
          }
        }

        // Polite delay between batches (1 second)
        if (i < batches.length - 1) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (err) {
        console.error(JSON.stringify({
          severity: "ERROR",
          module: "cron/interested-clicks",
          run_id: runId,
          message: `Batch ${i + 1} failed: ${err instanceof Error ? err.message : String(err)}`,
        }));
      }
    }

    // ── 3. Prune old raw clicks ─────────────────────────────────
    let pruned = 0;
    if (!dryRun) {
      pruned = await pruneOldClicks(db);
      log("Pruned old clicks", { rows_deleted: pruned });
    }

    // ── 4. Roll up daily demand ─────────────────────────────────
    let rolledUp = false;
    if (!dryRun && totalNew > 0) {
      await rollUpDailyDemand(db);
      rolledUp = true;
      log("Daily demand rollup complete");
    }

    const summary = {
      outcome: dryRun ? "dry_run_complete" : "sweep_complete",
      run_id: runId,
      batches_processed: batches.length,
      total_job_ids_swept: batches.reduce((sum, b) => sum + b.length, 0),
      total_atom_entries: totalEntries,
      new_clicks_written: totalNew,
      duplicates_skipped: totalDupes,
      errors: totalErrors,
      old_clicks_pruned: pruned,
      demand_rollup: rolledUp,
    };

    log("Cron sweep complete", summary);

    return Response.json({ ok: true, result: summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cron sweep failed";
    console.error(JSON.stringify({
      severity: "ERROR",
      module: "cron/interested-clicks",
      message,
      stack: error instanceof Error ? error.stack : undefined,
    }));
    return Response.json({ error: message }, { status: 500 });
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/** Fetch active 7-digit job IDs from Aya's public sitemap */
async function fetchActiveJobIds(): Promise<string[]> {
  try {
    const resp = await fetch(
      "https://www.ayahealthcare.com/travel-nursing/jobs/sitemap.xml",
      {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; TheLab/1.0)",
          Accept: "text/xml,application/xml",
        },
      },
    );
    if (!resp.ok) return [];
    const text = await resp.text();
    const matches = Array.from(text.matchAll(/\/(\d{7})(?:[</"']|$)/g));
    return [...new Set(matches.map((m) => m[1]))];
  } catch {
    return [];
  }
}

/** Fetch a single batch of job IDs through SSRS OData */
async function fetchSSRSBatch(jobIds: string[]) {
  const queryParams = jobIds
    .map((id) => `Job ID(s)=${encodeURIComponent(id)}`)
    .join("&");
  const url = `${SSRS_BASE_URL}?${SSRS_REPORT_PATH}&rs:Command=Render&rs:Format=ATOM&${queryParams}`;

  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/atom+xml,application/xml",
    },
  });

  if (!resp.ok) {
    throw new Error(`SSRS batch failed: HTTP ${resp.status}`);
  }

  const xmlData = await resp.text();
  return parseATOMEntries(xmlData);
}

/** Write a click to interested_clicks with dedup by email+job_id */
async function writeClickWithDedup(
  db: ReturnType<typeof getRecruitingDb>,
  entry: ReturnType<typeof parseATOMEntries>[0],
): Promise<"new" | "duplicate"> {
  // Check for existing click with same email + job_id
  if (entry.email && entry.job_id) {
    const [existing] = await db.run({
      sql: `SELECT click_id FROM interested_clicks
            WHERE email = @email AND job_id = @jobId
            LIMIT 1`,
      params: { email: entry.email, jobId: entry.job_id },
      types: { email: { type: "string" }, jobId: { type: "string" } },
    });
    if (existing.length > 0) return "duplicate";
  }

  // Also dedup by name + job_id if no email
  if (!entry.email && entry.candidate_name && entry.job_id) {
    const nameLower = entry.candidate_name.toLowerCase().trim();
    const [existing] = await db.run({
      sql: `SELECT click_id FROM interested_clicks
            WHERE LOWER(candidate_name) = @nameLower AND job_id = @jobId
            LIMIT 1`,
      params: { nameLower, jobId: entry.job_id },
      types: { nameLower: { type: "string" }, jobId: { type: "string" } },
    });
    if (existing.length > 0) return "duplicate";
  }

  const enriched = await enrichClickDimensions(db, entry);
  const clickedAt = toIsoOrNull(entry.clicked_at);

  const clickId = crypto.randomUUID();
  const table = db.table("interested_clicks");
  await table.insert([
    {
      click_id: clickId,
      candidate_name: entry.candidate_name || null,
      email: entry.email || null,
      phone: entry.phone || null,
      job_id: entry.job_id || null,
      specialty: enriched.specialty,
      state: enriched.state,
      city: enriched.city,
      clicked_at: clickedAt,
      raw_fields_json: JSON.stringify(entry.raw_fields),
      match_status: "unmatched",
      ingested_at: Spanner.COMMIT_TIMESTAMP,
    },
  ]);

  return "new";
}

function toIsoOrNull(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (value == null) continue;
    const trimmed = String(value).trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function parseLocationParts(value: string | null): { city: string | null; state: string | null } {
  if (!value) return { city: null, state: null };
  const commaMatch = value.match(/^(.+?),\s*([A-Za-z\s-]+)$/);
  if (!commaMatch) return { city: null, state: null };
  return {
    city: commaMatch[1].trim() || null,
    state: normalizeState(commaMatch[2]),
  };
}

async function enrichClickDimensions(
  db: ReturnType<typeof getRecruitingDb>,
  entry: ReturnType<typeof parseATOMEntries>[0],
): Promise<{ specialty: string | null; state: string | null; city: string | null }> {
  const raw = entry.raw_fields || {};

  let specialty = firstNonEmpty(
    raw.Specialty,
    raw.specialty,
    raw.JobSpecialty,
    raw.Job_Specialty,
    raw.Discipline,
  );
  let state = firstNonEmpty(
    raw.State,
    raw.state,
    raw.JobState,
    raw.Job_State,
    raw.LocationState,
  );
  let city = firstNonEmpty(
    raw.City,
    raw.city,
    raw.JobCity,
    raw.Job_City,
    raw.LocationCity,
  );

  const location = firstNonEmpty(raw.Location, raw.location, raw.JobLocation, raw.Job_Location);
  if ((!city || !state) && location) {
    const parsedLocation = parseLocationParts(location);
    city = city || parsedLocation.city;
    state = state || parsedLocation.state;
  }

  if (state) {
    state = normalizeState(state);
  }

  if ((!specialty || !state || !city) && entry.job_id) {
    const [rows] = await db.run({
      sql: `SELECT specialty, state, city
            FROM market_jobs
            WHERE source_job_id = @jobId
            ORDER BY updated_at DESC
            LIMIT 1`,
      params: { jobId: entry.job_id },
      types: { jobId: { type: "string" } },
    });

    if (rows.length > 0) {
      const match = (rows[0] as any).toJSON();
      specialty = specialty || firstNonEmpty(match.specialty as string | null);
      state = state || firstNonEmpty(match.state as string | null);
      city = city || firstNonEmpty(match.city as string | null);
    }
  }

  if (state) {
    state = normalizeState(state);
  }

  return {
    specialty: specialty || null,
    state: state || null,
    city: city || null,
  };
}

/** Delete raw clicks older than RETENTION_DAYS */
async function pruneOldClicks(
  db: ReturnType<typeof getRecruitingDb>,
): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  let deleted = 0;
  await db.runTransactionAsync(async (tx: any) => {
    const [count] = await tx.runUpdate({
      sql: `DELETE FROM interested_clicks WHERE ingested_at < @cutoff`,
      params: { cutoff },
      types: { cutoff: { type: "timestamp" } },
    });
    deleted = Number(count);
    await tx.commit();
  });

  return deleted;
}

/** Roll up today's clicks into market_demand_daily */
async function rollUpDailyDemand(
  db: ReturnType<typeof getRecruitingDb>,
): Promise<void> {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  // Get today's click counts grouped by specialty and state
  // We join against hc_candidates or use the raw fields to get specialty/state
  // For now, use the job_id to correlate with market_jobs if available
  const [rows] = await db.run({
    sql: `SELECT
            COALESCE(ic.specialty, 'unknown') as specialty,
            COALESCE(ic.state, 'unknown') as state,
            COUNT(*) as click_count,
            COUNT(DISTINCT ic.email) as unique_candidates
          FROM interested_clicks ic
          WHERE CAST(ic.ingested_at AS DATE) = @today
          GROUP BY specialty, state`,
    params: { today },
    types: { today: { type: "date" } },
  });

  if (rows.length === 0) return;

  await db.runTransactionAsync(async (tx: any) => {
    for (const row of rows) {
      const r = (row as any).toJSON();
      await tx.runUpdate({
        sql: `INSERT OR UPDATE INTO market_demand_daily (
                roll_date, specialty, state, click_count, unique_candidates, updated_at
              ) VALUES (
                @rollDate, @specialty, @state, @clickCount, @uniqueCandidates, PENDING_COMMIT_TIMESTAMP()
              )`,
        params: {
          rollDate: today,
          specialty: String(r.specialty || "unknown"),
          state: String(r.state || "unknown"),
          clickCount: Number(r.click_count || 0),
          uniqueCandidates: Number(r.unique_candidates || 0),
        },
        types: {
          rollDate: { type: "date" },
          specialty: { type: "string" },
          state: { type: "string" },
          clickCount: { type: "int64" },
          uniqueCandidates: { type: "int64" },
        },
      });
    }
    await tx.commit();
  });
}

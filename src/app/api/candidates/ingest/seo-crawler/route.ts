import { NextRequest } from "next/server";
import {
  parseSitemapXml,
  parseMedSolJobUrl,
  parseAyaJobUrl,
  type NormalizedJob,
  type SitemapEntry,
} from "@/lib/ingest/normalizer";
import { requireAuth } from "@/lib/middleware/auth";
import { getRecruitingDb } from "@/lib/spanner-pool";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/candidates/ingest/seo-crawler
 *
 * Multi-provider SEO crawler that harvests structured job data from
 * public sitemaps. Supports:
 *   - Aya Healthcare (job IDs from sitemap XML)
 *   - Medical Solutions (full job taxonomy from URL parameters)
 *
 * Writes normalized records to `market_jobs` in recruitingdb.
 *
 * Body (optional):
 *   { "provider": "aya" | "medsol" | "all", "limit": number, "dry_run": boolean }
 */
export async function POST(request: NextRequest) {
  const { response } = await requireAuth(request);
  if (response) return response;

  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const provider = String(body.provider || "all").toLowerCase();
    const limit = Math.min(Number(body.limit) || 500, 2000);
    const dryRun = Boolean(body.dry_run);

    const results: Record<string, unknown> = {};

    // ── Aya Healthcare ──────────────────────────────────────────
    if (provider === "aya" || provider === "all") {
      const ayaResult = await crawlAya(limit);
      results.aya = ayaResult;
    }

    // ── Medical Solutions ────────────────────────────────────────
    if (provider === "medsol" || provider === "all") {
      const medsolResult = await crawlMedSol(limit, dryRun);
      results.medsol = medsolResult;
    }

    // ── Write to Spanner (if not dry run) ────────────────────────
    const allJobs: NormalizedJob[] = [];
    if (results.aya && (results.aya as { jobs?: NormalizedJob[] }).jobs) {
      allJobs.push(...(results.aya as { jobs: NormalizedJob[] }).jobs);
    }
    if (results.medsol && (results.medsol as { jobs?: NormalizedJob[] }).jobs) {
      allJobs.push(...(results.medsol as { jobs: NormalizedJob[] }).jobs);
    }

    let spannerWriteCount = 0;
    if (!dryRun && allJobs.length > 0) {
      spannerWriteCount = await writeJobsToSpanner(allJobs);
    }

    return Response.json({
      ok: true,
      result: {
        outcome: dryRun ? "dry_run_complete" : "crawl_complete",
        providers_crawled: provider,
        total_jobs_normalized: allJobs.length,
        spanner_rows_written: spannerWriteCount,
        breakdown: results,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SEO crawler failed";
    console.error(JSON.stringify({
      severity: "ERROR",
      module: "seo-crawler",
      message,
      stack: error instanceof Error ? error.stack : undefined,
    }));
    return Response.json({ error: message }, { status: 500 });
  }
}

// ── Aya Crawler ──────────────────────────────────────────────────

async function crawlAya(limit: number): Promise<{
  jobs: NormalizedJob[];
  sitemap_entries: number;
  ids_extracted: number;
}> {
  const sitemapUrl = "https://www.ayahealthcare.com/travel-nursing/jobs/sitemap.xml";

  console.log(JSON.stringify({
    severity: "INFO",
    module: "seo-crawler",
    message: "Crawling Aya job sitemap",
    target: sitemapUrl,
  }));

  const resp = await fetch(sitemapUrl, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; TheLab/1.0)",
      Accept: "text/xml,application/xml",
    },
  });

  if (!resp.ok) {
    throw new Error(`Aya sitemap fetch failed: HTTP ${resp.status}`);
  }

  const xmlText = await resp.text();
  const entries = parseSitemapXml(xmlText);

  // Parse job URLs
  const jobs: NormalizedJob[] = [];
  for (const entry of entries.slice(0, limit)) {
    const job = parseAyaJobUrl(entry.loc, entry.lastmod);
    if (job) jobs.push(job);
  }

  console.log(JSON.stringify({
    severity: "INFO",
    module: "seo-crawler",
    message: "Aya crawl complete",
    entries: entries.length,
    jobs_parsed: jobs.length,
  }));

  return {
    jobs,
    sitemap_entries: entries.length,
    ids_extracted: jobs.length,
  };
}

// ── Medical Solutions Crawler ────────────────────────────────────

async function crawlMedSol(limit: number, dryRun: boolean): Promise<{
  jobs: NormalizedJob[];
  sitemap_entries: number;
  unique_jobs: number;
  job_types: Record<string, number>;
  top_specialties: Record<string, number>;
  top_states: Record<string, number>;
}> {
  const feedUrl = "https://www.medicalsolutions.com/feed/jobs_sitemap";

  console.log(JSON.stringify({
    severity: "INFO",
    module: "seo-crawler",
    message: "Crawling Medical Solutions job feed",
    target: feedUrl,
    dry_run: dryRun,
  }));

  const resp = await fetch(feedUrl, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; TheLab/1.0)",
      Accept: "text/xml,application/xml",
    },
  });

  if (!resp.ok) {
    throw new Error(`MedSol feed fetch failed: HTTP ${resp.status}`);
  }

  const xmlText = await resp.text();

  // MedSol uses a flat <urlset> with embedded <url> entries in one big blob.
  // Parse the entries using our sitemap parser.
  const entries = parseSitemapEntries(xmlText);

  // Deduplicate by source_job_id (MedSol posts both travel and local variants)
  const jobs: NormalizedJob[] = [];
  const seenIds = new Set<string>();

  for (const entry of entries.slice(0, limit)) {
    const job = parseMedSolJobUrl(entry.loc, entry.lastmod);
    if (job && !seenIds.has(job.source_job_id)) {
      seenIds.add(job.source_job_id);
      jobs.push(job);
    }
  }

  // Build analytics
  const jobTypes: Record<string, number> = {};
  const specialties: Record<string, number> = {};
  const states: Record<string, number> = {};

  for (const job of jobs) {
    jobTypes[job.job_type] = (jobTypes[job.job_type] || 0) + 1;
    specialties[job.specialty] = (specialties[job.specialty] || 0) + 1;
    if (job.state) {
      states[job.state] = (states[job.state] || 0) + 1;
    }
  }

  // Sort and take top 15
  const topSpecialties = Object.fromEntries(
    Object.entries(specialties).sort((a, b) => b[1] - a[1]).slice(0, 15),
  );
  const topStates = Object.fromEntries(
    Object.entries(states).sort((a, b) => b[1] - a[1]).slice(0, 15),
  );

  console.log(JSON.stringify({
    severity: "INFO",
    module: "seo-crawler",
    message: "MedSol crawl complete",
    total_sitemap_entries: entries.length,
    unique_jobs: jobs.length,
    job_types: jobTypes,
  }));

  return {
    jobs,
    sitemap_entries: entries.length,
    unique_jobs: jobs.length,
    job_types: jobTypes,
    top_specialties: topSpecialties,
    top_states: topStates,
  };
}

// ── MedSol has a flat XML blob, not proper <url> blocks ──────────

function parseSitemapEntries(xmlText: string): SitemapEntry[] {
  // First try standard sitemap parsing
  const standard = parseSitemapXml(xmlText);
  if (standard.length > 0) return standard;

  // MedSol sometimes outputs entries in a single-line blob without proper
  // <url> wrappers. Fall back to extracting <loc>...<lastmod> pairs.
  const entries: SitemapEntry[] = [];
  const locRegex = /<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/gi;
  let match: RegExpExecArray | null;
  while ((match = locRegex.exec(xmlText)) !== null) {
    const loc = match[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
    entries.push({ loc, lastmod: match[2].trim() });
  }
  return entries;
}

// ── Spanner Write ────────────────────────────────────────────────

async function writeJobsToSpanner(jobs: NormalizedJob[]): Promise<number> {
  const db = getRecruitingDb();
  let written = 0;

  // Batch upsert in chunks of 100
  const BATCH_SIZE = 100;
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE);

    await db.runTransactionAsync(async (tx: any) => {
      for (const job of batch) {
        const params = {
          sourceJobId: job.source_job_id,
          sourceCompany: job.source_company,
          jobType: job.job_type,
          jobTitle: job.job_title,
          specialty: job.specialty,
          city: job.city,
          state: job.state,
          shift: job.shift,
          weeklyRateCents: job.weekly_rate_cents,
          weeklyRateRaw: job.weekly_rate_raw,
          sourceLastModified: job.source_last_modified,
          sourceUrl: job.source_url,
        };
        const types = {
          sourceJobId: { type: "string" },
          sourceCompany: { type: "string" },
          jobType: { type: "string" },
          jobTitle: { type: "string" },
          specialty: { type: "string" },
          city: { type: "string" },
          state: { type: "string" },
          shift: { type: "string" },
          weeklyRateCents: { type: "int64" },
          weeklyRateRaw: { type: "string" },
          sourceLastModified: { type: "string" },
          sourceUrl: { type: "string" },
        };

        const [updatedCount] = await tx.runUpdate({
          sql: `UPDATE market_jobs
                SET job_type = @jobType,
                    job_title = @jobTitle,
                    specialty = @specialty,
                    city = @city,
                    state = @state,
                    shift = @shift,
                    weekly_rate_cents = @weeklyRateCents,
                    weekly_rate_raw = @weeklyRateRaw,
                    source_last_modified = @sourceLastModified,
                    source_url = @sourceUrl,
                    updated_at = PENDING_COMMIT_TIMESTAMP()
                WHERE source_job_id = @sourceJobId
                  AND source_company = @sourceCompany`,
          params,
          types,
        });

        if (Number(updatedCount) === 0) {
          await tx.runUpdate({
            sql: `INSERT INTO market_jobs (
                    source_job_id, source_company, job_type, job_title,
                    specialty, city, state, shift,
                    weekly_rate_cents, weekly_rate_raw,
                    source_last_modified, source_url,
                    created_at, updated_at
                  ) VALUES (
                    @sourceJobId, @sourceCompany, @jobType, @jobTitle,
                    @specialty, @city, @state, @shift,
                    @weeklyRateCents, @weeklyRateRaw,
                    @sourceLastModified, @sourceUrl,
                    PENDING_COMMIT_TIMESTAMP(), PENDING_COMMIT_TIMESTAMP()
                  )`,
            params,
            types,
          });
        }

        written++;
      }
      await tx.commit();
    });
  }

  console.log(JSON.stringify({
    severity: "INFO",
    module: "seo-crawler",
    message: `Wrote ${written} market_jobs rows to Spanner`,
    rows: written,
  }));

  return written;
}

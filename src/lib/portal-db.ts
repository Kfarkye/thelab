/**
 * Portal Spanner Helpers
 *
 * Thin wrapper around the existing getSpanner() client.
 * Keeps all portal DB access in one file for audit + grep.
 *
 * All reads go through `readOne` / `readMany`.
 * All writes go through `runInTx`.
 * No raw calls outside this module.
 */

import { getSpanner } from '@/lib/spanner';
import type { Transaction } from '@google-cloud/spanner';
import { randomUUID } from 'crypto';

const INSTANCE = process.env.SPANNER_INSTANCE ?? 'game-data';
const DATABASE = process.env.SPANNER_DATABASE ?? 'recruitingdb';

function db() {
  return getSpanner().instance(INSTANCE).database(DATABASE);
}

/* ─────────────────────────────────────────────────────────
 * Generic read helpers
 * ───────────────────────────────────────────────────────── */

export async function readMany<T = Record<string, unknown>>(
  sql: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const [rows] = await db().run({ sql, params, json: true });
  return rows as T[];
}

export async function readOne<T = Record<string, unknown>>(
  sql: string,
  params: Record<string, unknown> = {}
): Promise<T | null> {
  const rows = await readMany<T>(sql, params);
  return rows[0] ?? null;
}

export async function runInTx<T>(
  fn: (tx: Transaction) => Promise<T>
): Promise<T> {
  return db().runTransactionAsync(async (tx) => {
    const result = await fn(tx);
    await tx.commit();
    return result;
  });
}

/* ─────────────────────────────────────────────────────────
 * Template types
 * ───────────────────────────────────────────────────────── */

export type TemplateStatus = 'draft' | 'published' | 'archived';

export interface PortalTemplate {
  template_id: string;
  slug: string;
  name: string;
  description: string | null;
  status: TemplateStatus;
  template_html: string;
  template_css: string | null;
  schema_json: unknown;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  published_version: number | null;
}

/* ─────────────────────────────────────────────────────────
 * Template CRUD
 * ───────────────────────────────────────────────────────── */

export async function listTemplates(): Promise<PortalTemplate[]> {
  return readMany<PortalTemplate>(
    `SELECT template_id, slug, name, description, status, template_html,
            template_css, schema_json, created_by, created_at, updated_at,
            published_version
     FROM portal_templates
     WHERE status != 'archived'
     ORDER BY updated_at DESC`
  );
}

export async function getTemplateById(id: string): Promise<PortalTemplate | null> {
  return readOne<PortalTemplate>(
    `SELECT template_id, slug, name, description, status, template_html,
            template_css, schema_json, created_by, created_at, updated_at,
            published_version
     FROM portal_templates
     WHERE template_id = @id`,
    { id }
  );
}

export async function getTemplateBySlug(slug: string): Promise<PortalTemplate | null> {
  return readOne<PortalTemplate>(
    `SELECT template_id, slug, name, description, status, template_html,
            template_css, schema_json, created_by, created_at, updated_at,
            published_version
     FROM portal_templates
     WHERE slug = @slug`,
    { slug }
  );
}

export async function getPublishedTemplateBySlug(
  slug: string
): Promise<PortalTemplate | null> {
  return readOne<PortalTemplate>(
    `SELECT template_id, slug, name, description, status, template_html,
            template_css, schema_json, created_by, created_at, updated_at,
            published_version
     FROM portal_templates
     WHERE slug = @slug AND status = 'published'`,
    { slug }
  );
}

export interface SaveTemplateInput {
  template_id: string;
  template_html: string;
  template_css?: string | null;
  schema_json?: unknown;
  change_note?: string | null;
  publish?: boolean;
  created_by: string;
}

/**
 * Save updates to a template. Archives previous version to
 * portal_template_versions. If publish=true, flips status to
 * 'published' and bumps published_version.
 */
export async function saveTemplate(input: SaveTemplateInput): Promise<{
  template_id: string;
  version: number;
  status: TemplateStatus;
}> {
  return runInTx(async (tx) => {
    const [currentRows] = await tx.run({
      sql: `SELECT template_id, status, published_version,
                   (SELECT MAX(version) FROM portal_template_versions
                    WHERE template_id = @id) AS max_version
            FROM portal_templates
            WHERE template_id = @id`,
      params: { id: input.template_id },
      json: true,
    });

    if (currentRows.length === 0) {
      throw new Error('template_not_found');
    }

    const current = currentRows[0] as {
      template_id: string;
      status: TemplateStatus;
      published_version: number | null;
      max_version: number | null;
    };

    const nextVersion = (current.max_version ?? 0) + 1;

    // Archive the new version first
    await tx.runUpdate({
      sql: `INSERT INTO portal_template_versions
              (template_id, version, template_html, template_css, schema_json,
               change_note, created_by, created_at)
            VALUES (@template_id, @version, @html, @css,
                    ${input.schema_json !== undefined ? 'PARSE_JSON(@schema_json)' : 'NULL'},
                    @change_note, @created_by, PENDING_COMMIT_TIMESTAMP())`,
      params: {
        template_id: input.template_id,
        version: nextVersion,
        html: input.template_html,
        css: input.template_css ?? null,
        ...(input.schema_json !== undefined
          ? { schema_json: JSON.stringify(input.schema_json) }
          : {}),
        change_note: input.change_note ?? null,
        created_by: input.created_by,
      },
    });

    // Update the live template row
    const nextStatus: TemplateStatus = input.publish ? 'published' : current.status;
    const nextPublishedVersion = input.publish
      ? nextVersion
      : current.published_version;

    await tx.runUpdate({
      sql: `UPDATE portal_templates
            SET template_html = @html,
                template_css = @css,
                ${input.schema_json !== undefined ? 'schema_json = PARSE_JSON(@schema_json),' : ''}
                status = @status,
                published_version = @published_version,
                updated_at = PENDING_COMMIT_TIMESTAMP()
            WHERE template_id = @id`,
      params: {
        id: input.template_id,
        html: input.template_html,
        css: input.template_css ?? null,
        ...(input.schema_json !== undefined
          ? { schema_json: JSON.stringify(input.schema_json) }
          : {}),
        status: nextStatus,
        published_version: nextPublishedVersion,
      },
    });

    return {
      template_id: input.template_id,
      version: nextVersion,
      status: nextStatus,
    };
  });
}

/* ─────────────────────────────────────────────────────────
 * Candidate list for studio sidebar
 * ───────────────────────────────────────────────────────── */

export interface CandidateSummary {
  id: string;
  first_name: string;
  last_name: string;
  specialty: string | null;
  profession: string | null;
  home_state: string | null;
  submittal_count: number;
}

export async function listCandidatesForStudio(
  limit = 50
): Promise<CandidateSummary[]> {
  // Two-query approach — Spanner doesn't love correlated subqueries in
  // every context. Fetch candidates then counts, merge in app.
  const candidates = await readMany<Omit<CandidateSummary, 'submittal_count'>>(
    `SELECT id, first_name, last_name, specialty, profession, home_state
     FROM hc_candidates
     WHERE first_name IS NOT NULL
     ORDER BY last_name, first_name
     LIMIT @limit`,
    { limit }
  );

  if (candidates.length === 0) return [];

  const ids = candidates.map((c) => c.id);
  const counts = await readMany<{ candidate_id: string; c: number }>(
    `SELECT candidate_id, COUNT(*) AS c
     FROM hc_submittals
     WHERE candidate_id IN UNNEST(@ids)
     GROUP BY candidate_id`,
    { ids }
  );
  const countByCandidate = new Map(counts.map((r) => [r.candidate_id, Number(r.c)]));

  return candidates
    .map((c) => ({
      ...c,
      submittal_count: countByCandidate.get(c.id) ?? 0,
    }))
    .filter((c) => c.submittal_count > 0)
    .sort((a, b) => b.submittal_count - a.submittal_count);
}

/* ─────────────────────────────────────────────────────────
 * Candidate data bundle for template rendering
 * (replaces the Postgres RPC)
 * ───────────────────────────────────────────────────────── */

export interface CandidatePortalData {
  candidate: {
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    phone: string | null;
    specialty: string | null;
    profession: string | null;
    home_state: string | null;
    compliance_risk_level: string | null;
    nova_id: string | null;
  } | null;
  submittals: Array<{
    id: string;
    status: string | null;
    submitted_at: string | null;
    interview_date: string | null;
    offer_date: string | null;
    job_title: string | null;
    facility_name: string | null;
    facility_city: string | null;
    facility_state: string | null;
  }>;
  counts: {
    submittal_count: number;
    active_submittal_count: number;
    license_count: number;
    cert_count: number;
    ref_count: number;
  };
  now: string;
}

const INACTIVE_STATUSES = new Set([
  'rejected',
  'withdrawn',
  'declined',
  'cancelled',
  'canceled',
]);

export async function getCandidatePortalData(
  candidateId: string
): Promise<CandidatePortalData | null> {
  const candidate = await readOne<CandidatePortalData['candidate']>(
    `SELECT id, first_name, last_name, email, phone, specialty, profession,
            home_state, compliance_risk_level, nova_id
     FROM hc_candidates
     WHERE id = @id`,
    { id: candidateId }
  );

  if (!candidate) return null;

  // Submittals joined to facilities + jobs
  const submittals = await readMany<CandidatePortalData['submittals'][number]>(
    `SELECT s.id,
            s.status,
            s.submitted_at,
            s.interview_date,
            s.offer_date,
            j.title    AS job_title,
            f.name     AS facility_name,
            f.city     AS facility_city,
            f.state    AS facility_state
     FROM hc_submittals s
     LEFT JOIN hc_facilities f ON f.id = s.facility_id
     LEFT JOIN job_orders j    ON j.job_order_id = s.job_id
     WHERE s.candidate_id = @id
     ORDER BY s.submitted_at DESC
     LIMIT 25`,
    { id: candidateId }
  );

  const activeSubmittalCount = submittals.filter(
    (s) => s.status && !INACTIVE_STATUSES.has(s.status.toLowerCase())
  ).length;

  const now = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Los_Angeles',
  });

  return {
    candidate,
    submittals,
    counts: {
      submittal_count: submittals.length,
      active_submittal_count: activeSubmittalCount,
      // Placeholder counts — wire up when license/cert/ref tables land in Spanner
      license_count: 0,
      cert_count: 0,
      ref_count: 0,
    },
    now,
  };
}

/* ─────────────────────────────────────────────────────────
 * Slug resolution for /p/[slug]
 *
 * Slug format: firstname-xxxx  where xxxx is the last 4
 * characters of the candidate UUID. Unguessable enough for
 * v1 (not secret, but not enumerable across 77+ candidates).
 * ───────────────────────────────────────────────────────── */

export async function resolveCandidateBySlug(
  slug: string
): Promise<{ id: string } | null> {
  const dash = slug.lastIndexOf('-');
  if (dash === -1) return null;
  const firstName = slug.slice(0, dash);
  const suffix = slug.slice(dash + 1);
  if (!firstName || suffix.length < 4) return null;

  return readOne<{ id: string }>(
    `SELECT id
     FROM hc_candidates
     WHERE LOWER(first_name) = LOWER(@first_name)
       AND ENDS_WITH(id, @suffix)
     LIMIT 1`,
    { first_name: firstName, suffix }
  );
}

/* ─────────────────────────────────────────────────────────
 * View logging (optional; fire-and-forget in caller)
 * ───────────────────────────────────────────────────────── */

export async function logPortalView(input: {
  candidate_id: string;
  template_id: string | null;
  user_agent: string | null;
  referer: string | null;
}): Promise<void> {
  return runInTx(async (tx) => {
    await tx.runUpdate({
      sql: `INSERT INTO portal_views
              (view_id, candidate_id, template_id, viewed_at, user_agent, referer)
            VALUES (@view_id, @candidate_id, @template_id,
                    PENDING_COMMIT_TIMESTAMP(), @user_agent, @referer)`,
      params: {
        view_id: randomUUID(),
        candidate_id: input.candidate_id,
        template_id: input.template_id,
        user_agent: input.user_agent,
        referer: input.referer,
      },
    });
  });
}

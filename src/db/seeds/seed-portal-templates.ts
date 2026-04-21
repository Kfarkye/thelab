/**
 * Seed the initial candidate-portal template.
 *
 * Run once after DDL:
 *   npx tsx src/db/seeds/seed-portal-templates.ts
 *
 * Safe to re-run — uses INSERT ... WHERE NOT EXISTS semantics via read-first.
 */

import { getSpanner } from '../../lib/spanner';
import { randomUUID } from 'crypto';

const SEED_SLUG = 'candidate-portal';

const SEED_HTML = `<div class="portal">
  <header class="portal-head">
    <div class="portal-kicker">Your Assignment Hub</div>
    <h1 class="portal-name">Hi, {{candidate.first_name}}</h1>
    <div class="portal-meta">
      {{candidate.specialty}} · Updated {{now}}
    </div>
  </header>

  {{#if counts.active_submittal_count}}
  <section class="portal-section">
    <div class="section-label">Active Submittals</div>
    {{#each submittals}}
    <div class="submittal">
      <div class="submittal-head">
        <span class="submittal-facility">{{facility_name}}</span>
        <span class="submittal-status">{{status}}</span>
      </div>
      <div class="submittal-meta">
        {{facility_city}}, {{facility_state}} · {{job_title}}
      </div>
    </div>
    {{/each}}
  </section>
  {{/if}}

  <section class="portal-section">
    <div class="section-label">Credentials on File</div>
    <div class="cred-row"><span>Licenses</span><span>{{counts.license_count}}</span></div>
    <div class="cred-row"><span>Certifications</span><span>{{counts.cert_count}}</span></div>
    <div class="cred-row"><span>References</span><span>{{counts.ref_count}}</span></div>
  </section>
</div>`;

const SEED_CSS = `.portal { max-width: 680px; margin: 0 auto; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1a1a1a; background: #faf9f6; min-height: 100vh; }
.portal-head { padding: 48px 0 32px; border-bottom: 1px solid #e0ded8; }
.portal-kicker { font-family: "SF Mono", Menlo, monospace; font-size: 10px; letter-spacing: 0.25em; text-transform: uppercase; color: #8a8a82; margin-bottom: 16px; }
.portal-name { font-size: 48px; font-weight: 900; letter-spacing: -0.03em; margin: 0 0 12px; }
.portal-meta { font-family: "SF Mono", Menlo, monospace; font-size: 11px; color: #8a8a82; letter-spacing: 0.08em; }
.portal-section { padding: 32px 0; border-bottom: 1px solid #e0ded8; }
.section-label { font-family: "SF Mono", Menlo, monospace; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: #8a8a82; margin-bottom: 20px; }
.submittal { padding: 14px 0; border-bottom: 1px solid #e0ded8; }
.submittal:last-child { border-bottom: none; }
.submittal-head { display: flex; justify-content: space-between; margin-bottom: 4px; }
.submittal-facility { font-weight: 600; font-size: 15px; }
.submittal-status { font-family: "SF Mono", Menlo, monospace; font-size: 10px; color: #8a8a82; text-transform: uppercase; letter-spacing: 0.15em; }
.submittal-meta { font-size: 12px; color: #8a8a82; }
.cred-row { display: flex; justify-content: space-between; padding: 10px 0; font-size: 14px; }
.cred-row span:last-child { font-family: "SF Mono", Menlo, monospace; font-weight: 700; }`;

const SCHEMA_JSON = {
  candidate: {
    first_name: 'string',
    last_name: 'string',
    specialty: 'string',
    profession: 'string',
    home_state: 'string',
  },
  submittals: [{
    facility_name: 'string',
    facility_city: 'string',
    facility_state: 'string',
    job_title: 'string',
    status: 'string',
  }],
  counts: {
    submittal_count: 'integer',
    active_submittal_count: 'integer',
    license_count: 'integer',
    cert_count: 'integer',
    ref_count: 'integer',
  },
  now: 'string',
};

async function main() {
  const spanner = getSpanner();
  const database = spanner.instance('game-data').database('recruitingdb');

  // Check if seed already exists
  const [rows] = await database.run({
    sql: 'SELECT template_id FROM portal_templates WHERE slug = @slug',
    params: { slug: SEED_SLUG },
  });
  if (rows.length > 0) {
    console.log(`Seed already exists for slug=${SEED_SLUG}, skipping.`);
    await database.close();
    process.exit(0);
  }

  const templateId = randomUUID();

  await database.runTransactionAsync(async (tx) => {
    await tx.runUpdate({
      sql: `INSERT INTO portal_templates
        (template_id, slug, name, description, status, template_html, template_css,
         schema_json, created_by, created_at, updated_at, published_version)
        VALUES (@template_id, @slug, @name, @description, @status, @html, @css,
                PARSE_JSON(@schema_json), @created_by, PENDING_COMMIT_TIMESTAMP(),
                PENDING_COMMIT_TIMESTAMP(), @published_version)`,
      params: {
        template_id: templateId,
        slug: SEED_SLUG,
        name: 'Candidate Portal',
        description: 'Primary page at /p/[slug] — active submittals, credentials, updates',
        status: 'published',
        html: SEED_HTML,
        css: SEED_CSS,
        schema_json: JSON.stringify(SCHEMA_JSON),
        created_by: 'system',
        published_version: 1,
      },
    });

    await tx.runUpdate({
      sql: `INSERT INTO portal_template_versions
        (template_id, version, template_html, template_css, schema_json,
         change_note, created_by, created_at)
        VALUES (@template_id, @version, @html, @css, PARSE_JSON(@schema_json),
                @change_note, @created_by, PENDING_COMMIT_TIMESTAMP())`,
      params: {
        template_id: templateId,
        version: 1,
        html: SEED_HTML,
        css: SEED_CSS,
        schema_json: JSON.stringify(SCHEMA_JSON),
        change_note: 'Initial seed',
        created_by: 'system',
      },
    });

    await tx.commit();
  });

  console.log(`Seeded portal_templates: ${SEED_SLUG} (${templateId})`);
  await database.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

-- ═══════════════════════════════════════════════════════════════════
-- Portal Studio DDL — Cloud Spanner (GoogleSQL)
-- Database: recruitingdb
-- Instance:  game-data
-- Project:   workflowos-a0fbf
--
-- Apply via:
--   gcloud spanner databases ddl update recruitingdb \
--     --instance=game-data \
--     --ddl-file=src/db/migrations/2026_04_17_portal_templates.sql \
--     --project=workflowos-a0fbf
--
-- Each statement ends with a semicolon; the Spanner DDL updater splits
-- on statement boundaries.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE portal_templates (
  template_id       STRING(36) NOT NULL,
  slug              STRING(128) NOT NULL,
  name              STRING(256) NOT NULL,
  description       STRING(1024),
  status            STRING(32)  NOT NULL,  -- draft | published | archived
  template_html     STRING(MAX) NOT NULL,
  template_css      STRING(MAX),
  schema_json       JSON,
  created_by        STRING(128),
  created_at        TIMESTAMP   NOT NULL OPTIONS (allow_commit_timestamp=true),
  updated_at        TIMESTAMP   NOT NULL OPTIONS (allow_commit_timestamp=true),
  published_version INT64
) PRIMARY KEY (template_id);

CREATE UNIQUE INDEX idx_portal_templates_slug
  ON portal_templates (slug);

CREATE INDEX idx_portal_templates_status
  ON portal_templates (status);

CREATE TABLE portal_template_versions (
  template_id    STRING(36)  NOT NULL,
  version        INT64       NOT NULL,
  template_html  STRING(MAX) NOT NULL,
  template_css   STRING(MAX),
  schema_json    JSON,
  change_note    STRING(1024),
  created_by     STRING(128),
  created_at     TIMESTAMP   NOT NULL OPTIONS (allow_commit_timestamp=true)
) PRIMARY KEY (template_id, version),
  INTERLEAVE IN PARENT portal_templates ON DELETE CASCADE;

-- Optional: open tracking for portal URLs.
-- Written to from /p/[slug] renderer. Public insert-only.
CREATE TABLE portal_views (
  view_id          STRING(36)  NOT NULL,
  candidate_id     STRING(36)  NOT NULL,
  template_id      STRING(36),
  viewed_at        TIMESTAMP   NOT NULL OPTIONS (allow_commit_timestamp=true),
  user_agent       STRING(512),
  referer          STRING(512)
) PRIMARY KEY (view_id);

CREATE INDEX idx_portal_views_candidate
  ON portal_views (candidate_id, viewed_at DESC);

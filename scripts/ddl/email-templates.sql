-- ── Email Templates Table ────────────────────────────────────────
-- Database: recruitingdb (instance: game-data)
-- 
-- Stores editable email/SMS templates that the URL Hub resolves via
-- access_hub({ path: "templates/{id}" }). Replaces static template-catalog.ts
-- as the source of truth while keeping the static file as a seed fallback.
--
-- Run against recruitingdb:
--   gcloud spanner databases ddl update recruitingdb \
--     --instance=game-data \
--     --ddl-file=scripts/ddl/email-templates.sql \
--     --project=workflowos-a0fbf

CREATE TABLE email_templates (
  id            STRING(128)   NOT NULL,
  name          STRING(512)   NOT NULL,
  category      STRING(64)    NOT NULL,    -- 'outreach' | 'ops' | 'response'
  message_type  STRING(16)    NOT NULL,    -- 'email' | 'sms'
  internal_only BOOL          NOT NULL DEFAULT (false),

  -- The template structure (what the AI grounds against)
  subject_template  STRING(1024)  NOT NULL,  -- e.g. "Margin Approval: {{name}} – {{margin}}%"
  body_template     STRING(8192)  NOT NULL,  -- full body with {{placeholders}}
  to_default        STRING(512),             -- default recipient (nullable)
  cc_default        STRING(512),             -- default CC (nullable)

  -- Required fields as JSON array: ["name", "facility", "margin"]
  required_fields   STRING(2048)  NOT NULL DEFAULT ('[]'),

  -- Signature block (optional, appended to body)
  signature         STRING(2048),

  -- Metadata
  created_by    STRING(256),
  updated_by    STRING(256),
  created_at    TIMESTAMP     NOT NULL OPTIONS (allow_commit_timestamp = true),
  updated_at    TIMESTAMP     NOT NULL OPTIONS (allow_commit_timestamp = true),
  version       INT64         NOT NULL DEFAULT (1),
  is_active     BOOL          NOT NULL DEFAULT (true),
) PRIMARY KEY (id);

-- Index for category-based lookups
CREATE INDEX idx_templates_category ON email_templates(category, is_active);

-- Index for name search
CREATE INDEX idx_templates_name ON email_templates(name);

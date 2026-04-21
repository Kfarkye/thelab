-- Verdict Ledger — Architecture Decision Records
-- Shared table for AI agents (Antigravity, Codex) and humans
-- to write architectural decisions, rendered on The Lab's code page.
-- Database: recruitingdb (instance: game-data)

CREATE TABLE verdicts (
  verdict_id    STRING(36)    NOT NULL,
  agent_source  STRING(64)    NOT NULL,  -- 'antigravity', 'codex', 'human'
  category      STRING(64)    NOT NULL,  -- 'architecture', 'bug', 'refactor', 'security', 'perf', 'data'
  status        STRING(32)    NOT NULL DEFAULT ('proposed'),  -- 'proposed', 'accepted', 'rejected', 'superseded'
  title         STRING(512)   NOT NULL,
  body          STRING(MAX)   NOT NULL,  -- Full markdown content
  risk_zones    ARRAY<STRING(32)>,       -- MONEY, AUTH, ID, SHAPE, INFRA, SEC
  files_touched ARRAY<STRING(512)>,      -- File paths affected
  refs          ARRAY<STRING(1024)>,     -- External URLs, PR links, doc references
  superseded_by STRING(36),              -- Links to the verdict that replaced this one
  created_at    TIMESTAMP     NOT NULL OPTIONS (allow_commit_timestamp = true),
  updated_at    TIMESTAMP     NOT NULL OPTIONS (allow_commit_timestamp = true),
) PRIMARY KEY (verdict_id);

-- Index for listing by recency
CREATE INDEX VerdictsByCreatedAt ON verdicts(created_at DESC);

-- Index for filtering by agent
CREATE INDEX VerdictsByAgent ON verdicts(agent_source, created_at DESC);

-- Index for filtering by status
CREATE INDEX VerdictsByStatus ON verdicts(status, created_at DESC);

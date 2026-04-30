-- Migration: Recruiting QueryData audit and actor columns.
-- Apply DML backfills before tightening Packages timestamp nullability.

ALTER TABLE candidates ADD COLUMN created_by STRING(128) NOT NULL DEFAULT ('system');
ALTER TABLE candidates ADD COLUMN updated_by STRING(128) NOT NULL DEFAULT ('system');

ALTER TABLE Packages ADD COLUMN created_by STRING(128) NOT NULL DEFAULT ('system');
ALTER TABLE Packages ADD COLUMN updated_by STRING(128) NOT NULL DEFAULT ('system');

-- Run after backfilling existing Package rows where created_at/updated_at were nullable.
ALTER TABLE Packages ALTER COLUMN created_at TIMESTAMP NOT NULL;
ALTER TABLE Packages ALTER COLUMN updated_at TIMESTAMP NOT NULL;

CREATE TABLE recruiting_queries (
  query_id STRING(36) NOT NULL,
  actor_id STRING(128) NOT NULL,
  natural_language_input STRING(MAX) NOT NULL,
  generated_sql STRING(MAX) NOT NULL,
  result_count INT64 NOT NULL,
  latency_ms INT64 NOT NULL,
  created_at TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp=true),
) PRIMARY KEY(query_id);

CREATE INDEX RecruitingQueriesByActorCreatedAt
ON recruiting_queries(actor_id, created_at DESC);

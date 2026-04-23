-- scripts/ddl/interested-clicks.sql
-- Tables for the interested clicks pipeline.
-- Instance: game-data / Database: recruitingdb
--
-- Raw clicks have a 7-day retention policy (pruned by cron).
-- Daily demand rollups are permanent — used for trend analysis.

CREATE TABLE interested_clicks (
  click_id STRING(128) NOT NULL,
  candidate_name STRING(256),
  email STRING(256),
  phone STRING(64),
  job_id STRING(32),
  specialty STRING(128),
  state STRING(8),
  city STRING(128),
  clicked_at TIMESTAMP,
  raw_fields_json STRING(MAX),
  candidate_id STRING(128),
  match_status STRING(32) DEFAULT 'unmatched',
  ingested_at TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp=true)
) PRIMARY KEY (click_id);

-- For recruiter queries: "show me recent unmatched clicks"
CREATE INDEX ClicksByRecency
  ON interested_clicks(ingested_at DESC);

-- For dedup: same candidate + same job = skip
CREATE INDEX ClicksByCandidateJob
  ON interested_clicks(email, job_id);

-- For retention pruning: delete rows older than 7 days
CREATE INDEX ClicksByIngestedAt
  ON interested_clicks(ingested_at);

-- ── Daily Demand Rollups (permanent) ────────────────────────────

CREATE TABLE market_demand_daily (
  roll_date DATE NOT NULL,
  specialty STRING(128) NOT NULL,
  state STRING(8) NOT NULL,
  click_count INT64 NOT NULL,
  unique_candidates INT64 NOT NULL,
  avg_response_hours FLOAT64,
  updated_at TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp=true)
) PRIMARY KEY (roll_date, specialty, state);

-- For trend queries: demand for a specialty over time
CREATE INDEX DemandBySpecialtyDate
  ON market_demand_daily(specialty, roll_date DESC);

-- For geographic analysis: which states have highest demand
CREATE INDEX DemandByStateDate
  ON market_demand_daily(state, roll_date DESC);

-- scripts/ddl/market-jobs.sql
-- Table to store normalized job listings harvested from public SEO sitemaps.
-- Sourced from: Aya Healthcare, Medical Solutions, AMN Healthcare
-- Instance: game-data / Database: recruitingdb

CREATE TABLE market_jobs (
  source_job_id STRING(128) NOT NULL,
  source_company STRING(64) NOT NULL,
  job_type STRING(32),
  job_title STRING(256),
  specialty STRING(128),
  city STRING(128),
  state STRING(8),
  shift STRING(32),
  weekly_rate_cents INT64,
  weekly_rate_raw STRING(64),
  source_last_modified STRING(64),
  source_url STRING(MAX),
  created_at TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp=true),
  updated_at TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp=true)
) PRIMARY KEY (source_job_id, source_company);

-- Index for market analysis queries: specialty demand by state
CREATE INDEX MarketJobsBySpecialtyState
  ON market_jobs(source_company, specialty, state);

-- Index for freshness queries: most recently updated jobs
CREATE INDEX MarketJobsByRecency
  ON market_jobs(source_company, updated_at DESC);

-- Index for competitive analysis: same specialty+city across companies
CREATE INDEX MarketJobsByLocationSpecialty
  ON market_jobs(state, city, specialty, source_company);

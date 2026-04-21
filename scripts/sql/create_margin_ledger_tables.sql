-- Margin Ledger v1 tables

CREATE TABLE margin_objects (
  margin_object_id STRING(200) NOT NULL,
  candidate_id STRING(64),
  candidate_name STRING(256),
  candidate_email STRING(320),
  nova_profile_url STRING(2048),
  job_id STRING(64),
  margin_id STRING(64),
  facility_name STRING(256),
  profession STRING(128),
  specialty STRING(128),
  shift_type STRING(32),
  shift_start_hhmm STRING(5),
  shift_end_hhmm STRING(5),
  weekly_hours INT64,
  start_date DATE,
  end_date DATE,
  target_margin_pct NUMERIC,
  actual_margin_pct NUMERIC,
  base_pay_rate_usd NUMERIC,
  weekly_stipends_usd NUMERIC,
  gross_weekly_pay_usd NUMERIC,
  gross_weekly_pay_computed_usd NUMERIC,
  is_local BOOL,
  is_compact BOOL,
  source_of_truth STRING(64) NOT NULL,
  current_flag BOOL NOT NULL,
  effective_at TIMESTAMP,
  last_seen_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true),
  updated_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
) PRIMARY KEY (margin_object_id);

CREATE TABLE margin_capture_events (
  event_id STRING(128) NOT NULL,
  view_type STRING(64),
  captured_at TIMESTAMP NOT NULL,
  source_kind STRING(64) NOT NULL,
  source_url STRING(2048),
  screenshot_id STRING(256),
  rows_captured INT64 NOT NULL,
  captured_by STRING(128),
  notes STRING(MAX),
  raw_capture_json JSON,
  created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
) PRIMARY KEY (event_id);

CREATE TABLE margin_capture_links (
  event_id STRING(128) NOT NULL,
  margin_object_id STRING(200) NOT NULL,
  position_index INT64 NOT NULL,
  raw_text STRING(MAX),
  raw_json JSON,
  confidence NUMERIC,
  source_record_type STRING(64) NOT NULL,
  canonical_write_status STRING(32) NOT NULL,
  validation_errors_json JSON,
  captured_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
) PRIMARY KEY (event_id, margin_object_id, position_index);

CREATE INDEX margin_objects_by_lookup
ON margin_objects (
  current_flag,
  candidate_id,
  margin_id,
  facility_name,
  profession,
  specialty
);

CREATE INDEX margin_capture_links_by_object
ON margin_capture_links (margin_object_id, event_id);

CREATE INDEX margin_capture_events_by_source
ON margin_capture_events (source_kind, captured_at);

CREATE INDEX margin_capture_events_by_view
ON margin_capture_events (view_type, captured_at);

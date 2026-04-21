-- Fee Ledger v1 tables
-- Database: licensingdb

CREATE TABLE fee_objects (
  object_id STRING(160) NOT NULL,
  namespace STRING(16) NOT NULL,
  object_type STRING(32) NOT NULL,
  state STRING(2) NOT NULL,
  profession STRING(128) NOT NULL,
  fee_type STRING(64) NOT NULL,
  amount_usd NUMERIC NOT NULL,
  board_name STRING(256),
  source_status STRING(64) NOT NULL,
  current_flag BOOL NOT NULL,
  effective_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP OPTIONS (allow_commit_timestamp = true),
  created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
) PRIMARY KEY (object_id);

CREATE TABLE fee_capture_events (
  event_id STRING(128) NOT NULL,
  view_type STRING(64) NOT NULL,
  captured_at TIMESTAMP NOT NULL,
  source_kind STRING(64) NOT NULL,
  source_url STRING(2048),
  screenshot_id STRING(128),
  rows_captured INT64 NOT NULL,
  created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
) PRIMARY KEY (event_id);

CREATE TABLE fee_capture_links (
  event_id STRING(128) NOT NULL,
  position_index INT64 NOT NULL,
  object_id STRING(160) NOT NULL,
  raw_text STRING(MAX),
  confidence NUMERIC,
  source_row_json STRING(MAX) NOT NULL,
  captured_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
) PRIMARY KEY (event_id, position_index);

CREATE INDEX fee_objects_by_lookup
ON fee_objects (state, profession, fee_type, current_flag);

CREATE INDEX fee_capture_links_by_object
ON fee_capture_links (object_id, event_id);

CREATE INDEX fee_capture_events_by_view
ON fee_capture_events (view_type, captured_at);

CREATE INDEX fee_capture_events_by_source
ON fee_capture_events (source_kind, captured_at);

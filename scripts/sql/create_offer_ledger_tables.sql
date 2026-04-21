-- Offer Ledger v1 tables
-- Database: recruitingdb

CREATE TABLE offer_objects (
  offer_id STRING(200) NOT NULL,
  candidate_id STRING(64),
  candidate_name STRING(256),
  candidate_email STRING(320),
  nova_profile_url STRING(2048),
  job_id STRING(64),
  margin_id STRING(64),
  facility_name STRING(256),
  profession STRING(128),
  specialty STRING(128),
  contract_type STRING(64),
  offer_status STRING(64) NOT NULL,
  verbally_accepted BOOL,
  assigned_recruiter STRING(128),
  source_of_truth STRING(64) NOT NULL,
  current_flag BOOL NOT NULL,
  effective_at TIMESTAMP,
  last_seen_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true),
  updated_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
) PRIMARY KEY (offer_id);

CREATE TABLE offer_capture_events (
  event_id STRING(128) NOT NULL,
  view_type STRING(64),
  captured_at TIMESTAMP NOT NULL,
  source_kind STRING(64) NOT NULL,
  source_url STRING(2048),
  resource_type STRING(64),
  request_method STRING(16),
  endpoint_path STRING(512),
  response_hash STRING(128),
  rows_captured INT64 NOT NULL,
  captured_by STRING(128),
  notes STRING(MAX),
  raw_response_json JSON,
  created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
) PRIMARY KEY (event_id);

CREATE TABLE offer_capture_links (
  event_id STRING(128) NOT NULL,
  offer_id STRING(200) NOT NULL,
  position_index INT64 NOT NULL,
  raw_text STRING(MAX),
  raw_json JSON,
  confidence NUMERIC,
  screen_section STRING(128),
  source_record_type STRING(64) NOT NULL,
  captured_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
) PRIMARY KEY (event_id, offer_id, position_index);

CREATE INDEX offer_objects_by_lookup
ON offer_objects (current_flag, offer_status, candidate_id, facility_name, profession, specialty);

CREATE INDEX offer_capture_links_by_offer
ON offer_capture_links (offer_id, event_id);

CREATE INDEX offer_capture_events_by_source
ON offer_capture_events (source_kind, captured_at);

CREATE INDEX offer_capture_events_by_view
ON offer_capture_events (view_type, captured_at);

-- RingCentral Thread Ledger v1

CREATE TABLE rc_thread_objects (
  thread_id STRING(200) NOT NULL,
  candidate_id STRING(64),
  candidate_name STRING(256),
  thread_source STRING(128) NOT NULL,
  participants_json JSON,
  latest_inbound_message STRING(MAX),
  latest_outbound_message STRING(MAX),
  latest_message_at TIMESTAMP,
  unresolved_flag BOOL NOT NULL,
  unresolved_identity_hash STRING(128) NOT NULL,
  source_url STRING(2048),
  unknowns_json JSON,
  first_seen_at TIMESTAMP NOT NULL,
  last_seen_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true),
  updated_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
) PRIMARY KEY (thread_id);

CREATE TABLE rc_thread_capture_events (
  event_id STRING(128) NOT NULL,
  thread_id STRING(200) NOT NULL,
  captured_at TIMESTAMP NOT NULL,
  ingested_at TIMESTAMP OPTIONS (allow_commit_timestamp = true),
  raw_payload_json JSON,
  rows_captured INT64 NOT NULL,
  source_name STRING(128) NOT NULL,
  source_kind STRING(64) NOT NULL,
  validation_errors_json JSON
) PRIMARY KEY (event_id);

CREATE TABLE rc_thread_capture_links (
  event_id STRING(128) NOT NULL,
  object_type STRING(64) NOT NULL,
  object_id STRING(200) NOT NULL,
  write_status STRING(32) NOT NULL,
  confidence NUMERIC,
  notes STRING(MAX),
  created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
) PRIMARY KEY (event_id, object_type, object_id);

CREATE TABLE rc_thread_messages (
  thread_id STRING(200) NOT NULL,
  event_id STRING(128) NOT NULL,
  message_order INT64 NOT NULL,
  direction STRING(32),
  sender STRING(256),
  timestamp_if_visible STRING(128),
  exact_text STRING(MAX),
  truncated BOOL,
  created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
) PRIMARY KEY (thread_id, event_id, message_order);

CREATE INDEX rc_thread_objects_by_candidate
ON rc_thread_objects (candidate_id, unresolved_flag, last_seen_at);

CREATE INDEX rc_thread_objects_by_unresolved_hash
ON rc_thread_objects (unresolved_identity_hash, last_seen_at);

CREATE INDEX rc_thread_capture_events_by_thread
ON rc_thread_capture_events (thread_id, captured_at);

CREATE INDEX rc_thread_capture_events_by_source
ON rc_thread_capture_events (source_kind, captured_at);

CREATE INDEX rc_thread_messages_by_thread
ON rc_thread_messages (thread_id, message_order);

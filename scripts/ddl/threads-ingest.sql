-- scripts/ddl/threads-ingest.sql

-- Option A: Fresh Setup
-- CREATE TABLE Threads (
--   thread_id STRING(128) NOT NULL,
--   thread_url STRING(MAX),
--   candidate_name_raw STRING(256),
--   candidate_phone_raw STRING(64),
--   normalized_phone STRING(32),
--   location STRING(128),
--   facility_name STRING(256),
--   intent_tags_json STRING(MAX),
--   recommended_next_step STRING(MAX),
--   
--   candidate_match_status STRING(32),
--   matched_candidate_id STRING(128),
--   matched_candidate_name STRING(256),
--   match_score INT64,
--   match_reason STRING(MAX),
--   candidate_match_candidates_json STRING(MAX),
--   resolved_by_user STRING(128),
--   resolved_at TIMESTAMP,
--   
--   first_seen_at TIMESTAMP OPTIONS (allow_commit_timestamp=true),
--   last_seen_at TIMESTAMP OPTIONS (allow_commit_timestamp=true)
-- ) PRIMARY KEY (thread_id);

-- Option B: Alter Existing
-- ALTER TABLE Threads ADD COLUMN thread_url STRING(MAX);
-- ALTER TABLE Threads ADD COLUMN candidate_name_raw STRING(256);
-- ALTER TABLE Threads ADD COLUMN candidate_phone_raw STRING(64);
-- ALTER TABLE Threads ADD COLUMN normalized_phone STRING(32);
-- ALTER TABLE Threads ADD COLUMN location STRING(128);
-- ALTER TABLE Threads ADD COLUMN facility_name STRING(256);
-- ALTER TABLE Threads ADD COLUMN intent_tags_json STRING(MAX);
-- ALTER TABLE Threads ADD COLUMN recommended_next_step STRING(MAX);
-- ALTER TABLE Threads ADD COLUMN candidate_match_status STRING(32);
-- ALTER TABLE Threads ADD COLUMN matched_candidate_id STRING(128);
-- ALTER TABLE Threads ADD COLUMN matched_candidate_name STRING(256);
-- ALTER TABLE Threads ADD COLUMN match_score INT64;
-- ALTER TABLE Threads ADD COLUMN match_reason STRING(MAX);
-- ALTER TABLE Threads ADD COLUMN candidate_match_candidates_json STRING(MAX);
-- ALTER TABLE Threads ADD COLUMN resolved_by_user STRING(128);
-- ALTER TABLE Threads ADD COLUMN resolved_at TIMESTAMP;
-- ALTER TABLE Threads ADD COLUMN first_seen_at TIMESTAMP OPTIONS (allow_commit_timestamp=true);
-- ALTER TABLE Threads ADD COLUMN last_seen_at TIMESTAMP OPTIONS (allow_commit_timestamp=true);

CREATE TABLE ThreadCandidateMatchEvents (
  match_event_id STRING(128) NOT NULL,
  thread_id STRING(128) NOT NULL,
  candidate_id STRING(128),
  match_status STRING(32) NOT NULL,
  match_score INT64,
  match_reason STRING(MAX),
  created_by STRING(128) NOT NULL,
  created_at TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp=true)
) PRIMARY KEY (match_event_id);

CREATE TABLE CandidatePhoneAliases (
  candidate_id STRING(128) NOT NULL,
  normalized_phone STRING(32) NOT NULL,
  raw_phone STRING(64),
  source STRING(64),
  created_by STRING(128),
  created_at TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp=true)
) PRIMARY KEY (candidate_id, normalized_phone);

CREATE INDEX ThreadsByStatusRecency ON Threads(candidate_match_status, last_seen_at DESC);
CREATE INDEX ThreadsByCandidateRecency ON Threads(matched_candidate_id, last_seen_at DESC);

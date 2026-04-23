-- scripts/ddl/candidates-patch.sql
-- Candidate-side DDL patch for matcher query compatibility.
-- Run against: recruitingdb on instance game-data

-- 1. Ensure matcher assumptions exist on the Candidates table
-- (Spanner doesn't support IF NOT EXISTS for columns, so run these only if missing)
-- ALTER TABLE candidates ADD COLUMN location STRING(128);
-- ALTER TABLE candidates ADD COLUMN facility_name STRING(256);

-- 2. Hot-path indexes for the Matcher's exact queries
CREATE INDEX CandidatesByNormalizedPhone ON candidates(normalized_phone);
CREATE INDEX CandidatePhoneAliasesByPhone ON CandidatePhoneAliases(normalized_phone);

-- 3. Fast-path index for the Audit UI (prevent table scans when viewing history)
CREATE INDEX ThreadMatchEventsByThread ON ThreadCandidateMatchEvents(thread_id, created_at DESC);

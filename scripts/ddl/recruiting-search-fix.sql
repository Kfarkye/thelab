-- scripts/ddl/recruiting-search-fix.sql
-- Fixes missing Packages table and search substrate for Candidates.

CREATE TABLE Packages (
  package_id STRING(128) NOT NULL,
  location_point GEOGRAPHY,
  facility_name STRING(256),
  profession STRING(128),
  specialty STRING(128),
  created_at TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp=true),
  updated_at TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp=true)
) PRIMARY KEY (package_id);

ALTER TABLE candidates ADD COLUMN candidate_name STRING(256);
ALTER TABLE candidates ADD COLUMN nova_url STRING(MAX);
ALTER TABLE candidates ADD COLUMN home_location GEOGRAPHY;
ALTER TABLE candidates ADD COLUMN search_tokens TOKENLIST
  AS (TOKENIZE_FULLTEXT(CONCAT(COALESCE(specialty, ''), ' ', COALESCE(profession, ''), ' ', COALESCE(candidate_name, ''))))
  STORED HIDDEN;

CREATE SEARCH INDEX CandidatesSearchIndex ON candidates(search_tokens)
  STORING (candidate_name, nova_url, status);

-- Migration: Add canonical matcher search substrate to hc_candidates.
-- The legacy candidates table remains untouched and deprecated.

ALTER TABLE hc_candidates ADD COLUMN latitude FLOAT64;
ALTER TABLE hc_candidates ADD COLUMN longitude FLOAT64;
ALTER TABLE hc_candidates ADD COLUMN status STRING(30) NOT NULL DEFAULT ('ACTIVE');
ALTER TABLE hc_candidates ADD COLUMN created_by STRING(128) NOT NULL DEFAULT ('system');
ALTER TABLE hc_candidates ADD COLUMN updated_by STRING(128) NOT NULL DEFAULT ('system');

ALTER TABLE hc_candidates ALTER COLUMN created_at SET OPTIONS (allow_commit_timestamp=true);
ALTER TABLE hc_candidates ALTER COLUMN updated_at SET OPTIONS (allow_commit_timestamp=true);

ALTER TABLE hc_candidates ADD COLUMN search_tokens TOKENLIST
  AS (
    TOKENIZE_FULLTEXT(
      CONCAT(
        COALESCE(specialty, ''),
        ' ',
        COALESCE(sub_specialty, ''),
        ' ',
        COALESCE(profession, ''),
        ' ',
        COALESCE(first_name, ''),
        ' ',
        COALESCE(last_name, '')
      )
    )
  )
  STORED HIDDEN;

CREATE SEARCH INDEX hc_CandidatesSearchIndex ON hc_candidates(search_tokens)
  STORING (first_name, last_name, nova_id, status, specialty, profession, home_city, home_state, latitude, longitude);

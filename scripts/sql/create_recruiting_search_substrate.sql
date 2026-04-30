-- Migration: Add Spanner Search substrate to Candidates.
-- Requirement: Spanner Enterprise or Enterprise Plus edition.
-- Enable the columnar engine before relying on @{SCAN_METHOD=COLUMNAR}.

ALTER TABLE Candidates ADD COLUMN search_tokens TOKENLIST
  AS (
    TOKENIZE_FULLTEXT(
      CONCAT(
        COALESCE(normalized_specialty, ''),
        ' ',
        COALESCE(candidate_bio, '')
      )
    )
  )
  STORED HIDDEN;

CREATE SEARCH INDEX CandidatesSearchIndex ON Candidates(search_tokens)
  STORING (candidate_name, nova_url, status);

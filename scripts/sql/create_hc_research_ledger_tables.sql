-- Healthcare Research Ledger (approval-first)
-- Database: licensingdb

CREATE TABLE hc_research_objects (
  object_id STRING(160) NOT NULL,
  category STRING(32) NOT NULL,
  state STRING(2) NOT NULL,
  profession STRING(128) NOT NULL,
  current_snapshot_id STRING(180) NOT NULL,
  last_verified_at TIMESTAMP NOT NULL,
  current_summary_json STRING(MAX) NOT NULL,
  updated_at TIMESTAMP OPTIONS (allow_commit_timestamp = true),
  created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
) PRIMARY KEY (object_id);

CREATE TABLE hc_research_snapshots (
  snapshot_id STRING(180) NOT NULL,
  object_id STRING(160) NOT NULL,
  approved_at TIMESTAMP NOT NULL,
  approved_by STRING(128) NOT NULL,
  search_queries_json STRING(MAX) NOT NULL,
  source_refs_json STRING(MAX) NOT NULL,
  raw_answer_json STRING(MAX) NOT NULL,
  normalized_facts_json STRING(MAX) NOT NULL,
  approval_note STRING(MAX),
  created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
) PRIMARY KEY (snapshot_id);

CREATE TABLE hc_research_diffs (
  diff_id STRING(180) NOT NULL,
  object_id STRING(160) NOT NULL,
  from_snapshot_id STRING(180),
  to_snapshot_id STRING(180) NOT NULL,
  changed_fields_json STRING(MAX) NOT NULL,
  change_summary STRING(MAX) NOT NULL,
  has_material_change BOOL NOT NULL,
  created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
) PRIMARY KEY (diff_id);

CREATE INDEX hc_research_objects_by_lookup
ON hc_research_objects (state, profession, category);

CREATE INDEX hc_research_snapshots_by_object
ON hc_research_snapshots (object_id, approved_at DESC);

CREATE INDEX hc_research_diffs_by_object
ON hc_research_diffs (object_id, created_at DESC);

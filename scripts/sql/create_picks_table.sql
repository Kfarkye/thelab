CREATE TABLE Picks (
  pick_id STRING(96) NOT NULL,
  brief_id STRING(96),
  game_id STRING(96) NOT NULL,
  sport STRING(16) NOT NULL,
  market_type STRING(48) NOT NULL,
  subject_type STRING(24),
  subject_name STRING(128),
  subject_team STRING(16),
  side STRING(16) NOT NULL,
  line FLOAT64 NOT NULL,
  odds_american INT64 DEFAULT (-110),
  stake_units FLOAT64 DEFAULT (1.0),
  display STRING(256) NOT NULL,
  kicker STRING(48),
  rationale STRING(280),
  priority_band STRING(16),
  event_status STRING(24),
  grading_status STRING(24),
  settlement_value FLOAT64,
  units_result FLOAT64,
  closing_line FLOAT64,
  live_data JSON,
  live_data_updated_at TIMESTAMP,
  public_payload JSON,
  internal_payload JSON,
  created_at TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp=true),
  updated_at TIMESTAMP OPTIONS (allow_commit_timestamp=true),
  line_observed_at TIMESTAMP,
  graded_at TIMESTAMP
) PRIMARY KEY (pick_id);

CREATE TABLE PickGradeEvents (
  pick_id STRING(96) NOT NULL,
  event_id STRING(128) NOT NULL,
  event_type STRING(32) NOT NULL, -- GRADED, REVISED, VOIDED, MANUAL_OVERRIDE
  previous_grading_status STRING(24),
  new_grading_status STRING(24),
  settlement_value FLOAT64,
  units_result FLOAT64,
  source_payload JSON,
  actor STRING(64),
  created_at TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp=true)
) PRIMARY KEY (pick_id, event_id),
  INTERLEAVE IN PARENT Picks ON DELETE CASCADE;

CREATE INDEX PicksByBriefCreatedAt
ON Picks (brief_id, created_at DESC);

CREATE INDEX PicksByGameCreatedAt
ON Picks (game_id, created_at DESC);

CREATE INDEX PicksByEventAndGrade
ON Picks (event_status, grading_status, created_at DESC);

CREATE TABLE EntityRoutes (
  CanonicalRoute STRING(MAX) NOT NULL, -- e.g., /candidates/alex-v
  EntityId STRING(36) NOT NULL,        -- AYA.CAND.842193
  RulesetCommit STRING(MAX) NOT NULL,  -- Git HEAD hash
  BarTalkSummary JSON NOT NULL,        -- Grounding payload (No AI Smell)
  UpdatedAt TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp=true)
) PRIMARY KEY (CanonicalRoute);

CREATE UNIQUE INDEX idx_entity_id ON EntityRoutes(EntityId);

CREATE TABLE ephemeral_artifacts (
  artifact_id STRING(36) NOT NULL,
  actor_id STRING(256) NOT NULL,
  intent_json STRING(MAX),
  generated_code STRING(MAX) NOT NULL,
  preview_html STRING(MAX) NOT NULL,
  raw_destination STRING(512),
  proposed_destination STRING(512),
  status STRING(32) NOT NULL,
  violations_json STRING(MAX),
  error_json STRING(MAX),
  commit_sha STRING(128),
  created_at TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp=true),
  resolved_at TIMESTAMP OPTIONS (allow_commit_timestamp=true),
  expires_at TIMESTAMP NOT NULL,
) PRIMARY KEY (artifact_id);

CREATE INDEX EphemeralArtifactsByActorStatus
ON ephemeral_artifacts(actor_id, status, created_at DESC);

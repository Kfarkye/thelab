-- The operational truth
CREATE TABLE Candidates (
  CandidateId STRING(36) NOT NULL,
  RawProfile JSON,
  UpdatedAt TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp=true),
) PRIMARY KEY (CandidateId);

-- The Change Stream (The Mutation Signal)
CREATE CHANGE STREAM CandidateStream 
FOR Candidates(RawProfile, UpdatedAt);

-- The Agent's World Model (Metadata for artifacts in GCS)
CREATE TABLE ContextArtifacts (
  ArtifactId STRING(MAX) NOT NULL,
  SourceId STRING(36) NOT NULL,
  ProjectionName STRING(MAX) NOT NULL, -- e.g., 'matching_v1'
  StorageUri STRING(MAX) NOT NULL,    -- gs://aya-context/path/to.json
  FreshnessClass STRING(MAX),         -- 'near_real_time'
  GeneratedAt TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp=true),
) PRIMARY KEY (ArtifactId);

-- Repo-grounded retrieval substrate.
-- Note: Spanner primary-key and index key columns must use bounded STRING lengths.

CREATE TABLE RepoChunks (
  ChunkId STRING(128) NOT NULL,
  Repo STRING(256) NOT NULL,
  Branch STRING(256) NOT NULL,
  CommitSha STRING(64) NOT NULL,
  SourceBlobSha STRING(64) NOT NULL,
  Path STRING(1024) NOT NULL,
  LineStart INT64 NOT NULL,
  LineEnd INT64 NOT NULL,
  ChunkType STRING(64) NOT NULL,
  Language STRING(64),
  Symbol STRING(512),
  Content STRING(MAX) NOT NULL,
  ContentHash STRING(64) NOT NULL,
  GovernanceRefs ARRAY<STRING(MAX)>,
  IndexedAt TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp=true),
  DeletedAt TIMESTAMP OPTIONS (allow_commit_timestamp=true)
) PRIMARY KEY (ChunkId);

CREATE INDEX RepoChunksByCommit ON RepoChunks (Repo, CommitSha, Path);
CREATE INDEX RepoChunksByPath ON RepoChunks (Repo, Path, IndexedAt DESC);

CREATE TABLE ReindexJobs (
  JobId STRING(64) NOT NULL,
  Repo STRING(256) NOT NULL,
  CommitSha STRING(64) NOT NULL,
  Status STRING(32) NOT NULL,
  StartedAt TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp=true),
  CompletedAt TIMESTAMP OPTIONS (allow_commit_timestamp=true),
  Error STRING(MAX)
) PRIMARY KEY (JobId);

-- Evidence image metadata table (credentialdb)
-- Run in Spanner database: credentialdb

CREATE TABLE saved_images (
  image_id STRING(128) NOT NULL,
  storage_path STRING(512) NOT NULL,
  thumbnail_path STRING(512),
  candidate_id STRING(64),
  source_type STRING(64) NOT NULL,
  screen_type STRING(64),
  mode STRING(32),
  mime_type STRING(128) NOT NULL,
  uploaded_by STRING(128),
  conversation_id STRING(128),
  is_pinned BOOL NOT NULL DEFAULT (FALSE),
  tags_json STRING(MAX),
  last_used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp = true),
) PRIMARY KEY (image_id);

CREATE INDEX saved_images_by_recency
ON saved_images (is_pinned, created_at DESC);

CREATE INDEX saved_images_by_candidate
ON saved_images (candidate_id, created_at DESC);

CREATE INDEX saved_images_by_conversation
ON saved_images (conversation_id, created_at DESC);

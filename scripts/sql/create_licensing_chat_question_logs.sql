CREATE TABLE licensing_chat_question_logs (
  page_url STRING(2048) NOT NULL,
  user_question STRING(4000) NOT NULL,
  was_suggested BOOL NOT NULL,
  visit_timestamp TIMESTAMP NOT NULL,
  resolved_entity_id STRING(256),
  created_at TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp=true)
) PRIMARY KEY (visit_timestamp, page_url, user_question);

CREATE INDEX licensing_chat_question_logs_by_page_created
ON licensing_chat_question_logs (page_url, created_at DESC);

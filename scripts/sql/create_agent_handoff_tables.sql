-- Agent handoff middleware tables (recruitingdb)
-- Wrapper task surface for browser-agent execution against Nova URLs.

CREATE TABLE agent_handoff_tasks (
  task_id STRING(128) NOT NULL,
  ledger_id STRING(128) NOT NULL,
  status STRING(32) NOT NULL,
  target_url STRING(2048) NOT NULL,
  source_surface STRING(64) NOT NULL,
  goal STRING(MAX) NOT NULL,
  instructions_json JSON NOT NULL,
  expected_return_schema_json JSON NOT NULL,
  context_json JSON,
  auto_launch BOOL NOT NULL,
  created_by STRING(128) NOT NULL,
  sandbox_task_id STRING(128),
  conversation_id STRING(128),
  mode STRING(64),
  result_json JSON,
  result_summary STRING(MAX),
  error_code STRING(64),
  error_message STRING(MAX),
  created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true),
  opened_at TIMESTAMP,
  completed_at TIMESTAMP,
  updated_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
) PRIMARY KEY (task_id);

CREATE INDEX agent_handoff_tasks_by_status
ON agent_handoff_tasks (status, created_at DESC);

CREATE INDEX agent_handoff_tasks_by_sandbox
ON agent_handoff_tasks (sandbox_task_id, created_at DESC);

CREATE INDEX agent_handoff_tasks_by_conversation
ON agent_handoff_tasks (conversation_id, created_at DESC);

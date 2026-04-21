import { Spanner } from "@google-cloud/spanner";

const SPANNER_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "workflowos-a0fbf";
const SPANNER_INSTANCE_ID = "game-data";
const SPANNER_DATABASE_ID = "recruitingdb";

const TABLE_DDLS: Array<{ name: string; ddl: string }> = [
  {
    name: "agent_handoff_tasks",
    ddl: `CREATE TABLE agent_handoff_tasks (
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
    ) PRIMARY KEY (task_id)`,
  },
];

const INDEX_DDLS: Array<{ name: string; ddl: string }> = [
  {
    name: "agent_handoff_tasks_by_status",
    ddl: `CREATE INDEX agent_handoff_tasks_by_status ON agent_handoff_tasks (status, created_at DESC)`,
  },
  {
    name: "agent_handoff_tasks_by_sandbox",
    ddl: `CREATE INDEX agent_handoff_tasks_by_sandbox ON agent_handoff_tasks (sandbox_task_id, created_at DESC)`,
  },
  {
    name: "agent_handoff_tasks_by_conversation",
    ddl: `CREATE INDEX agent_handoff_tasks_by_conversation ON agent_handoff_tasks (conversation_id, created_at DESC)`,
  },
];

async function main() {
  const spanner = new Spanner({ projectId: SPANNER_PROJECT_ID });
  const db = spanner.instance(SPANNER_INSTANCE_ID).database(SPANNER_DATABASE_ID);

  try {
    const [tableRows] = await db.run({
      sql: `SELECT TABLE_NAME
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = ''
              AND TABLE_NAME IN ('agent_handoff_tasks')`,
    });

    const [indexRows] = await db.run({
      sql: `SELECT INDEX_NAME
            FROM INFORMATION_SCHEMA.INDEXES
            WHERE TABLE_SCHEMA = ''
              AND INDEX_NAME IN (
                'agent_handoff_tasks_by_status',
                'agent_handoff_tasks_by_sandbox',
                'agent_handoff_tasks_by_conversation'
              )`,
    });

    const existingTables = new Set(tableRows.map((row) => String(row.toJSON().TABLE_NAME)));
    const existingIndexes = new Set(indexRows.map((row) => String(row.toJSON().INDEX_NAME)));

    const statements: string[] = [];
    for (const table of TABLE_DDLS) {
      if (!existingTables.has(table.name)) statements.push(table.ddl);
    }
    for (const index of INDEX_DDLS) {
      if (!existingIndexes.has(index.name)) statements.push(index.ddl);
    }

    if (statements.length === 0) {
      console.log("No DDL changes needed (agent handoff tables and indexes already exist)");
      return;
    }

    const [operation] = await db.updateSchema(statements);
    await operation.promise();
    console.log(`Applied ${statements.length} agent-handoff DDL statement(s)`);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error("agent-handoff-ddl failed:", error);
  process.exit(1);
});

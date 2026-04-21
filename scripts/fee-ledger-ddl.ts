import { Spanner } from "@google-cloud/spanner";

const SPANNER_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "workflowos-a0fbf";
const SPANNER_INSTANCE_ID = "game-data";
const SPANNER_DATABASE_ID = "licensingdb";

const TABLE_DDLS: Array<{ name: string; ddl: string }> = [
  {
    name: "fee_objects",
    ddl: `CREATE TABLE fee_objects (
      object_id STRING(160) NOT NULL,
      namespace STRING(16) NOT NULL,
      object_type STRING(32) NOT NULL,
      state STRING(2) NOT NULL,
      profession STRING(128) NOT NULL,
      fee_type STRING(64) NOT NULL,
      amount_usd NUMERIC NOT NULL,
      board_name STRING(256),
      source_status STRING(64) NOT NULL,
      current_flag BOOL NOT NULL,
      effective_at TIMESTAMP NOT NULL,
      updated_at TIMESTAMP OPTIONS (allow_commit_timestamp = true),
      created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
    ) PRIMARY KEY (object_id)`,
  },
  {
    name: "fee_capture_events",
    ddl: `CREATE TABLE fee_capture_events (
      event_id STRING(128) NOT NULL,
      view_type STRING(64) NOT NULL,
      captured_at TIMESTAMP NOT NULL,
      source_kind STRING(64) NOT NULL,
      source_url STRING(2048),
      screenshot_id STRING(128),
      rows_captured INT64 NOT NULL,
      created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
    ) PRIMARY KEY (event_id)`,
  },
  {
    name: "fee_capture_links",
    ddl: `CREATE TABLE fee_capture_links (
      event_id STRING(128) NOT NULL,
      position_index INT64 NOT NULL,
      object_id STRING(160) NOT NULL,
      raw_text STRING(MAX),
      confidence NUMERIC,
      source_row_json STRING(MAX) NOT NULL,
      captured_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
    ) PRIMARY KEY (event_id, position_index)`,
  },
];

const INDEX_DDLS: Array<{ name: string; ddl: string }> = [
  {
    name: "fee_objects_by_lookup",
    ddl: `CREATE INDEX fee_objects_by_lookup ON fee_objects (state, profession, fee_type, current_flag)`,
  },
  {
    name: "fee_capture_links_by_object",
    ddl: `CREATE INDEX fee_capture_links_by_object ON fee_capture_links (object_id, event_id)`,
  },
  {
    name: "fee_capture_events_by_view",
    ddl: `CREATE INDEX fee_capture_events_by_view ON fee_capture_events (view_type, captured_at)`,
  },
  {
    name: "fee_capture_events_by_source",
    ddl: `CREATE INDEX fee_capture_events_by_source ON fee_capture_events (source_kind, captured_at)`,
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
              AND TABLE_NAME IN ('fee_objects', 'fee_capture_events', 'fee_capture_links')`,
    });

    const [indexRows] = await db.run({
      sql: `SELECT INDEX_NAME
            FROM INFORMATION_SCHEMA.INDEXES
            WHERE TABLE_SCHEMA = ''
              AND INDEX_NAME IN (
                'fee_objects_by_lookup',
                'fee_capture_links_by_object',
                'fee_capture_events_by_view',
                'fee_capture_events_by_source'
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
      console.log("No DDL changes needed (fee ledger tables and indexes already exist)");
      return;
    }

    const [operation] = await db.updateSchema(statements);
    await operation.promise();
    console.log(`Applied ${statements.length} fee-ledger DDL statement(s)`);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error("fee-ledger-ddl failed:", error);
  process.exit(1);
});

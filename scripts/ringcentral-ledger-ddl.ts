import { Spanner } from "@google-cloud/spanner";

const SPANNER_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "workflowos-a0fbf";
const SPANNER_INSTANCE_ID = "game-data";
const SPANNER_DATABASE_ID = "recruitingdb";

const TABLE_DDLS: Array<{ name: string; ddl: string }> = [
  {
    name: "rc_thread_objects",
    ddl: `CREATE TABLE rc_thread_objects (
      thread_id STRING(200) NOT NULL,
      candidate_id STRING(64),
      candidate_name STRING(256),
      thread_source STRING(128) NOT NULL,
      participants_json JSON,
      latest_inbound_message STRING(MAX),
      latest_outbound_message STRING(MAX),
      latest_message_at TIMESTAMP,
      unresolved_flag BOOL NOT NULL,
      unresolved_identity_hash STRING(128) NOT NULL,
      source_url STRING(2048),
      unknowns_json JSON,
      first_seen_at TIMESTAMP NOT NULL,
      last_seen_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true),
      updated_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
    ) PRIMARY KEY (thread_id)`,
  },
  {
    name: "rc_thread_capture_events",
    ddl: `CREATE TABLE rc_thread_capture_events (
      event_id STRING(128) NOT NULL,
      thread_id STRING(200) NOT NULL,
      captured_at TIMESTAMP NOT NULL,
      ingested_at TIMESTAMP OPTIONS (allow_commit_timestamp = true),
      raw_payload_json JSON,
      rows_captured INT64 NOT NULL,
      source_name STRING(128) NOT NULL,
      source_kind STRING(64) NOT NULL,
      validation_errors_json JSON
    ) PRIMARY KEY (event_id)`,
  },
  {
    name: "rc_thread_capture_links",
    ddl: `CREATE TABLE rc_thread_capture_links (
      event_id STRING(128) NOT NULL,
      object_type STRING(64) NOT NULL,
      object_id STRING(200) NOT NULL,
      write_status STRING(32) NOT NULL,
      confidence NUMERIC,
      notes STRING(MAX),
      created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
    ) PRIMARY KEY (event_id, object_type, object_id)`,
  },
  {
    name: "rc_thread_messages",
    ddl: `CREATE TABLE rc_thread_messages (
      thread_id STRING(200) NOT NULL,
      event_id STRING(128) NOT NULL,
      message_order INT64 NOT NULL,
      direction STRING(32),
      sender STRING(256),
      timestamp_if_visible STRING(128),
      exact_text STRING(MAX),
      truncated BOOL,
      created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
    ) PRIMARY KEY (thread_id, event_id, message_order)`,
  },
];

const INDEX_DDLS: Array<{ name: string; ddl: string }> = [
  {
    name: "rc_thread_objects_by_candidate",
    ddl: `CREATE INDEX rc_thread_objects_by_candidate ON rc_thread_objects (candidate_id, unresolved_flag, last_seen_at)`,
  },
  {
    name: "rc_thread_objects_by_unresolved_hash",
    ddl: `CREATE INDEX rc_thread_objects_by_unresolved_hash ON rc_thread_objects (unresolved_identity_hash, last_seen_at)`,
  },
  {
    name: "rc_thread_capture_events_by_thread",
    ddl: `CREATE INDEX rc_thread_capture_events_by_thread ON rc_thread_capture_events (thread_id, captured_at)`,
  },
  {
    name: "rc_thread_capture_events_by_source",
    ddl: `CREATE INDEX rc_thread_capture_events_by_source ON rc_thread_capture_events (source_kind, captured_at)`,
  },
  {
    name: "rc_thread_messages_by_thread",
    ddl: `CREATE INDEX rc_thread_messages_by_thread ON rc_thread_messages (thread_id, message_order)`,
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
              AND TABLE_NAME IN (
                'rc_thread_objects',
                'rc_thread_capture_events',
                'rc_thread_capture_links',
                'rc_thread_messages'
              )`,
    });

    const [indexRows] = await db.run({
      sql: `SELECT INDEX_NAME
            FROM INFORMATION_SCHEMA.INDEXES
            WHERE TABLE_SCHEMA = ''
              AND INDEX_NAME IN (
                'rc_thread_objects_by_candidate',
                'rc_thread_objects_by_unresolved_hash',
                'rc_thread_capture_events_by_thread',
                'rc_thread_capture_events_by_source',
                'rc_thread_messages_by_thread'
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
      console.log("No DDL changes needed (RingCentral ledger tables and indexes already exist)");
      return;
    }

    const [operation] = await db.updateSchema(statements);
    await operation.promise();
    console.log(`Applied ${statements.length} RingCentral ledger DDL statement(s)`);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error("ringcentral-ledger-ddl failed:", error);
  process.exit(1);
});

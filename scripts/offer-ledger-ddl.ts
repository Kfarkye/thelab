import { Spanner } from "@google-cloud/spanner";

const SPANNER_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "workflowos-a0fbf";
const SPANNER_INSTANCE_ID = "game-data";
const SPANNER_DATABASE_ID = "recruitingdb";

const TABLE_DDLS: Array<{ name: string; ddl: string }> = [
  {
    name: "offer_objects",
    ddl: `CREATE TABLE offer_objects (
      offer_id STRING(200) NOT NULL,
      candidate_id STRING(64),
      candidate_name STRING(256),
      candidate_email STRING(320),
      nova_profile_url STRING(2048),
      job_id STRING(64),
      margin_id STRING(64),
      facility_name STRING(256),
      profession STRING(128),
      specialty STRING(128),
      contract_type STRING(64),
      offer_status STRING(64) NOT NULL,
      verbally_accepted BOOL,
      assigned_recruiter STRING(128),
      source_of_truth STRING(64) NOT NULL,
      current_flag BOOL NOT NULL,
      effective_at TIMESTAMP,
      last_seen_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true),
      updated_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
    ) PRIMARY KEY (offer_id)`,
  },
  {
    name: "offer_capture_events",
    ddl: `CREATE TABLE offer_capture_events (
      event_id STRING(128) NOT NULL,
      view_type STRING(64),
      captured_at TIMESTAMP NOT NULL,
      source_kind STRING(64) NOT NULL,
      source_url STRING(2048),
      resource_type STRING(64),
      request_method STRING(16),
      endpoint_path STRING(512),
      response_hash STRING(128),
      rows_captured INT64 NOT NULL,
      captured_by STRING(128),
      notes STRING(MAX),
      raw_response_json JSON,
      created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
    ) PRIMARY KEY (event_id)`,
  },
  {
    name: "offer_capture_links",
    ddl: `CREATE TABLE offer_capture_links (
      event_id STRING(128) NOT NULL,
      offer_id STRING(200) NOT NULL,
      position_index INT64 NOT NULL,
      raw_text STRING(MAX),
      raw_json JSON,
      confidence NUMERIC,
      screen_section STRING(128),
      source_record_type STRING(64) NOT NULL,
      captured_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
    ) PRIMARY KEY (event_id, offer_id, position_index)`,
  },
];

const INDEX_DDLS: Array<{ name: string; ddl: string }> = [
  {
    name: "offer_objects_by_lookup",
    ddl: `CREATE INDEX offer_objects_by_lookup ON offer_objects (current_flag, offer_status, candidate_id, facility_name, profession, specialty)`,
  },
  {
    name: "offer_capture_links_by_offer",
    ddl: `CREATE INDEX offer_capture_links_by_offer ON offer_capture_links (offer_id, event_id)`,
  },
  {
    name: "offer_capture_events_by_source",
    ddl: `CREATE INDEX offer_capture_events_by_source ON offer_capture_events (source_kind, captured_at)`,
  },
  {
    name: "offer_capture_events_by_view",
    ddl: `CREATE INDEX offer_capture_events_by_view ON offer_capture_events (view_type, captured_at)`,
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
              AND TABLE_NAME IN ('offer_objects', 'offer_capture_events', 'offer_capture_links')`,
    });

    const [indexRows] = await db.run({
      sql: `SELECT INDEX_NAME
            FROM INFORMATION_SCHEMA.INDEXES
            WHERE TABLE_SCHEMA = ''
              AND INDEX_NAME IN (
                'offer_objects_by_lookup',
                'offer_capture_links_by_offer',
                'offer_capture_events_by_source',
                'offer_capture_events_by_view'
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
      console.log("No DDL changes needed (offer ledger tables and indexes already exist)");
      return;
    }

    const [operation] = await db.updateSchema(statements);
    await operation.promise();
    console.log(`Applied ${statements.length} offer-ledger DDL statement(s)`);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error("offer-ledger-ddl failed:", error);
  process.exit(1);
});

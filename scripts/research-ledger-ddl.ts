import { Spanner } from "@google-cloud/spanner";

const SPANNER_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "workflowos-a0fbf";
const SPANNER_INSTANCE_ID = "game-data";
const SPANNER_DATABASE_ID = "licensingdb";

const TABLE_DDLS: Array<{ name: string; ddl: string }> = [
  {
    name: "hc_research_objects",
    ddl: `CREATE TABLE hc_research_objects (
      object_id STRING(160) NOT NULL,
      category STRING(32) NOT NULL,
      state STRING(2) NOT NULL,
      profession STRING(128) NOT NULL,
      current_snapshot_id STRING(180) NOT NULL,
      last_verified_at TIMESTAMP NOT NULL,
      current_summary_json STRING(MAX) NOT NULL,
      updated_at TIMESTAMP OPTIONS (allow_commit_timestamp = true),
      created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
    ) PRIMARY KEY (object_id)`,
  },
  {
    name: "hc_research_snapshots",
    ddl: `CREATE TABLE hc_research_snapshots (
      snapshot_id STRING(180) NOT NULL,
      object_id STRING(160) NOT NULL,
      approved_at TIMESTAMP NOT NULL,
      approved_by STRING(128) NOT NULL,
      search_queries_json STRING(MAX) NOT NULL,
      source_refs_json STRING(MAX) NOT NULL,
      raw_answer_json STRING(MAX) NOT NULL,
      normalized_facts_json STRING(MAX) NOT NULL,
      approval_note STRING(MAX),
      created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
    ) PRIMARY KEY (snapshot_id)`,
  },
  {
    name: "hc_research_diffs",
    ddl: `CREATE TABLE hc_research_diffs (
      diff_id STRING(180) NOT NULL,
      object_id STRING(160) NOT NULL,
      from_snapshot_id STRING(180),
      to_snapshot_id STRING(180) NOT NULL,
      changed_fields_json STRING(MAX) NOT NULL,
      change_summary STRING(MAX) NOT NULL,
      has_material_change BOOL NOT NULL,
      created_at TIMESTAMP OPTIONS (allow_commit_timestamp = true)
    ) PRIMARY KEY (diff_id)`,
  },
];

const INDEX_DDLS: Array<{ name: string; ddl: string }> = [
  {
    name: "hc_research_objects_by_lookup",
    ddl: `CREATE INDEX hc_research_objects_by_lookup ON hc_research_objects (state, profession, category)`,
  },
  {
    name: "hc_research_snapshots_by_object",
    ddl: `CREATE INDEX hc_research_snapshots_by_object ON hc_research_snapshots (object_id, approved_at DESC)`,
  },
  {
    name: "hc_research_diffs_by_object",
    ddl: `CREATE INDEX hc_research_diffs_by_object ON hc_research_diffs (object_id, created_at DESC)`,
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
              AND TABLE_NAME IN ('hc_research_objects', 'hc_research_snapshots', 'hc_research_diffs')`,
    });

    const [indexRows] = await db.run({
      sql: `SELECT INDEX_NAME
            FROM INFORMATION_SCHEMA.INDEXES
            WHERE TABLE_SCHEMA = ''
              AND INDEX_NAME IN (
                'hc_research_objects_by_lookup',
                'hc_research_snapshots_by_object',
                'hc_research_diffs_by_object'
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
      console.log("No DDL changes needed (hc research ledger tables and indexes already exist)");
      return;
    }

    const [operation] = await db.updateSchema(statements);
    await operation.promise();
    console.log(`Applied ${statements.length} hc-research-ledger DDL statement(s)`);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error("research-ledger-ddl failed:", error);
  process.exit(1);
});

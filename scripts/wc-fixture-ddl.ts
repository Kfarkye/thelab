import { Spanner } from "@google-cloud/spanner";

const SPANNER_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "workflowos-a0fbf";
const SPANNER_INSTANCE_ID = "game-data";
const SPANNER_DATABASE_ID = "worldcupdb";

const WC_FIXTURE_DDL = `CREATE TABLE WCFixture (
  FixtureID STRING(64) NOT NULL,
  MatchNumber INT64,
  HomeSlug STRING(64),
  AwaySlug STRING(64),
  Stage STRING(16),
  GroupLetter STRING(1),
  Venue STRING(256),
  City STRING(128),
  Kickoff TIMESTAMP
) PRIMARY KEY (FixtureID)`;

const WC_MATCH_PREVIEW_DDL = `CREATE TABLE WCMatchPreview (
  FixtureID STRING(64) NOT NULL,
  WriteupUrl STRING(1024) NOT NULL,
  WriteupTitle STRING(512),
  PublishedAt TIMESTAMP OPTIONS (allow_commit_timestamp = true),
  UpdatedAt TIMESTAMP OPTIONS (allow_commit_timestamp = true)
) PRIMARY KEY (FixtureID)`;

async function main() {
  const spanner = new Spanner({ projectId: SPANNER_PROJECT_ID });
  const db = spanner.instance(SPANNER_INSTANCE_ID).database(SPANNER_DATABASE_ID);

  try {
    const [rows] = await db.run({
      sql: `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = ''
              AND TABLE_NAME IN ('WCFixture', 'WCMatchPreview')`,
    });

    const existing = new Set(rows.map((row) => String(row.toJSON().TABLE_NAME)));
    const statements: string[] = [];

    if (!existing.has("WCFixture")) statements.push(WC_FIXTURE_DDL);
    if (!existing.has("WCMatchPreview")) statements.push(WC_MATCH_PREVIEW_DDL);

    if (statements.length === 0) {
      console.log("No DDL changes needed (WCFixture and WCMatchPreview already exist)");
      return;
    }

    const [operation] = await db.updateSchema(statements);
    await operation.promise();
    console.log(`Applied ${statements.length} DDL statement(s)`);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error("wc-fixture-ddl failed:", err);
  process.exit(1);
});

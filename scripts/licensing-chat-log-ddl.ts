import { Spanner } from "@google-cloud/spanner";

const SPANNER_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "workflowos-a0fbf";
const SPANNER_INSTANCE_ID = "game-data";
const SPANNER_DATABASE_ID = "licensingdb";

const TABLE_NAME = "licensing_chat_question_logs";
const INDEX_NAME = "licensing_chat_question_logs_by_page_created";

const TABLE_DDL = `CREATE TABLE licensing_chat_question_logs (
  page_url STRING(2048) NOT NULL,
  user_question STRING(4000) NOT NULL,
  was_suggested BOOL NOT NULL,
  visit_timestamp TIMESTAMP NOT NULL,
  resolved_entity_id STRING(256),
  created_at TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp=true)
) PRIMARY KEY (visit_timestamp, page_url, user_question)`;

const INDEX_DDL = `CREATE INDEX licensing_chat_question_logs_by_page_created
ON licensing_chat_question_logs (page_url, created_at DESC)`;

async function main() {
  const spanner = new Spanner({ projectId: SPANNER_PROJECT_ID });
  const db = spanner.instance(SPANNER_INSTANCE_ID).database(SPANNER_DATABASE_ID);

  try {
    const [tableRows] = await db.run({
      sql: `SELECT TABLE_NAME
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = ''
              AND TABLE_NAME = @tableName`,
      params: { tableName: TABLE_NAME },
      types: { tableName: { type: "string" } },
    });
    const [indexRows] = await db.run({
      sql: `SELECT INDEX_NAME
            FROM INFORMATION_SCHEMA.INDEXES
            WHERE TABLE_SCHEMA = ''
              AND INDEX_NAME = @indexName`,
      params: { indexName: INDEX_NAME },
      types: { indexName: { type: "string" } },
    });

    const statements: string[] = [];
    if (tableRows.length === 0) statements.push(TABLE_DDL);
    if (indexRows.length === 0) statements.push(INDEX_DDL);

    if (statements.length === 0) {
      console.log("No DDL changes needed (chat question log table already exists)");
      return;
    }

    const [operation] = await db.updateSchema(statements);
    await operation.promise();
    console.log(`Applied ${statements.length} chat-question-log DDL statement(s)`);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error("licensing-chat-log-ddl failed:", error);
  process.exit(1);
});

const { Spanner } = require("@google-cloud/spanner");
const spanner = new Spanner({ projectId: "workflowos-a0fbf" });
const db = spanner.instance("game-data").database("sportsdb");

(async () => {
  const [cols] = await db.run({
    sql: `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = 'GameResult' AND COLUMN_NAME = 'TeamRecord'`,
  });
  if (cols.length > 0) {
    console.log("TeamRecord already exists");
    await db.close();
    return;
  }
  console.log("Adding TeamRecord column...");
  const [op] = await db.updateSchema([
    `ALTER TABLE GameResult ADD COLUMN TeamRecord STRING(30)`,
  ]);
  console.log("Waiting for schema update...");
  await op.promise();
  console.log("✅ TeamRecord column added");
  await db.close();
})();

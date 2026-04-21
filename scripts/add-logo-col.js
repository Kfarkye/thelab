const { Spanner } = require("@google-cloud/spanner");
const spanner = new Spanner({ projectId: "workflowos-a0fbf" });
const db = spanner.instance("game-data").database("sportsdb");

(async () => {
  // Check if column exists
  const [cols] = await db.run({
    sql: `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = 'GameResult' AND COLUMN_NAME = 'TeamLogoURL'`,
  });
  if (cols.length > 0) {
    console.log("TeamLogoURL already exists");
    await db.close();
    return;
  }
  console.log("Adding TeamLogoURL column...");
  const [op] = await db.updateSchema([
    `ALTER TABLE GameResult ADD COLUMN TeamLogoURL STRING(500)`,
  ]);
  console.log("Waiting for schema update...");
  await op.promise();
  console.log("✅ TeamLogoURL column added");
  await db.close();
})();

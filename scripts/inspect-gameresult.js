const { Spanner } = require("@google-cloud/spanner");
const spanner = new Spanner({ projectId: "workflowos-a0fbf" });
const db = spanner.instance("game-data").database("sportsdb");

(async () => {
  const [cols] = await db.run({
    sql: `SELECT COLUMN_NAME, SPANNER_TYPE, IS_NULLABLE
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = 'GameResult'
          ORDER BY ORDINAL_POSITION`,
  });
  console.log("=== GameResult Schema ===");
  for (const c of cols) {
    const r = c.toJSON();
    console.log(`  ${r.COLUMN_NAME}: ${r.SPANNER_TYPE} ${r.IS_NULLABLE === 'YES' ? '(nullable)' : ''}`);
  }

  // Sample row
  const [sample] = await db.run({
    sql: `SELECT * FROM GameResult WHERE LOWER(Sport) = 'basketball' LIMIT 2`,
  });
  console.log("\n=== Sample NBA Row ===");
  for (const s of sample) console.log(JSON.stringify(s.toJSON(), null, 2));

  await db.close();
})();

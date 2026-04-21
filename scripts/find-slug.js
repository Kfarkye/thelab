const { Spanner } = require("@google-cloud/spanner");
const spanner = new Spanner({ projectId: "workflowos-a0fbf" });
const db = spanner.instance("game-data").database("licensingdb");
(async () => {
  const [rows] = await db.run({
    sql: `SELECT slug FROM licenses WHERE state_name = 'Alabama' AND LOWER(profession) LIKE '%audio%' LIMIT 5`,
  });
  for (const r of rows) console.log(r.toJSON().slug);
  if (rows.length === 0) {
    const [all] = await db.run({ sql: `SELECT slug FROM licenses WHERE state_name = 'Alabama' LIMIT 10` });
    console.log("All Alabama slugs:");
    for (const r of all) console.log(" ", r.toJSON().slug);
  }
  await db.close();
})();

import { getDb } from "./src/lib/spanner-pool";

async function run() {
  try {
    const db = getDb("recruitingdb");
    const [rows] = await db.run({
      sql: "SELECT table_name FROM information_schema.tables WHERE table_schema = ''"
    });
    console.log(rows.map((r: any) => r.table_name));
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();

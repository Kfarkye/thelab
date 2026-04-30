import { getDb } from "../src/lib/spanner-pool";

async function run() {
  const db = getDb("recruitingdb");
  try {
    const [rows] = await db.run({
      sql: `SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'job_orders'`
    });
    console.log(rows.map((r: any) => `${r.column_name}: ${r.data_type}`));
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();

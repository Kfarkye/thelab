import { getDb } from "../src/lib/spanner-pool";
import { readFileSync } from "fs";
import { join } from "path";

const jobsData = JSON.parse(readFileSync(join(process.cwd(), "scratch/jobs.json"), "utf8")) as Array<any>;

// INVARIANT: Ensure complete batch ingestion
if (jobsData.length === 0) {
  throw new Error("INVARIANT FAILED: Payload empty, expected at least 1 job.");
}

async function main() {
  const db = getDb("recruitingdb");
  try {
    const [cols] = await db.run({
      sql: "SELECT column_name FROM information_schema.columns WHERE table_name = 'job_orders'"
    });
    
    const validCols = new Set(cols.map((r: any) => r.column_name));
    
    // INVARIANT: Verify target table exists and is readable
    if (validCols.size === 0) {
      throw new Error("INVARIANT FAILED: job_orders table schema not found or inaccessible.");
    }
    
    const rows = jobsData.map((job) => {
      const loc = job.location || {};
      const mapped: any = {
        job_order_id: String(job.job_id),
        title: job.title || null,
        profession: job.profession || null,
        specialty: job.specialty || null,
        description: `Facility: \${job.facility}`,
        requirements: job.vaccine_guidelines || null,
        city: loc.city || null,
        state: loc.state || null,
        employment_type: job.employment_type || null,
        shift: job.shift || null,
        status: "active",
        notes: `Bill rate: \${job.blended_bill_rate}`
      };
      
      const toInsert: any = {};
      for (const [k, v] of Object.entries(mapped)) {
        if (validCols.has(k)) {
          toInsert[k] = v;
        }
      }
      return toInsert;
    });

    await db.runTransactionAsync(async (transaction: any) => {
      await transaction.insertOrUpdate("job_orders", rows);
      await transaction.commit();
    });
    console.log(`Successfully ingested \${rows.length} jobs into job_orders.`);
  } catch (err: any) {
    console.error("Failed to seed jobs:", err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}
main();

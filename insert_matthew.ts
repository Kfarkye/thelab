import { getDb } from "./src/lib/spanner-pool.js";
import { v4 as uuidv4 } from "uuid";

async function run() {
  const db = getDb("recruitingdb");
  const id = uuidv4();
  await db.runTransactionAsync(async (tx: any) => {
    await tx.runUpdate({
      sql: `
        INSERT INTO hc_candidates (id, nova_id, first_name, last_name, email, phone, specialty, profession, home_state)
        VALUES (@id, @nova_id, @first_name, @last_name, @email, @phone, @specialty, @profession, @home_state)
      `,
      params: {
        id,
        nova_id: "5029630",
        first_name: "Matthew",
        last_name: "Saenz",
        email: "msaenz6288@yahoo.com",
        phone: "(909) 638-4111",
        specialty: "Radiology / Cardiology",
        profession: "X-Ray Tech",
        home_state: "CA",
      }
    });
    
    await tx.runUpdate({
      sql: `
        INSERT INTO hc_submittals (id, candidate_id, status, submitted_at)
        VALUES (@sid, @id, @status, CURRENT_TIMESTAMP())
      `,
      params: {
        sid: uuidv4(),
        id,
        status: "Submitted"
      }
    });
    await tx.commit();
  });
  console.log("Inserted Matthew Saenz with ID:", id);
  process.exit(0);
}
run().catch(console.error);

import { getRecruitingDb } from "../src/lib/spanner-pool";
import crypto from "crypto";
import fs from "fs";

async function main() {
  const fileData = JSON.parse(fs.readFileSync("/Users/k.far.88/Documents/New project/thelab/scratch/payload_all.json", "utf8"));
  const data = fileData.candidates;
  const db = getRecruitingDb();
  
  for (const c of data) {
    try {
      const parts = c.Name.split(" ");
      const firstName = parts[0];
      const lastName = parts.slice(1).join(" ") || "Unknown";
      
      const email = c.Email || null;
      const phone = c.Phone || null;
      const novaId = c["Candidate ID"] || null;
      const profession = c.Profession || null;
      const specialty = c.Specialty ? c.Specialty.substring(0, 100) : null;
      
      const newCandidateId = crypto.randomUUID();
      
      await db.runTransactionAsync(async (tx: any) => {
        let existingId = null;
        
        // 1. check nova_id
        if (novaId) {
          const [res] = await tx.run({
            sql: `SELECT id FROM hc_candidates WHERE nova_id = @novaId LIMIT 1`,
            params: { novaId },
            types: { novaId: { type: "string" } }
          });
          if (res.length > 0) existingId = res[0].toJSON().id;
        }
        
        // 2. check email
        if (!existingId && email) {
          const [res] = await tx.run({
            sql: `SELECT id FROM hc_candidates WHERE email = @email LIMIT 1`,
            params: { email },
            types: { email: { type: "string" } }
          });
          if (res.length > 0) existingId = res[0].toJSON().id;
        }
        
        // 3. check name
        if (!existingId) {
          const nameLower = c.Name.toLowerCase().trim();
          const [res2] = await tx.run({
            sql: `SELECT id FROM hc_candidates WHERE LOWER(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) = @nameLower LIMIT 1`,
            params: { nameLower },
            types: { nameLower: { type: "string" } }
          });
          if (res2.length > 0) existingId = res2[0].toJSON().id;
        }
        
        if (!existingId) {
          // Insert Candidate
          await tx.run({
            sql: `INSERT INTO hc_candidates (id, nova_id, first_name, last_name, email, phone, profession, specialty, created_at, updated_at) 
                  VALUES (@id, @novaId, @first, @last, @email, @phone, @profession, @specialty, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
            params: { id: newCandidateId, novaId, first: firstName, last: lastName, email, phone, profession, specialty },
            types: { id: { type: "string" }, novaId: { type: "string" }, first: { type: "string" }, last: { type: "string" }, email: { type: "string" }, phone: { type: "string"}, profession: { type: "string"}, specialty: { type: "string"} }
          });
          console.log(`Inserted candidate: ${c.Name} (Nova: ${novaId})`);
        } else {
          // Update Candidate
          await tx.run({
            sql: `UPDATE hc_candidates SET 
                  nova_id = COALESCE(nova_id, @novaId), 
                  email = COALESCE(email, @email), 
                  phone = COALESCE(phone, @phone), 
                  profession = COALESCE(profession, @profession), 
                  specialty = COALESCE(specialty, @specialty), 
                  updated_at = CURRENT_TIMESTAMP() 
                  WHERE id = @id`,
            params: { id: existingId, novaId, email, phone, profession, specialty },
            types: { id: { type: "string" }, novaId: { type: "string" }, email: { type: "string" }, phone: { type: "string"}, profession: { type: "string"}, specialty: { type: "string"} }
          });
          console.log(`Updated existing cand: ${c.Name} (ID: ${existingId})`);
        }
        await tx.commit();
      });
    } catch (err: any) {
      console.error(`Error with ${c.Name}: ${err.message}`);
    }
  }
}

main().catch(console.error);

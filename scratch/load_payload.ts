import { getRecruitingDb } from "../src/lib/spanner-pool";
import crypto from "crypto";
import fs from "fs";

async function main() {
  const data = JSON.parse(fs.readFileSync("/Users/k.far.88/Documents/New project/thelab/scratch/payload.json", "utf8"));
  const db = getRecruitingDb();
  
  for (const c of data) {
    try {
      const parts = c.candidate_name.split(" ");
      const firstName = parts[0];
      const lastName = parts.slice(1).join(" ") || "Unknown";
      
      const email = c.contact?.email || null;
      const phone = c.contact?.phone || null;
      
      const candidateId = crypto.randomUUID();
      
      await db.runTransactionAsync(async (tx: any) => {
        let existingId = null;
        
        // 1. check email
        if (email) {
          const [res] = await tx.run({
            sql: `SELECT id FROM hc_candidates WHERE email = @email LIMIT 1`,
            params: { email },
            types: { email: { type: "string" } }
          });
          if (res.length > 0) existingId = res[0].toJSON().id;
        }
        
        // 2. check name
        if (!existingId) {
          const nameLower = c.candidate_name.toLowerCase().trim();
          const [res2] = await tx.run({
            sql: `SELECT id FROM hc_candidates WHERE LOWER(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) = @nameLower LIMIT 1`,
            params: { nameLower },
            types: { nameLower: { type: "string" } }
          });
          if (res2.length > 0) existingId = res2[0].toJSON().id;
        }
        
        const finalId = existingId || candidateId;
        
        if (!existingId) {
          // Insert Candidate
          await tx.run({
            sql: `INSERT INTO hc_candidates (id, first_name, last_name, email, phone, created_at, updated_at) 
                  VALUES (@id, @first, @last, @email, @phone, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
            params: { id: finalId, first: firstName, last: lastName, email, phone },
            types: { id: { type: "string" }, first: { type: "string" }, last: { type: "string" }, email: { type: "string" }, phone: { type: "string"} }
          });
          console.log(`Inserted candidate: ${c.candidate_name}`);
        } else {
          console.log(`Matched existing cand: ${c.candidate_name}`);
        }
        
        // Now process work_history into hc_assignments if facility exists (create if not)
        if (c.work_history && c.work_history.length > 0) {
          for (const work of c.work_history) {
             const facName = work.facility;
             
             // Check if facility exists
             let facilityId = null;
             const [facRes] = await tx.run({
                sql: `SELECT id FROM hc_facilities WHERE LOWER(name) = @nameLower LIMIT 1`,
                params: { nameLower: facName.toLowerCase() },
                types: { nameLower: { type: "string" } }
             });
             
             if (facRes.length > 0) {
               facilityId = facRes[0].toJSON().id;
             } else {
               facilityId = crypto.randomUUID();
               await tx.run({
                 sql: `INSERT INTO hc_facilities (id, name, created_at, updated_at) VALUES (@id, @name, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
                 params: { id: facilityId, name: facName },
                 types: { id: { type: "string" }, name: { type: "string" } }
               });
             }
             
             // Check if assignment exists
             const [assRes] = await tx.run({
                sql: `SELECT id FROM hc_assignments WHERE candidate_id = @cid AND facility_id = @fid LIMIT 1`,
                params: { cid: finalId, fid: facilityId },
                types: { cid: { type: "string" }, fid: { type: "string" } }
             });
             
             if (assRes.length === 0) {
                const assId = crypto.randomUUID();
                
                // employment_type comes from professional profile or fallback
                let empType = c.professional_profile?.employment_type || "Unknown";
                if (c.professional_profile && c.professional_profile[" employment_type"]) empType = c.professional_profile[" employment_type"];
                
                // Using status to hold employment_type just to ensure mapping
                await tx.run({
                   sql: `INSERT INTO hc_assignments (id, candidate_id, facility_id, start_date, end_date, status, created_at, updated_at) 
                         VALUES (@id, @cid, @fid, @start, @end, @status, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
                   params: { id: assId, cid: finalId, fid: facilityId, start: work.start_date || null, end: work.end_date || null, status: empType },
                   types: { id: { type: "string"}, cid: { type: "string"}, fid: { type: "string"}, start: { type: "string"}, end: { type: "string"}, status: { type: "string"} }
                });
                console.log(` - Inserted assignment at ${facName}`);
             }
          }
        }
      });
    } catch (err: any) {
      console.error(`Error with ${c.candidate_name}: ${err.message}`);
    }
  }
}

main().catch(console.error);

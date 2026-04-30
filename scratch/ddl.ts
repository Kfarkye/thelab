import { getCredentialDb } from "../src/lib/spanner-pool";

async function main() {
  const db = getCredentialDb();
  console.log("Applying DDL...");
  const [operation] = await db.updateSchema([
    "ALTER TABLE screenshot_extractions ADD COLUMN ocr_status STRING(32)",
    "ALTER TABLE screenshot_extractions ADD COLUMN vision_error STRING(MAX)",
    "ALTER TABLE screenshot_extractions ADD COLUMN candidate_match_status STRING(32)",
    "ALTER TABLE screenshot_extractions ADD COLUMN suggested_candidate_id STRING(MAX)",
    "ALTER TABLE screenshot_extractions ADD COLUMN suggested_candidate_name STRING(MAX)",
    "ALTER TABLE screenshot_extractions ADD COLUMN suggested_candidate_reason STRING(MAX)",
    "ALTER TABLE screenshot_extractions ADD COLUMN matched_at TIMESTAMP OPTIONS (allow_commit_timestamp=true)"
  ]);
  await operation.promise();
  console.log("DDL applied. Backfilling...");
  
  await db.runTransactionAsync(async (tx: any) => {
    await tx.runUpdate({
      sql: `UPDATE screenshot_extractions SET ocr_status = 'success', candidate_match_status = 'none' WHERE ocr_status IS NULL`
    });
    await tx.commit();
  });
  console.log("Backfill complete.");
}

main().catch(console.error);

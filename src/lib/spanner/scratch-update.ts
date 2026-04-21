import { getDb } from "../spanner-pool";

async function main() {
  const db = getDb("recruitingdb");
  try {
    await db.runTransactionAsync(async (transaction: any) => {
      await transaction.runUpdate({
        sql: `UPDATE hc_candidates SET rc_thread_url = @rcUrl WHERE nova_id = @novaId`,
        params: { rcUrl: "https://app.ringcentral.com/sms/direct/all/b7760d2304c4744484601b9e61de3bc2", novaId: "2502428" }
      });
      await transaction.commit();
      console.log("Updated Nathan Welch successfully");
    });
  } catch (e: any) {
    console.error("Error updating:", e);
  } finally {
    process.exit(0);
  }
}
main();

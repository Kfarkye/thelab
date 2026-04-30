import { optionalEnv, requireEnv } from "@/lib/env";
import { getDb } from "@/lib/spanner-pool";
import { geocodeCityState } from "@/lib/recruiting/geocode";

type CandidateRow = {
  id?: unknown;
  home_city?: unknown;
  home_state?: unknown;
};

type SpannerRow = {
  toJSON: () => CandidateRow;
};

function write(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  const db = getDb(requireEnv("SPANNER_DATABASE"));
  const runMode = optionalEnv("GEOCODE_RUN_MODE", "backfill");
  const [rows] = await db.run({
    sql: `SELECT id, home_city, home_state
          FROM hc_candidates
          WHERE latitude IS NULL
            AND longitude IS NULL
            AND home_city IS NOT NULL
            AND home_state IS NOT NULL
          ORDER BY id`,
  });

  let updated = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows as SpannerRow[]) {
    const data = row.toJSON();
    const id = readString(data.id);
    const city = readString(data.home_city);
    const state = readString(data.home_state);
    if (!id || !city || !state) {
      skipped += 1;
      continue;
    }

    await sleep(120);
    try {
      const geocode = await geocodeCityState(city, state);
      if (!geocode) {
        failed += 1;
      write({ event: "geocode_empty", mode: runMode, candidate_id: id, address: `${city}, ${state}` });
      continue;
      }

      await db.runTransactionAsync(async (tx: unknown) => {
        const transaction = tx as {
          runUpdate: (statement: { sql: string; params: Record<string, unknown>; types: Record<string, unknown> }) => Promise<number>;
          commit: () => Promise<void>;
        };
        await transaction.runUpdate({
          sql: `UPDATE hc_candidates
                SET latitude = @latitude,
                    longitude = @longitude,
                    updated_by = 'geocode-backfill',
                    updated_at = PENDING_COMMIT_TIMESTAMP()
                WHERE id = @id`,
          params: {
            id,
            latitude: geocode.latitude,
            longitude: geocode.longitude,
          },
          types: {
            id: { type: "string" },
            latitude: { type: "float64" },
            longitude: { type: "float64" },
          },
        });
        await transaction.commit();
      });
      updated += 1;
      write({ event: "geocode_updated", mode: runMode, candidate_id: id, address: `${city}, ${state}`, latitude: geocode.latitude, longitude: geocode.longitude });
    } catch (error) {
      failed += 1;
      write({
        event: "geocode_failed",
        mode: runMode,
        candidate_id: id,
        address: `${city}, ${state}`,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const [summaryRows] = await db.run({
    sql: `SELECT
            COUNT(*) AS total,
            COUNTIF(home_city IS NOT NULL AND home_state IS NOT NULL) AS addressable,
            COUNTIF(latitude IS NOT NULL AND longitude IS NOT NULL) AS geocoded
          FROM hc_candidates`,
  });
  const summary = (summaryRows as SpannerRow[])[0]?.toJSON() || {};
  write({
    event: "geocode_complete",
    mode: runMode,
    updated,
    failed,
    skipped,
    total: summary.total,
    addressable: summary.addressable,
    geocoded: summary.geocoded,
  });
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});

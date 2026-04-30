import { execFileSync } from "child_process";

function requireEnv(key) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function write(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function executeSql(sql, formatJson = false) {
  const args = [
    "spanner",
    "databases",
    "execute-sql",
    requireEnv("SPANNER_DATABASE"),
    `--instance=${requireEnv("SPANNER_INSTANCE_ID")}`,
    `--project=${requireEnv("GOOGLE_CLOUD_PROJECT")}`,
    `--sql=${sql}`,
  ];
  if (formatJson) args.push("--format=json");
  return execFileSync("gcloud", args, { encoding: "utf8" });
}

function sqlString(value) {
  return String(value).replace(/'/g, "''");
}

async function geocode(city, state) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", `${city}, ${state}, USA`);
  url.searchParams.set("key", requireEnv("GOOGLE_MAPS_API_KEY"));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GEOCODING_HTTP_${response.status}`);
  const body = await response.json();
  const location = body.results?.[0]?.geometry?.location;
  if (body.status !== "OK" || typeof location?.lat !== "number" || typeof location?.lng !== "number") {
    throw new Error(`GEOCODING_${body.status || "UNKNOWN"}`);
  }
  return { latitude: location.lat, longitude: location.lng };
}

async function run() {
  const raw = executeSql(
    `SELECT id, home_city, home_state
     FROM hc_candidates
     WHERE latitude IS NULL
       AND longitude IS NULL
       AND home_city IS NOT NULL
       AND home_state IS NOT NULL
     ORDER BY id`,
    true,
  );
  const rows = JSON.parse(raw).rows || [];
  let updated = 0;
  let failed = 0;

  for (const [id, city, state] of rows) {
    await sleep(120);
    try {
      const result = await geocode(city, state);
      executeSql(
        `UPDATE hc_candidates
         SET latitude = ${result.latitude},
             longitude = ${result.longitude},
             updated_by = 'geocode-retry',
             updated_at = PENDING_COMMIT_TIMESTAMP()
         WHERE id = '${sqlString(id)}'`,
      );
      updated += 1;
      write({ event: "geocode_retry_updated", candidate_id: id, address: `${city}, ${state}` });
    } catch (error) {
      failed += 1;
      write({
        event: "geocode_retry_failed",
        candidate_id: id,
        address: `${city}, ${state}`,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const summary = executeSql(
    `SELECT COUNT(*) AS total,
            COUNTIF(home_city IS NOT NULL AND home_state IS NOT NULL) AS addressable,
            COUNTIF(latitude IS NOT NULL AND longitude IS NOT NULL) AS geocoded
     FROM hc_candidates`,
    true,
  );
  write({ event: "geocode_retry_complete", attempted: rows.length, updated, failed, summary: JSON.parse(summary).rows?.[0] || [] });
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});

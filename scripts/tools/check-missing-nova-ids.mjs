import { execFileSync } from "child_process";

function write(line = "") {
  process.stdout.write(`${line}\n`);
}

const sql = `
  SELECT
    id,
    TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) AS candidate_name,
    latitude,
    longitude,
    nova_id
  FROM hc_candidates
  WHERE nova_id IS NULL
    AND latitude IS NOT NULL
    AND longitude IS NOT NULL
  ORDER BY candidate_name ASC
`;

const output = execFileSync(
  "gcloud",
  [
    "spanner",
    "databases",
    "execute-sql",
    "recruitingdb",
    "--instance=game-data",
    `--sql=${sql}`,
    "--format=json",
  ],
  { encoding: "utf8" },
);

const parsed = JSON.parse(output);
const rows = parsed.rows || [];

write(`Missing Nova IDs with coordinates: ${rows.length}`);
for (const row of rows) {
  const [id, candidateName, latitude, longitude] = row;
  write(`${candidateName || "Unnamed candidate"} | ${id} | ${latitude}, ${longitude}`);
}

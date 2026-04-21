import { execSync } from "node:child_process";
import { Spanner } from "@google-cloud/spanner";

const SUPABASE_PROJECT_REF = process.env.SUPABASE_SPORTS_PROJECT_REF?.trim() || "qffzvrnbzabcokqqrwbv";
const SUPABASE_URL = process.env.SUPABASE_SPORTS_URL?.trim() || process.env.SUPABASE_URL?.trim() || `https://${SUPABASE_PROJECT_REF}.supabase.co`;

const SPANNER_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "workflowos-a0fbf";
const SPANNER_INSTANCE_ID = "game-data";
const SPANNER_DATABASE_ID = "worldcupdb";

const EXPECTED_FIXTURE_COUNT = 104;
const SLUG_ALIASES: Record<string, string> = {
  cur: "cuw",
};

type SupabaseFixtureRow = {
  fixture_id: string;
  match_number: number;
  home_slug: string;
  away_slug: string;
  stage: string;
  group_letter: string | null;
  venue: string | null;
  city: string | null;
  kickoff: string;
};

function resolveServiceRoleKey() {
  const envKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_KEY?.trim();

  if (envKey) return envKey;

  const output = execSync(
    `supabase projects api-keys --project-ref ${SUPABASE_PROJECT_REF} -o json`,
    { encoding: "utf8" },
  );

  const parsed = JSON.parse(output) as Array<{ name?: string; api_key?: string }>;
  const found = parsed.find((entry) => entry?.name === "service_role" && typeof entry.api_key === "string");

  if (found?.api_key) return found.api_key;

  throw new Error(
    "Missing SUPABASE service role key. Set SUPABASE_SERVICE_ROLE_KEY or login to Supabase CLI.",
  );
}

async function fetchFixtures(serviceKey: string): Promise<SupabaseFixtureRow[]> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/wc26_fixtures`);
  url.searchParams.set("select", "fixture_id,match_number,home_slug,away_slug,stage,group_letter,venue,city,kickoff");
  url.searchParams.set("order", "match_number.asc");
  url.searchParams.set("limit", "500");

  const res = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch wc26_fixtures: ${res.status} ${await res.text()}`);
  }

  const rows = (await res.json()) as SupabaseFixtureRow[];
  if (!Array.isArray(rows)) {
    throw new Error("Unexpected wc26_fixtures payload");
  }

  return rows;
}

function normalizeFixtureStage(raw: string | null | undefined) {
  const stage = String(raw || "").toLowerCase().trim();
  if (!stage) return "group";
  return stage;
}

function normalizeGroupLetter(raw: string | null | undefined) {
  const value = String(raw || "").trim().toUpperCase();
  return value || null;
}

function resolveTeamId(rawSlug: string, knownTeamIds: Set<string>): string {
  const normalizedRaw = String(rawSlug || "").trim().toLowerCase();
  if (!normalizedRaw) {
    throw new Error(`Missing team slug: ${rawSlug}`);
  }
  const normalized = SLUG_ALIASES[normalizedRaw] || normalizedRaw;

  if (knownTeamIds.has(normalized)) return normalized;

  const prefixed = normalized.startsWith("wc-2026-") ? normalized : `wc-2026-${normalized}`;
  if (knownTeamIds.has(prefixed)) return prefixed;

  throw new Error(`No Team.TeamID match for slug '${rawSlug}'`);
}

async function ensureFixtureTables(db: ReturnType<Spanner["instance"]>["database"]) {
  const [rows] = await db.run({
    sql: `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = ''
            AND TABLE_NAME IN ('WCFixture', 'WCMatchPreview')`,
  });

  const existing = new Set(rows.map((row) => String(row.toJSON().TABLE_NAME)));
  const missing = ["WCFixture", "WCMatchPreview"].filter((name) => !existing.has(name));
  if (missing.length === 0) return;

  throw new Error(
    `Missing required Spanner tables: ${missing.join(", ")}. Run scripts/sql/create_wc_fixture_preview_tables.sql first.`,
  );
}

async function main() {
  const serviceKey = resolveServiceRoleKey();
  const spanner = new Spanner({ projectId: SPANNER_PROJECT_ID });
  const db = spanner.instance(SPANNER_INSTANCE_ID).database(SPANNER_DATABASE_ID);

  try {
    await ensureFixtureTables(db);

    const fixtures = await fetchFixtures(serviceKey);
    if (fixtures.length !== EXPECTED_FIXTURE_COUNT) {
      throw new Error(`Expected ${EXPECTED_FIXTURE_COUNT} fixture rows, got ${fixtures.length}`);
    }

    const [teamRows] = await db.run({ sql: "SELECT TeamID FROM Team" });
    const knownTeamIds = new Set(
      teamRows.map((row) => String(row.toJSON().TeamID).toLowerCase()),
    );

    const mapped = fixtures.map((fixture) => {
      const kickoffDate = new Date(fixture.kickoff);
      if (Number.isNaN(kickoffDate.getTime())) {
        throw new Error(`Invalid kickoff timestamp for fixture ${fixture.fixture_id}: ${fixture.kickoff}`);
      }

      return {
        FixtureID: fixture.fixture_id,
        MatchNumber: Number(fixture.match_number),
        HomeSlug: resolveTeamId(fixture.home_slug, knownTeamIds),
        AwaySlug: resolveTeamId(fixture.away_slug, knownTeamIds),
        Stage: normalizeFixtureStage(fixture.stage),
        GroupLetter: normalizeGroupLetter(fixture.group_letter),
        Venue: fixture.venue || null,
        City: fixture.city || null,
        Kickoff: Spanner.timestamp(kickoffDate),
      };
    });

    await db.runTransactionAsync(async (tx) => {
      tx.upsert("WCFixture", mapped);
      await tx.commit();
    });

    const [countRows] = await db.run({ sql: "SELECT COUNT(*) AS c FROM WCFixture" });
    const fixtureCount = Number(countRows[0]?.toJSON()?.c || 0);

    const [joinRows] = await db.run({
      sql: `SELECT COUNT(*) AS c
            FROM WCFixture f
            LEFT JOIN Team t1 ON f.HomeSlug = t1.TeamID
            LEFT JOIN Team t2 ON f.AwaySlug = t2.TeamID
            WHERE t1.TeamID IS NULL OR t2.TeamID IS NULL`,
    });
    const joinMismatchCount = Number(joinRows[0]?.toJSON()?.c || 0);

    if (joinMismatchCount > 0) {
      throw new Error(`Join validation failed: ${joinMismatchCount} fixture rows do not match Team.TeamID`);
    }

    const [firstRows] = await db.run({
      sql: `SELECT FixtureID, MatchNumber, HomeSlug, AwaySlug, Venue, City, Kickoff
            FROM WCFixture
            ORDER BY MatchNumber ASC
            LIMIT 1`,
    });

    const firstFixture = firstRows[0]?.toJSON();
    console.log(`upserted ${mapped.length} fixtures into WCFixture`);
    console.log(`WCFixture rows: ${fixtureCount}`);
    console.log(`join mismatches: ${joinMismatchCount}`);
    if (firstFixture) {
      console.log("first fixture:", firstFixture);
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error("wc-fixture-import failed:", err);
  process.exit(1);
});

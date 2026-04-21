#!/usr/bin/env node
/**
 * World Cup 2026 — Fix FlagUri with correct ESPN countries CDN path
 * 
 * Correct pattern: https://a.espncdn.com/i/teamlogos/countries/500/{slug}.png
 * where slug = lowercase ESPN abbreviation (usually = lowercase FIFA code)
 * 
 * Source: ESPN FIFA World Cup API response (verified 2026-04-12)
 */

const { Spanner } = require("@google-cloud/spanner");

const PROJECT_ID = "workflowos-a0fbf";
const INSTANCE_ID = "game-data";
const DATABASE_ID = "worldcupdb";

const spanner = new Spanner({ projectId: PROJECT_ID });
const db = spanner.instance(INSTANCE_ID).database(DATABASE_ID);

// FIFA Code → ESPN slug (extracted from ESPN FIFA World Cup API)
// Most match lowercase FIFA code; exceptions noted
const FIFA_TO_ESPN_SLUG = {
  // Group A
  MEX: "mex",
  RSA: "rsa",
  KOR: "kors",  // ESPN uses "kors" not "kor"
  CZE: "cze",
  // Group B
  SUI: "sui",
  CAN: "can",
  BIH: "bih",
  QAT: "qat",
  // Group C
  BRA: "bra",
  MAR: "mar",
  HAI: "hai",
  SCO: "sco",
  // Group D
  USA: "usa",
  PAR: "par",
  AUS: "aus",
  TUR: "tur",
  // Group E
  GER: "ger",
  CUW: "11678", // Curaçao uses numeric ID in soccer/500 path (non-country)
  CIV: "civ",
  ECU: "ecu",
  // Group F
  NED: "ned",
  JPN: "jpn",
  SWE: "swe",
  TUN: "tun",
  // Group G
  BEL: "bel",
  EGY: "egy",
  IRN: "irn",
  NZL: "nzl",
  // Group H
  ESP: "esp",
  CPV: "cpv",
  KSA: "ksa",
  URU: "uru",
  // Group I
  FRA: "fra",
  SEN: "sen",
  IRQ: "irq",
  NOR: "nor",
  // Group J
  ARG: "arg",
  ALG: "alg",
  AUT: "aut",
  JOR: "jor",
  // Group K
  POR: "por",
  COL: "col",
  UZB: "uzb",
  COD: "rdc",  // DR Congo uses "rdc" on ESPN
  // Group L
  ENG: "eng",
  CRO: "cro",
  GHA: "gha",
  PAN: "pan",
};

async function updateFlags() {
  console.log("🏳️ Updating FlagUri for all 48 teams with correct ESPN countries CDN...");

  await db.runTransactionAsync(async (transaction) => {
    for (const [fifaCode, espnSlug] of Object.entries(FIFA_TO_ESPN_SLUG)) {
      const teamId = `wc-2026-${fifaCode.toLowerCase()}`;
      
      // Curaçao uses the soccer/500 path with numeric ID (club-style)
      const flagUri = espnSlug === "11678"
        ? `https://a.espncdn.com/i/teamlogos/soccer/500/${espnSlug}.png`
        : `https://a.espncdn.com/i/teamlogos/countries/500/${espnSlug}.png`;
      
      transaction.update("Team", [{
        TeamID: teamId,
        FlagUri: flagUri,
        UpdatedAt: Spanner.COMMIT_TIMESTAMP,
      }]);
    }
    await transaction.commit();
  });

  // Verify first 10
  const [rows] = await db.run({
    sql: `SELECT Name, FifaCode, FlagUri FROM Team ORDER BY GroupCode, FifaRanking LIMIT 10`,
  });
  console.log("\nVerification (first 10):");
  for (const row of rows) {
    const r = row.toJSON();
    console.log(`  ${r.FifaCode} ${r.Name} → ${r.FlagUri}`);
  }

  console.log("\n✅ All 48 teams updated with ESPN countries CDN");
  await db.close();
  process.exit(0);
}

updateFlags().catch(err => {
  console.error("❌ Failed:", err);
  process.exit(1);
});

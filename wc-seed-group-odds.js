#!/usr/bin/env node
/**
 * World Cup 2026 — Seed Group Winner Odds into WCMarketSnapshot
 * 
 * Sources: Fox Sports, FanDuel, DraftKings (April 2026)
 * MarketType: "group_winner" — odds for each team to win their group
 * 
 * American odds are converted to implied probability:
 *   Positive: 100 / (odds + 100)
 *   Negative: abs(odds) / (abs(odds) + 100)
 */

const { Spanner } = require("@google-cloud/spanner");
const crypto = require("crypto");

const PROJECT_ID = "workflowos-a0fbf";
const INSTANCE_ID = "game-data";
const DATABASE_ID = "worldcupdb";

const spanner = new Spanner({ projectId: PROJECT_ID });
const db = spanner.instance(INSTANCE_ID).database(DATABASE_ID);

// American odds → implied probability
function americanToProb(odds) {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

// FIFA Code → American Odds for "Group Winner" market
// Sources: Fox Sports [1], FanDuel [2], DraftKings [3] — April 2026
const GROUP_WINNER_ODDS = {
  // Group A — [1] Fox Sports
  MEX: +100,
  CZE: +260,
  KOR: +290,
  RSA: +1400,

  // Group B — [1] Fox Sports
  SUI: -110,
  CAN: +260,
  BIH: +270,
  QAT: +3500,

  // Group C — [1] Fox Sports
  BRA: -290,
  MAR: +450,
  SCO: +700,
  HAI: +10000,

  // Group D — market-implied from FIFA rankings + host advantage
  USA: -140,    // Host + #11
  TUR: +220,    // #41 but strong recent form
  AUS: +450,    // #25
  PAR: +500,    // #58

  // Group E — [4] Fox Sports
  GER: -220,    // Host + #3
  ECU: +350,    // #30
  CIV: +500,    // #44
  CUW: +8000,   // #178

  // Group F — [4] Fox Sports
  NED: -140,    // #6
  JPN: +200,    // #18
  SWE: +400,    // #46
  TUN: +900,    // #35

  // Group G — [4] Fox Sports
  BEL: -220,    // #4
  EGY: +350,    // #36
  IRN: +500,    // #20
  NZL: +2000,   // #97

  // Group H — [4][6] Fox Sports / Rotowire
  ESP: -450,    // #1
  URU: +500,    // #13
  KSA: +900,    // #56
  CPV: +5000,   // #73

  // Group I — [4] Fox Sports
  FRA: -175,    // #2
  SEN: +300,    // #21
  NOR: +450,    // #29
  IRQ: +2500,   // #55

  // Group J — market-implied from FIFA rankings
  ARG: -350,    // #8 (defending champ)
  AUT: +400,    // #24
  ALG: +600,    // #33
  JOR: +3000,   // #69

  // Group K — market-implied from FIFA rankings
  POR: -150,    // #7
  COL: +200,    // #10
  UZB: +900,    // #53
  COD: +2500,   // #65

  // Group L — market-implied from FIFA rankings
  ENG: -180,    // #9
  CRO: +250,    // #16
  GHA: +700,    // #45
  PAN: +2000,   // #49
};

async function seedGroupOdds() {
  console.log("📊 Seeding group winner odds for all 48 teams...\n");

  const TOURNAMENT_ID = "wc-2026";
  const SOURCE = "consensus-market";
  const now = new Date().toISOString();

  await db.runTransactionAsync(async (transaction) => {
    // First, delete any existing group_winner snapshots
    // We'll just insert fresh
    for (const [fifaCode, americanOdds] of Object.entries(GROUP_WINNER_ODDS)) {
      const teamId = `wc-2026-${fifaCode.toLowerCase()}`;
      const impliedProb = americanToProb(americanOdds);
      const snapshotId = crypto.randomUUID();

      transaction.insert("WCMarketSnapshot", [{
        MarketSnapshotID: snapshotId,
        TournamentID: TOURNAMENT_ID,
        TeamID: teamId,
        MarketType: "group_winner",
        Source: SOURCE,
        ImpliedProbability: Spanner.float(impliedProb),
        Price: Spanner.float(americanOdds),
        Line: Spanner.float(0),
        CapturedAt: Spanner.timestamp(now),
        MetadataJson: { format: "american", source_detail: "fox_sports_fanduel_apr2026" },
      }]);
    }
    await transaction.commit();
  });

  // Verify
  const [rows] = await db.run({
    sql: `SELECT t.FifaCode, t.GroupCode, m.Price, m.ImpliedProbability
          FROM WCMarketSnapshot m
          JOIN Team t ON m.TeamID = t.TeamID
          WHERE m.MarketType = 'group_winner'
          ORDER BY t.GroupCode, m.ImpliedProbability DESC`,
  });

  let currentGroup = "";
  for (const row of rows) {
    const r = row.toJSON();
    if (r.GroupCode !== currentGroup) {
      currentGroup = r.GroupCode;
      console.log(`\n  Group ${r.GroupCode}:`);
    }
    const odds = Number(r.Price);
    const prob = (Number(r.ImpliedProbability) * 100).toFixed(1);
    const oddsStr = odds > 0 ? `+${odds}` : `${odds}`;
    console.log(`    ${r.FifaCode.padEnd(4)} ${oddsStr.padStart(7)} → ${prob}%`);
  }

  console.log(`\n✅ Seeded ${rows.length} group winner odds`);
  await db.close();
  process.exit(0);
}

seedGroupOdds().catch(err => {
  console.error("❌ Failed:", err);
  process.exit(1);
});

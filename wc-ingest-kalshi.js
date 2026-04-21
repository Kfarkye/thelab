#!/usr/bin/env node
/**
 * World Cup 2026 — Ingest Kalshi Tournament Winner Contracts
 * 
 * Source: Kalshi public API (no auth required) [1]
 * Endpoint: https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXMENWORLDCUP&limit=100
 * MarketType: "outright_winner" — binary contracts for each team to win the tournament
 * 
 * [1] https://kalshi.com/developer/docs
 */

const { Spanner } = require("@google-cloud/spanner");
const crypto = require("crypto");

const PROJECT_ID = "workflowos-a0fbf";
const INSTANCE_ID = "game-data";
const DATABASE_ID = "worldcupdb";
const KALSHI_API = "https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXMENWORLDCUP&limit=100";

const spanner = new Spanner({ projectId: PROJECT_ID });
const db = spanner.instance(INSTANCE_ID).database(DATABASE_ID);

// Kalshi ticker suffix → FIFA code mapping
const KALSHI_TO_FIFA = {
  "MX": "MEX", "KR": "KOR", "CZE": "CZE", "RSA": "RSA",
  "CH": "SUI", "CA": "CAN", "BIH": "BIH", "QAT": "QAT",
  "BR": "BRA", "MA": "MAR", "SC": "SCO", "HTI": "HAI",
  "US": "USA", "PY": "PAR", "AU": "AUS", "TR": "TUR",
  "DE": "GER", "EC": "ECU", "CIV": "CIV", "CUW": "CUW",
  "NL": "NED", "JP": "JPN", "SE": "SWE", "TN": "TUN",
  "BE": "BEL", "EGY": "EGY", "IR": "IRN", "NZL": "NZL",
  "ES": "ESP", "UY": "URU", "SA": "KSA", "CPV": "CPV",
  "FR": "FRA", "SN": "SEN", "NO": "NOR", "IRQ": "IRQ",
  "AR": "ARG", "DZA": "ALG", "AT": "AUT", "JOR": "JOR",
  "PT": "POR", "CO": "COL", "UZB": "UZB", "COD": "COD",
  "GB": "ENG", "HR": "CRO", "GH": "GHA", "PAN": "PAN",
};

async function ingestKalshi() {
  console.log("📡 Fetching Kalshi KXMENWORLDCUP contracts...\n");

  const resp = await fetch(KALSHI_API);
  if (!resp.ok) throw new Error(`Kalshi API returned ${resp.status}`);
  const data = await resp.json();

  const activeMarkets = data.markets.filter(m => m.status === "active");
  console.log(`  ${activeMarkets.length} active markets found\n`);

  const TOURNAMENT_ID = "wc-2026";
  const now = new Date().toISOString();
  let matched = 0;
  let skipped = 0;

  // First, delete existing Kalshi snapshots to avoid duplicates
  await db.runTransactionAsync(async (transaction) => {
    await transaction.runUpdate({
      sql: `DELETE FROM WCMarketSnapshot WHERE Source = 'kalshi' AND MarketType = 'outright_winner'`,
    });
    await transaction.commit();
  });

  await db.runTransactionAsync(async (transaction) => {
    for (const market of activeMarkets) {
      // Extract country code from ticker: KXMENWORLDCUP-26-XX → XX
      const tickerParts = market.ticker.split("-");
      const kalshiCode = tickerParts[tickerParts.length - 1];
      const fifaCode = KALSHI_TO_FIFA[kalshiCode];

      if (!fifaCode) {
        console.log(`  ⚠ Skipping ${kalshiCode} — no FIFA mapping`);
        skipped++;
        continue;
      }

      const teamId = `wc-2026-${fifaCode.toLowerCase()}`;
      const lastPrice = parseFloat(market.last_price_dollars);
      const yesBid = parseFloat(market.yes_bid_dollars);
      const yesAsk = parseFloat(market.yes_ask_dollars);
      const midPrice = yesAsk > 0 ? (yesBid + yesAsk) / 2 : lastPrice;
      const volume = parseFloat(market.volume_fp);
      const openInterest = parseFloat(market.open_interest_fp);

      transaction.insert("WCMarketSnapshot", [{
        MarketSnapshotID: crypto.randomUUID(),
        TournamentID: TOURNAMENT_ID,
        TeamID: teamId,
        MarketType: "outright_winner",
        Source: "kalshi",
        ImpliedProbability: Spanner.float(midPrice),     // Kalshi price IS probability
        Price: Spanner.float(lastPrice),
        Line: Spanner.float(0),
        CapturedAt: Spanner.timestamp(now),
        MetadataJson: {
          kalshi_ticker: market.ticker,
          yes_bid: yesBid,
          yes_ask: yesAsk,
          mid_price: midPrice,
          volume: volume,
          open_interest: openInterest,
          volume_24h: parseFloat(market.volume_24h_fp),
        },
      }]);
      matched++;
    }
    await transaction.commit();
  });

  // Verify & display
  const [rows] = await db.run({
    sql: `SELECT t.FifaCode, t.Name, t.GroupCode, m.ImpliedProbability, m.Price,
            JSON_VALUE(m.MetadataJson, '$.volume') AS Volume,
            JSON_VALUE(m.MetadataJson, '$.open_interest') AS OpenInterest
          FROM WCMarketSnapshot m
          JOIN Team t ON m.TeamID = t.TeamID
          WHERE m.Source = 'kalshi' AND m.MarketType = 'outright_winner'
          ORDER BY m.ImpliedProbability DESC`,
  });

  console.log("\n  ── Kalshi Tournament Winner Probabilities ──\n");
  console.log("  Rank  Team                Prob    Price   Volume      OI");
  console.log("  ────  ──────────────────  ─────   ─────   ─────────   ─────────");
  
  rows.forEach((r, i) => {
    const row = r.toJSON();
    const prob = (Number(row.ImpliedProbability) * 100).toFixed(1);
    const price = Number(row.Price).toFixed(4);
    const vol = Number(row.Volume || 0).toLocaleString();
    const oi = Number(row.OpenInterest || 0).toLocaleString();
    console.log(`  ${String(i + 1).padStart(4)}  ${row.Name.padEnd(20)}${prob.padStart(5)}%  ${price.padStart(6)}  ${vol.padStart(10)}  ${oi.padStart(10)}`);
  });

  console.log(`\n✅ Ingested ${matched} Kalshi contracts (${skipped} skipped)`);
  await db.close();
  process.exit(0);
}

ingestKalshi().catch(err => {
  console.error("❌ Failed:", err);
  process.exit(1);
});

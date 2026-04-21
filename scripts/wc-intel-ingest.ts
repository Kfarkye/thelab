/**
 * World Cup 2026 — Intel Ingestion Pipeline
 *
 * Seeds StatusEvent → derives IntelItem → computes Team scores → rolls up MatchIntel
 *
 * Usage: npx tsx wc-intel-ingest.ts
 *
 * Vocabulary lock:
 *   Tags:    OUT | DOUBTFUL | QUESTIONABLE | NEWS
 *   Sources: official_team | official_federation | reputable_reporter | press_conference | broadcast | other
 *   Verify:  unverified | single_source | multi_source | official
 *   Types:   injury | tactical | selection | fitness | discipline | other
 *   Healthy: implicit (no tag stored)
 */

import { Spanner } from "@google-cloud/spanner";
import { randomUUID } from "crypto";

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "workflowos-a0fbf";
const INSTANCE_ID = "game-data";
const DB_ID = "worldcupdb";

const spanner = new Spanner({ projectId: PROJECT_ID });
const db = spanner.instance(INSTANCE_ID).database(DB_ID);

// ── Vocabulary enums (application-layer enforcement) ──────────────

type StatusTag = "OUT" | "DOUBTFUL" | "QUESTIONABLE" | "NEWS";
type SourceClass = "official_team" | "official_federation" | "reputable_reporter" | "press_conference" | "broadcast" | "other";
type VerificationState = "unverified" | "single_source" | "multi_source" | "official";
type IntelType = "injury" | "tactical" | "selection" | "fitness" | "discipline" | "other";

const VALID_TAGS = new Set<StatusTag>(["OUT", "DOUBTFUL", "QUESTIONABLE", "NEWS"]);
const VALID_SOURCES = new Set<SourceClass>(["official_team", "official_federation", "reputable_reporter", "press_conference", "broadcast", "other"]);
const VALID_VERIFY = new Set<VerificationState>(["unverified", "single_source", "multi_source", "official"]);
const VALID_TYPES = new Set<IntelType>(["injury", "tactical", "selection", "fitness", "discipline", "other"]);

function assertTag(tag: string): StatusTag {
  if (!VALID_TAGS.has(tag as StatusTag)) throw new Error(`Invalid tag: ${tag}. Must be one of: ${[...VALID_TAGS].join(", ")}`);
  return tag as StatusTag;
}
function assertSource(src: string): SourceClass {
  if (!VALID_SOURCES.has(src as SourceClass)) throw new Error(`Invalid source_class: ${src}`);
  return src as SourceClass;
}
function assertVerify(v: string): VerificationState {
  if (!VALID_VERIFY.has(v as VerificationState)) throw new Error(`Invalid verification_state: ${v}`);
  return v as VerificationState;
}
function assertType(t: string): IntelType {
  if (!VALID_TYPES.has(t as IntelType)) throw new Error(`Invalid intel type: ${t}`);
  return t as IntelType;
}

// ── Data: realistic intel events for WC 2026 ─────────────────────

interface RawEvent {
  teamFifaCode: string;
  player: string;
  tag: StatusTag;
  type: IntelType;
  impact: number;
  sourceName: string;
  sourceClass: SourceClass;
  sourceUrl?: string;
  verification: VerificationState;
  rawText: string;
}

const INTEL_FEED: RawEvent[] = [
  // Group A — Mexico
  { teamFifaCode: "MEX", player: "Edson Álvarez", tag: "DOUBTFUL", type: "injury", impact: 8, sourceName: "TUDN", sourceClass: "broadcast", verification: "single_source", rawText: "Álvarez did not train with the group today. Hamstring tightness reported after West Ham match." },
  { teamFifaCode: "MEX", player: "Hirving Lozano", tag: "QUESTIONABLE", type: "fitness", impact: 6, sourceName: "ESPN Deportes", sourceClass: "broadcast", verification: "single_source", rawText: "Lozano participated in light training. Match fitness unclear after PSV layoff." },
  // Group C — Brazil
  { teamFifaCode: "BRA", player: "Neymar Jr", tag: "QUESTIONABLE", type: "injury", impact: 10, sourceName: "CBF Official", sourceClass: "official_federation", verification: "official", rawText: "Neymar included in preliminary squad. Final fitness test scheduled 48h before opener." },
  { teamFifaCode: "BRA", player: "Casemiro", tag: "NEWS", type: "tactical", impact: 7, sourceName: "Globo Esporte", sourceClass: "reputable_reporter", verification: "multi_source", rawText: "Dorival considering Casemiro in a deeper role. André and Bruno Guimarães competing for #8 spot." },
  // Group D — USA
  { teamFifaCode: "USA", player: "Christian Pulisic", tag: "NEWS", type: "fitness", impact: 9, sourceName: "US Soccer", sourceClass: "official_federation", verification: "official", rawText: "Pulisic fully fit and available. Trained with the full squad ahead of opener." },
  { teamFifaCode: "USA", player: "Weston McKennie", tag: "QUESTIONABLE", type: "injury", impact: 7, sourceName: "Grant Wahl", sourceClass: "reputable_reporter", verification: "single_source", rawText: "McKennie nursing a minor calf issue from Juventus duty. Expected to be available but being managed." },
  { teamFifaCode: "USA", player: "Tim Weah", tag: "OUT", type: "discipline", impact: 6, sourceName: "FIFA Disciplinary", sourceClass: "official_federation", verification: "official", rawText: "Weah suspended one match following accumulation of yellow cards in qualifying." },
  // Group E — Germany
  { teamFifaCode: "GER", player: "Jamal Musiala", tag: "NEWS", type: "tactical", impact: 9, sourceName: "Kicker", sourceClass: "reputable_reporter", verification: "multi_source", rawText: "Nagelsmann confirms Musiala will play as false 9 in group stage opener." },
  { teamFifaCode: "GER", player: "Antonio Rüdiger", tag: "DOUBTFUL", type: "injury", impact: 8, sourceName: "Real Madrid CF", sourceClass: "official_team", verification: "official", rawText: "Rüdiger reported thigh discomfort in final Liga match. Status for opener uncertain." },
  // Group H — Spain
  { teamFifaCode: "ESP", player: "Pedri", tag: "QUESTIONABLE", type: "injury", impact: 9, sourceName: "Marca", sourceClass: "reputable_reporter", verification: "single_source", rawText: "Pedri sat out Tuesday's session with left knee swelling. 'Day-to-day' per coaching staff." },
  { teamFifaCode: "ESP", player: "Gavi", tag: "OUT", type: "injury", impact: 8, sourceName: "RFEF", sourceClass: "official_federation", verification: "official", rawText: "Gavi not included in final 26-man squad following ACL recovery timeline." },
  // Group I — France
  { teamFifaCode: "FRA", player: "Kylian Mbappé", tag: "NEWS", type: "tactical", impact: 10, sourceName: "L'Équipe", sourceClass: "reputable_reporter", verification: "multi_source", rawText: "Mbappé expected to lead the line as sole striker. Deschamps moving away from 4-4-2." },
  { teamFifaCode: "FRA", player: "N'Golo Kanté", tag: "DOUBTFUL", type: "fitness", impact: 7, sourceName: "RMC Sport", sourceClass: "broadcast", verification: "single_source", rawText: "Kanté's playing time at Al-Ittihad raises questions about match fitness at this level." },
  // Group J — Argentina
  { teamFifaCode: "ARG", player: "Lionel Messi", tag: "QUESTIONABLE", type: "fitness", impact: 10, sourceName: "TyC Sports", sourceClass: "broadcast", verification: "multi_source", rawText: "Messi managing minutes carefully. Inter Miami workload plan in place through June." },
  { teamFifaCode: "ARG", player: "Ángel Di María", tag: "NEWS", type: "selection", impact: 5, sourceName: "AFA", sourceClass: "official_federation", verification: "official", rawText: "Di María confirmed retirement from national team stands. Will not be in the squad." },
  // Group K — Portugal
  { teamFifaCode: "POR", player: "Cristiano Ronaldo", tag: "NEWS", type: "fitness", impact: 9, sourceName: "A Bola", sourceClass: "reputable_reporter", verification: "single_source", rawText: "Ronaldo declared fit. Al-Nassr minutes steady. Martínez expected to start him." },
  { teamFifaCode: "POR", player: "Diogo Jota", tag: "OUT", type: "injury", impact: 7, sourceName: "FPF", sourceClass: "official_federation", verification: "official", rawText: "Jota ruled out of the tournament. Knee injury sustained in Champions League semifinal." },
  // Group L — England
  { teamFifaCode: "ENG", player: "Jude Bellingham", tag: "NEWS", type: "tactical", impact: 9, sourceName: "The Athletic", sourceClass: "reputable_reporter", verification: "multi_source", rawText: "Bellingham to operate as a 10 behind Kane. Southgate confirms system switch from Euros." },
  { teamFifaCode: "ENG", player: "Luke Shaw", tag: "DOUBTFUL", type: "injury", impact: 6, sourceName: "Manchester United", sourceClass: "official_team", verification: "official", rawText: "Shaw has resumed individual training but remains unlikely for the group stage opener." },
];

// ── Step 1: Resolve TeamID from FifaCode ─────────────────────────

async function getTeamIdMap(): Promise<Map<string, string>> {
  const [rows] = await db.run({ sql: "SELECT TeamID, FifaCode FROM Team" });
  const map = new Map<string, string>();
  for (const r of rows) {
    const row = r.toJSON();
    map.set(row.FifaCode, row.TeamID);
  }
  return map;
}

// ── Step 2: Insert StatusEvents ──────────────────────────────────

async function insertStatusEvents(teamMap: Map<string, string>): Promise<Map<string, string>> {
  const eventIdMap = new Map<string, string>();

  await db.runTransactionAsync(async (transaction) => {
    for (const evt of INTEL_FEED) {
      const teamId = teamMap.get(evt.teamFifaCode);
      if (!teamId) {
        console.warn(`  ⚠ No team found for ${evt.teamFifaCode}, skipping ${evt.player}`);
        continue;
      }

      assertTag(evt.tag);
      assertSource(evt.sourceClass);
      assertVerify(evt.verification);

      const eventId = randomUUID();
      eventIdMap.set(`${evt.teamFifaCode}:${evt.player}`, eventId);

      transaction.insert("StatusEvent", {
        EventID: eventId,
        EntityID: evt.player,
        EntityType: "player",
        TeamID: teamId,
        TimestampPT: Spanner.timestamp(new Date()),
        SourceName: evt.sourceName,
        SourceClass: evt.sourceClass,
        SourceURL: evt.sourceUrl || null,
        VerificationState: evt.verification,
        RawText: evt.rawText,
        ParsedTag: evt.tag,
        CreatedAt: Spanner.COMMIT_TIMESTAMP,
      });
    }
    await transaction.commit();
  });

  console.log(`  ✓ StatusEvent: ${INTEL_FEED.length} events inserted`);
  return eventIdMap;
}

// ── Step 3: Derive IntelItems ────────────────────────────────────

async function deriveIntelItems(teamMap: Map<string, string>, eventIdMap: Map<string, string>): Promise<void> {
  let count = 0;

  await db.runTransactionAsync(async (transaction) => {
    for (const evt of INTEL_FEED) {
      const teamId = teamMap.get(evt.teamFifaCode);
      if (!teamId) continue;

      assertType(evt.type);
      const key = `${evt.teamFifaCode}:${evt.player}`;
      const eventId = eventIdMap.get(key) || null;

      transaction.insert("IntelItem", {
        IntelItemID: randomUUID(),
        TeamID: teamId,
        Player: evt.player,
        Tag: evt.tag,
        Type: evt.type,
        Impact: evt.impact,
        LatestEventID: eventId,
        UpdatedAt: Spanner.COMMIT_TIMESTAMP,
      });
      count++;
    }
    await transaction.commit();
  });

  console.log(`  ✓ IntelItem: ${count} items derived`);
}

// ── Step 4: Compute Team derived scores ──────────────────────────

async function computeTeamScores(teamMap: Map<string, string>): Promise<void> {
  // Count active statuses per team
  const [rows] = await db.run({
    sql: `SELECT TeamID, Tag, COUNT(*) as cnt, SUM(Impact) as totalImpact
          FROM IntelItem
          GROUP BY TeamID, Tag`,
  });

  // Build per-team aggregates
  const teamAgg = new Map<string, {
    out: number; doubtful: number; questionable: number; news: number;
    outImpact: number; doubtfulImpact: number; questionableImpact: number;
  }>();

  for (const r of rows) {
    const row = r.toJSON();
    const tid = row.TeamID as string;
    if (!teamAgg.has(tid)) {
      teamAgg.set(tid, { out: 0, doubtful: 0, questionable: 0, news: 0, outImpact: 0, doubtfulImpact: 0, questionableImpact: 0 });
    }
    const agg = teamAgg.get(tid)!;
    const cnt = Number(row.cnt);
    const impact = Number(row.totalImpact);

    switch (row.Tag) {
      case "OUT": agg.out = cnt; agg.outImpact = impact; break;
      case "DOUBTFUL": agg.doubtful = cnt; agg.doubtfulImpact = impact; break;
      case "QUESTIONABLE": agg.questionable = cnt; agg.questionableImpact = impact; break;
      case "NEWS": agg.news = cnt; break;
    }
  }

  // Compute derived scores and update Team table via DML
  for (const [teamId, agg] of teamAgg) {
    const availLoss = Math.min(100, (agg.outImpact * 10 + agg.doubtfulImpact * 5) / 2);
    const tacticalDisruption = Math.min(100, agg.questionableImpact * 6);
    const healthScore = Math.max(0, 100 - availLoss - (tacticalDisruption * 0.3));

    await db.runTransactionAsync(async (transaction) => {
      await transaction.runUpdate({
        sql: `UPDATE Team SET
                SquadHealthScore = @health,
                AvailabilityLossScore = @avail,
                TacticalDisruptionScore = @tactical,
                ActiveOutCount = @outCnt,
                ActiveDoubtfulCount = @doubtCnt,
                ActiveQuestionableCount = @questCnt,
                ActiveNewsCount = @newsCnt
              WHERE TeamID = @teamId`,
        params: {
          health: Spanner.float(Math.round(healthScore * 10) / 10),
          avail: Spanner.float(Math.round(availLoss * 10) / 10),
          tactical: Spanner.float(Math.round(tacticalDisruption * 10) / 10),
          outCnt: agg.out,
          doubtCnt: agg.doubtful,
          questCnt: agg.questionable,
          newsCnt: agg.news,
          teamId: teamId,
        },
      });
      await transaction.commit();
    });
  }

  console.log(`  ✓ Team scores: ${teamAgg.size} teams updated`);
}

// ── Step 5: Roll up MatchIntel volatility ────────────────────────

async function rollupMatchIntel(): Promise<void> {
  // Get all matches with team IDs
  const [matchRows] = await db.run({
    sql: `SELECT MatchID, HomeTeamID, AwayTeamID FROM Match WHERE HomeTeamID IS NOT NULL AND AwayTeamID IS NOT NULL`,
  });

  let count = 0;
  // Batch into groups of 20 to stay under Spanner mutation limits
  const BATCH_SIZE = 20;
  for (let i = 0; i < matchRows.length; i += BATCH_SIZE) {
    const batch = matchRows.slice(i, i + BATCH_SIZE);

    await db.runTransactionAsync(async (transaction) => {
      for (const r of batch) {
        const row = r.toJSON();
        const matchId = row.MatchID as string;
        const homeId = row.HomeTeamID as string;
        const awayId = row.AwayTeamID as string;

        // Get high-impact intel for both teams (read inside txn)
        const [intelRows] = await transaction.run({
          sql: `SELECT Player, Tag, Impact, TeamID
                FROM IntelItem
                WHERE TeamID IN UNNEST(@teamIds) AND Impact >= 7
                ORDER BY Impact DESC`,
          params: { teamIds: [homeId, awayId] },
          types: { teamIds: { type: "array", child: { type: "string" } } },
        });

        // Determine volatility
        const hasOut = intelRows.some((ir) => ir.toJSON().Tag === "OUT");
        const hasDoubtful = intelRows.some((ir) => ir.toJSON().Tag === "DOUBTFUL");
        const highImpactCount = intelRows.length;

        let volatility: "high" | "medium" | "low";
        if (hasOut && highImpactCount >= 2) volatility = "high";
        else if (hasDoubtful || highImpactCount >= 1) volatility = "medium";
        else volatility = "low";

        const drivers = intelRows.map((ir) => ir.toJSON().Player as string);

        transaction.insert("MatchIntel", {
          MatchIntelID: randomUUID(),
          MatchID: matchId,
          Volatility: volatility,
          SideMove24h: null,
          TotalMove24h: null,
          StatusDrivers: drivers.length > 0 ? JSON.stringify(drivers) : null,
          UpdatedAt: Spanner.COMMIT_TIMESTAMP,
        });

        count++;
      }
      await transaction.commit();
    });
  }

  console.log(`  ✓ MatchIntel: ${count} matches assessed`);
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log("═══ World Cup Intel Ingestion ═══\n");

  console.log("[1/5] Resolving team IDs...");
  const teamMap = await getTeamIdMap();
  console.log(`  ✓ ${teamMap.size} teams mapped\n`);

  console.log("[2/5] Inserting StatusEvents...");
  const eventIdMap = await insertStatusEvents(teamMap);
  console.log();

  console.log("[3/5] Deriving IntelItems...");
  await deriveIntelItems(teamMap, eventIdMap);
  console.log();

  console.log("[4/5] Computing Team scores...");
  await computeTeamScores(teamMap);
  console.log();

  console.log("[5/5] Rolling up MatchIntel volatility...");
  await rollupMatchIntel();
  console.log();

  console.log("═══ Done. ═══");
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});

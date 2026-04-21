import { NextRequest } from "next/server";
import { mapCandidateRow } from "@/lib/mappers/candidate";
import type { CandidateRecord } from "@/lib/types/candidate";
import { queryMarginLedger, queryJobBoard } from "@/lib/ayaops/margin-ledger";
import { getDb } from "@/lib/spanner-pool";
import type { Spanner } from "@google-cloud/spanner";
import { listVerdicts } from "@/lib/verdicts/verdict-ledger";

let priorityColumnPresence: { score: boolean; level: boolean } | null = null;

const SPORTS_SUPPORTED_LEAGUES = [
  { key: "epl", label: "EPL", leagueIds: ["eng.1"] },
  { key: "la_liga", label: "La Liga", leagueIds: ["esp.1"] },
  { key: "serie_a", label: "Serie A", leagueIds: ["ita.1"] },
  { key: "bundesliga", label: "Bundesliga", leagueIds: ["ger.1"] },
  { key: "ligue_1", label: "Ligue 1", leagueIds: ["fra.1", "ligue1"] },
  { key: "mls", label: "MLS", leagueIds: ["usa.1"] },
  { key: "liga_mx", label: "Liga MX", leagueIds: ["mex.1"] },
  { key: "eredivisie", label: "Eredivisie", leagueIds: ["ned.1"] },
  { key: "primeira_liga", label: "Primeira Liga", leagueIds: ["por.1"] },
  { key: "scottish_premiership", label: "Scottish Premiership", leagueIds: ["sco.1"] },
  { key: "super_lig", label: "Super Lig", leagueIds: ["tur.1"] },
  { key: "argentina_primera", label: "Argentina Primera", leagueIds: ["arg.1"] },
  { key: "belgian_pro_league", label: "Belgian Pro League", leagueIds: ["bel.1"] },
  { key: "brasileirao", label: "Brasileirao", leagueIds: ["bra.1"] },
  { key: "champions_league", label: "Champions League", leagueIds: ["uefa.champions"] },
  { key: "europa_league", label: "Europa League", leagueIds: ["uefa.europa"] },
] as const;

const SPORTS_SUPPORTED_LEAGUES_UI = SPORTS_SUPPORTED_LEAGUES.map(({ key, label }) => ({ key, label }));
const SPORTS_SOCCER_LEAGUE_IDS = Array.from(
  new Set(SPORTS_SUPPORTED_LEAGUES.flatMap((league) => [...league.leagueIds]))
);
const SPORTS_LEAGUE_LABEL_BY_ID = new Map<string, string>();
for (const league of SPORTS_SUPPORTED_LEAGUES) {
  for (const leagueId of league.leagueIds) {
    SPORTS_LEAGUE_LABEL_BY_ID.set(leagueId, league.label);
  }
}
SPORTS_LEAGUE_LABEL_BY_ID.set("nba", "NBA");
SPORTS_LEAGUE_LABEL_BY_ID.set("nhl", "NHL");

/**
 * GET /api/summary?mode=healthcare|sports|code
 *
 * Returns Pulse Card metrics + filterable item list from Spanner.
 * Each mode queries its own database.
 */
export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode") || "healthcare";

  try {
    if (mode === "healthcare") {
      return await healthcareSummary();
    } else if (mode === "sports") {
      return await sportsSummary();
    } else if (mode === "worldcup") {
      return await worldcupSummary();
    } else if (mode === "facility") {
      return await facilitySummary();
    } else if (mode === "margins") {
      return await marginsSummary();
    } else if (mode === "jobs") {
      return await jobsSummary();
    } else if (mode === "ayaops") {
      return await ayaopsSummary();
    } else {
      return codeSummary();
    }
  } catch (error) {
    console.error(`Summary error (${mode}):`, error);
    return Response.json({ error: "Failed to load summary" }, { status: 500 });
  }
}

async function healthcareSummary() {
  const db = getDb("licensingdb");

  // Pulse metrics
  const [pulseRows] = await db.run({
    sql: `SELECT 
      COUNT(*) as total,
      COUNT(DISTINCT state_name) as states,
      COUNT(DISTINCT profession) as professions
    FROM licenses`,
  });
  const pulse = pulseRows[0]?.toJSON() || { total: 0, states: 0, professions: 0 };

  // Recent items for filterable list
  const [itemRows] = await db.run({
    sql: `SELECT slug, state_name, profession, initial_fee_amount, board_name, compact_member, processing_time_days, renewal_fee_amount
          FROM licenses
          ORDER BY state_name, profession
          LIMIT 200`,
  });

  const items = itemRows.map((r: any) => {
    const row = r.toJSON();
    const days = row.processing_time_days ? Number(row.processing_time_days) : null;
    let timeline: string | undefined;
    if (days) {
      timeline = days >= 365
        ? `~${Math.round(days / 365)} yr`
        : days >= 60
        ? `~${Math.round(days / 30)} mo`
        : `~${days} days`;
    }
    return {
      id: row.slug,
      label: `${row.state_name} — ${row.profession}`,
      state: row.state_name,
      profession: row.profession,
      fee: row.initial_fee_amount,
      board: row.board_name,
      compact: row.compact_member,
      description: timeline,
      renewalFee: row.renewal_fee_amount || undefined,
    };
  });

  // Profession counts for secondary pulse
  const [profRows] = await db.run({
    sql: `SELECT profession, COUNT(*) as count 
          FROM licenses 
          GROUP BY profession 
          ORDER BY count DESC 
          LIMIT 6`,
  });
  const topProfessions = profRows.map((r: any) => {
    const row = r.toJSON();
    return { name: row.profession, count: row.count };
  });

  return Response.json({
    pulse: {
      states: Number(pulse.states),
      professions: Number(pulse.professions),
      total: Number(pulse.total),
    },
    topProfessions,
    items,
  });
}

async function sportsSummary() {
  const db = getDb("sportsdb");

  const [previewTableRows] = await db.run({
    sql: `SELECT TABLE_NAME
          FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = ''
            AND TABLE_NAME = 'GamePreview'`,
  });
  const hasGamePreviewTable = previewTableRows.length > 0;

  const gameListSql = hasGamePreviewTable
    ? `SELECT g.GameID, g.GameDate, g.ScheduledStartAt, g.Status,
          h.Name as home_team, h.Abbrev as home_abbrev, h.LogoURL as home_logo,
          a.Name as away_team, a.Abbrev as away_abbrev, a.LogoURL as away_logo,
          g.Venue,
          p.WriteupUrl, p.PublishedAt
        FROM Game g
        LEFT JOIN Team h ON g.HomeTeamID = h.TeamID
        LEFT JOIN Team a ON g.AwayTeamID = a.TeamID
        LEFT JOIN GamePreview p ON p.GameID = g.GameID
        WHERE g.ScheduledStartAt >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
          AND g.ScheduledStartAt <= TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
        ORDER BY g.ScheduledStartAt ASC
        LIMIT 300`
    : `SELECT g.GameID, g.GameDate, g.ScheduledStartAt, g.Status,
          h.Name as home_team, h.Abbrev as home_abbrev, h.LogoURL as home_logo,
          a.Name as away_team, a.Abbrev as away_abbrev, a.LogoURL as away_logo,
          g.Venue,
          CAST(NULL AS STRING) AS WriteupUrl,
          CAST(NULL AS TIMESTAMP) AS PublishedAt
        FROM Game g
        LEFT JOIN Team h ON g.HomeTeamID = h.TeamID
        LEFT JOIN Team a ON g.AwayTeamID = a.TeamID
        WHERE g.ScheduledStartAt >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
          AND g.ScheduledStartAt <= TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
        ORDER BY g.ScheduledStartAt ASC
        LIMIT 300`;

  const [gameListRows] = await db.run({ sql: gameListSql });

  const toIsoOrNull = (value: unknown): string | null => {
    if (value == null) return null;
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  };

  const mlbItems = gameListRows.map((r: any) => {
    const row = r.toJSON();
    const awayName = (row.away_team as string) || "TBD";
    const homeName = (row.home_team as string) || "TBD";
    const awayAbbrev = (row.away_abbrev as string) || awayName;
    const homeAbbrev = (row.home_abbrev as string) || homeName;
    const writeupUrlRaw = typeof row.WriteupUrl === "string" ? row.WriteupUrl.trim() : "";
    const writeupUrl = /^https:\/\//i.test(writeupUrlRaw) ? writeupUrlRaw : null;
    return {
      id: row.GameID as string,
      label: `${awayAbbrev} @ ${homeAbbrev}`,
      home: homeName,
      away: awayName,
      homeLogo: (row.home_logo as string) || null,
      awayLogo: (row.away_logo as string) || null,
      date: (row.GameDate as string) || null,
      startTime: toIsoOrNull(row.ScheduledStartAt),
      status: (row.Status as string) || null,
      venue: (row.Venue as string) || null,
      league: "MLB",
      writeupUrl,
      publishedAt: toIsoOrNull(row.PublishedAt),
      homeRecord: null as string | null,
      awayRecord: null as string | null,
      spread: null as number | null,
      total: null as number | null,
    };
  });

  // Enrich MLB items with records + odds from GameResult (populated by sports-sync)
  try {
    const mlbGrSql = `SELECT
          gr.MatchID,
          MIN(gr.GameDate) AS GameDate,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamName END) AS HomeTeam,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamRecord END) AS HomeRecord,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamRecord END) AS AwayRecord,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingSpread END) AS Spread,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingTotal END) AS Total,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamLogoURL END) AS HomeLogo,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamLogoURL END) AS AwayLogo
        FROM GameResult gr
        WHERE LOWER(gr.Sport) = 'baseball'
          AND LOWER(gr.LeagueID) = 'mlb'
          AND gr.StartTime >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
        GROUP BY gr.MatchID
        LIMIT 300`;
    const [mlbGrRows] = await db.run({ sql: mlbGrSql });
    // Build lookup: homeTeam+gameDate → records/odds
    const mlbEnrich = new Map<string, { homeRecord: string | null; awayRecord: string | null; spread: number | null; total: number | null; homeLogo: string | null; awayLogo: string | null }>();
    for (const r of mlbGrRows) {
      const row = r.toJSON();
      const key = `${((row.HomeTeam as string) || "").toLowerCase()}_${(row.GameDate as string) || ""}`;
      mlbEnrich.set(key, {
        homeRecord: (row.HomeRecord as string) || null,
        awayRecord: (row.AwayRecord as string) || null,
        spread: row.Spread != null ? parseFloat(String(row.Spread)) : null,
        total: row.Total != null ? parseFloat(String(row.Total)) : null,
        homeLogo: (row.HomeLogo as string) || null,
        awayLogo: (row.AwayLogo as string) || null,
      });
    }
    // Merge into mlbItems
    for (const item of mlbItems) {
      const key = `${(item.home || "").toLowerCase()}_${item.date || ""}`;
      const enrichment = mlbEnrich.get(key);
      if (enrichment) {
        item.homeRecord = enrichment.homeRecord;
        item.awayRecord = enrichment.awayRecord;
        item.spread = enrichment.spread;
        item.total = enrichment.total;
        // Use ESPN logos if Game table logos are missing
        if (!item.homeLogo && enrichment.homeLogo) item.homeLogo = enrichment.homeLogo;
        if (!item.awayLogo && enrichment.awayLogo) item.awayLogo = enrichment.awayLogo;
      }
    }
  } catch (e) {
    console.warn("MLB GameResult enrichment failed:", e);
  }

  const soccerLeagueListSql = SPORTS_SOCCER_LEAGUE_IDS
    .map((leagueId) => `'${leagueId.replace(/'/g, "''")}'`)
    .join(", ");
  const soccerLeaguePredicate = soccerLeagueListSql
    ? `AND gr.LeagueID IN (${soccerLeagueListSql})`
    : "";

  const soccerSql = hasGamePreviewTable
    ? `SELECT
          gr.MatchID,
          MIN(gr.GameDate) AS GameDate,
          MIN(gr.StartTime) AS StartTime,
          MIN(gr.LeagueID) AS LeagueID,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamName END) AS HomeTeam,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamName END) AS AwayTeam,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.OpponentName END) AS AwayFromHome,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.OpponentName END) AS HomeFromAway,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamLogoURL END) AS HomeLogo,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamLogoURL END) AS AwayLogo,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamRecord END) AS HomeRecord,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamRecord END) AS AwayRecord,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingSpread END) AS Spread,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingTotal END) AS Total,
          p.WriteupUrl,
          p.PublishedAt
        FROM GameResult gr
        LEFT JOIN GamePreview p ON p.GameID = gr.MatchID
        WHERE LOWER(gr.Sport) = 'soccer'
          AND gr.StartTime >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 14 DAY)
          ${soccerLeaguePredicate}
        GROUP BY gr.MatchID, p.WriteupUrl, p.PublishedAt
        ORDER BY StartTime ASC
        LIMIT 220`
    : `SELECT
          gr.MatchID,
          MIN(gr.GameDate) AS GameDate,
          MIN(gr.StartTime) AS StartTime,
          MIN(gr.LeagueID) AS LeagueID,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamName END) AS HomeTeam,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamName END) AS AwayTeam,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.OpponentName END) AS AwayFromHome,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.OpponentName END) AS HomeFromAway,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamLogoURL END) AS HomeLogo,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamLogoURL END) AS AwayLogo,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamRecord END) AS HomeRecord,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamRecord END) AS AwayRecord,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingSpread END) AS Spread,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingTotal END) AS Total,
          CAST(NULL AS STRING) AS WriteupUrl,
          CAST(NULL AS TIMESTAMP) AS PublishedAt
        FROM GameResult gr
        WHERE LOWER(gr.Sport) = 'soccer'
          AND gr.StartTime >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 14 DAY)
          ${soccerLeaguePredicate}
        GROUP BY gr.MatchID
        ORDER BY StartTime ASC
        LIMIT 220`;

  const [soccerRows] = await db.run({ sql: soccerSql });
  const nbaSql = hasGamePreviewTable
    ? `SELECT
          gr.MatchID,
          MIN(gr.GameDate) AS GameDate,
          MIN(gr.StartTime) AS StartTime,
          MIN(gr.LeagueID) AS LeagueID,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamName END) AS HomeTeam,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamName END) AS AwayTeam,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.OpponentName END) AS AwayFromHome,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.OpponentName END) AS HomeFromAway,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamLogoURL END) AS HomeLogo,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamLogoURL END) AS AwayLogo,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamRecord END) AS HomeRecord,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamRecord END) AS AwayRecord,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingSpread END) AS Spread,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingTotal END) AS Total,
          p.WriteupUrl,
          p.PublishedAt
        FROM GameResult gr
        LEFT JOIN GamePreview p ON p.GameID = gr.MatchID
        WHERE LOWER(gr.Sport) = 'basketball'
          AND LOWER(gr.LeagueID) = 'nba'
          AND gr.StartTime >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 14 DAY)
        GROUP BY gr.MatchID, p.WriteupUrl, p.PublishedAt
        ORDER BY StartTime ASC
        LIMIT 220`
    : `SELECT
          gr.MatchID,
          MIN(gr.GameDate) AS GameDate,
          MIN(gr.StartTime) AS StartTime,
          MIN(gr.LeagueID) AS LeagueID,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamName END) AS HomeTeam,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamName END) AS AwayTeam,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.OpponentName END) AS AwayFromHome,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.OpponentName END) AS HomeFromAway,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamLogoURL END) AS HomeLogo,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamLogoURL END) AS AwayLogo,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamRecord END) AS HomeRecord,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamRecord END) AS AwayRecord,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingSpread END) AS Spread,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingTotal END) AS Total,
          CAST(NULL AS STRING) AS WriteupUrl,
          CAST(NULL AS TIMESTAMP) AS PublishedAt
        FROM GameResult gr
        WHERE LOWER(gr.Sport) = 'basketball'
          AND LOWER(gr.LeagueID) = 'nba'
          AND gr.StartTime >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 14 DAY)
        GROUP BY gr.MatchID
        ORDER BY StartTime ASC
        LIMIT 220`;

  const [nbaRows] = await db.run({ sql: nbaSql });
  const nhlSql = hasGamePreviewTable
    ? `SELECT
          gr.MatchID,
          MIN(gr.GameDate) AS GameDate,
          MIN(gr.StartTime) AS StartTime,
          MIN(gr.LeagueID) AS LeagueID,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamName END) AS HomeTeam,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamName END) AS AwayTeam,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.OpponentName END) AS AwayFromHome,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.OpponentName END) AS HomeFromAway,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamLogoURL END) AS HomeLogo,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamLogoURL END) AS AwayLogo,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamRecord END) AS HomeRecord,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamRecord END) AS AwayRecord,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingSpread END) AS Spread,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingTotal END) AS Total,
          p.WriteupUrl,
          p.PublishedAt
        FROM GameResult gr
        LEFT JOIN GamePreview p ON p.GameID = gr.MatchID
        WHERE LOWER(gr.Sport) = 'icehockey'
          AND LOWER(gr.LeagueID) = 'nhl'
          AND gr.StartTime >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 14 DAY)
        GROUP BY gr.MatchID, p.WriteupUrl, p.PublishedAt
        ORDER BY StartTime ASC
        LIMIT 220`
    : `SELECT
          gr.MatchID,
          MIN(gr.GameDate) AS GameDate,
          MIN(gr.StartTime) AS StartTime,
          MIN(gr.LeagueID) AS LeagueID,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamName END) AS HomeTeam,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamName END) AS AwayTeam,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.OpponentName END) AS AwayFromHome,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.OpponentName END) AS HomeFromAway,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamLogoURL END) AS HomeLogo,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamLogoURL END) AS AwayLogo,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamRecord END) AS HomeRecord,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamRecord END) AS AwayRecord,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingSpread END) AS Spread,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingTotal END) AS Total,
          CAST(NULL AS STRING) AS WriteupUrl,
          CAST(NULL AS TIMESTAMP) AS PublishedAt
        FROM GameResult gr
        WHERE LOWER(gr.Sport) = 'icehockey'
          AND LOWER(gr.LeagueID) = 'nhl'
          AND gr.StartTime >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 14 DAY)
        GROUP BY gr.MatchID
        ORDER BY StartTime ASC
        LIMIT 220`;

  const [nhlRows] = await db.run({ sql: nhlSql });
  const nowTs = Date.now();
  const soccerItems = soccerRows.map((r: any) => {
    const row = r.toJSON();
    const homeName = (row.HomeTeam as string) || (row.HomeFromAway as string) || "TBD";
    const awayName = (row.AwayTeam as string) || (row.AwayFromHome as string) || "TBD";
    const startTime = toIsoOrNull(row.StartTime);
    const leagueId = (row.LeagueID as string) || "";
    const writeupUrlRaw = typeof row.WriteupUrl === "string" ? row.WriteupUrl.trim() : "";
    const writeupUrl = /^https:\/\//i.test(writeupUrlRaw) ? writeupUrlRaw : null;

    return {
      id: row.MatchID as string,
      label: `${awayName} @ ${homeName}`,
      home: homeName,
      away: awayName,
      homeLogo: (row.HomeLogo as string) || null,
      awayLogo: (row.AwayLogo as string) || null,
      date: (row.GameDate as string) || (startTime ? startTime.slice(0, 10) : null),
      startTime,
      status:
        startTime && new Date(startTime).getTime() > nowTs
          ? "scheduled"
          : "post",
      venue: null,
      league: SPORTS_LEAGUE_LABEL_BY_ID.get(leagueId) || leagueId || "Soccer",
      writeupUrl,
      publishedAt: toIsoOrNull(row.PublishedAt),
      homeRecord: (row.HomeRecord as string) || null,
      awayRecord: (row.AwayRecord as string) || null,
      spread: row.Spread != null ? parseFloat(String(row.Spread)) : null,
      total: row.Total != null ? parseFloat(String(row.Total)) : null,
    };
  });

  const nbaItems = nbaRows.map((r: any) => {
    const row = r.toJSON();
    const homeName = (row.HomeTeam as string) || (row.HomeFromAway as string) || "TBD";
    const awayName = (row.AwayTeam as string) || (row.AwayFromHome as string) || "TBD";
    const startTime = toIsoOrNull(row.StartTime);
    const leagueId = ((row.LeagueID as string) || "").toLowerCase();
    const writeupUrlRaw = typeof row.WriteupUrl === "string" ? row.WriteupUrl.trim() : "";
    const writeupUrl = /^https:\/\//i.test(writeupUrlRaw) ? writeupUrlRaw : null;

    return {
      id: row.MatchID as string,
      label: `${awayName} @ ${homeName}`,
      home: homeName,
      away: awayName,
      homeLogo: (row.HomeLogo as string) || null,
      awayLogo: (row.AwayLogo as string) || null,
      date: (row.GameDate as string) || (startTime ? startTime.slice(0, 10) : null),
      startTime,
      status:
        startTime && new Date(startTime).getTime() > nowTs
          ? "scheduled"
          : "post",
      venue: null,
      league: "NBA",
      writeupUrl,
      publishedAt: toIsoOrNull(row.PublishedAt),
      homeRecord: (row.HomeRecord as string) || null,
      awayRecord: (row.AwayRecord as string) || null,
      spread: row.Spread != null ? parseFloat(String(row.Spread)) : null,
      total: row.Total != null ? parseFloat(String(row.Total)) : null,
    };
  });

  const nhlItems = nhlRows.map((r: any) => {
    const row = r.toJSON();
    const homeName = (row.HomeTeam as string) || (row.HomeFromAway as string) || "TBD";
    const awayName = (row.AwayTeam as string) || (row.AwayFromHome as string) || "TBD";
    const startTime = toIsoOrNull(row.StartTime);
    const leagueId = ((row.LeagueID as string) || "").toLowerCase();
    const writeupUrlRaw = typeof row.WriteupUrl === "string" ? row.WriteupUrl.trim() : "";
    const writeupUrl = /^https:\/\//i.test(writeupUrlRaw) ? writeupUrlRaw : null;

    return {
      id: row.MatchID as string,
      label: `${awayName} @ ${homeName}`,
      home: homeName,
      away: awayName,
      homeLogo: (row.HomeLogo as string) || null,
      awayLogo: (row.AwayLogo as string) || null,
      date: (row.GameDate as string) || (startTime ? startTime.slice(0, 10) : null),
      startTime,
      status:
        startTime && new Date(startTime).getTime() > nowTs
          ? "scheduled"
          : "post",
      venue: null,
      league: "NHL",
      writeupUrl,
      publishedAt: toIsoOrNull(row.PublishedAt),
      homeRecord: (row.HomeRecord as string) || null,
      awayRecord: (row.AwayRecord as string) || null,
      spread: row.Spread != null ? parseFloat(String(row.Spread)) : null,
      total: row.Total != null ? parseFloat(String(row.Total)) : null,
    };
  });

  const items = [...mlbItems, ...soccerItems, ...nbaItems, ...nhlItems].sort((a: any, b: any) => {
    const aTime = a.startTime || `${a.date || "1970-01-01"}T00:00:00.000Z`;
    const bTime = b.startTime || `${b.date || "1970-01-01"}T00:00:00.000Z`;
    if (aTime < bTime) return -1;
    if (aTime > bTime) return 1;
    return String(a.label || "").localeCompare(String(b.label || ""));
  });

  const slateSet = new Set<string>();
  for (const item of items) {
    const dateKey = item.startTime ? item.startTime.slice(0, 10) : (item.date || "").slice(0, 10);
    if (dateKey) slateSet.add(dateKey);
  }

  return Response.json({
    pulse: {
      games: items.length,
      slates: slateSet.size,
      previews: items.filter((item: any) => Boolean(item.writeupUrl)).length,
    },
    supportedLeagues: SPORTS_SUPPORTED_LEAGUES_UI,
    items,
  });
}

async function codeSummary() {
  try {
    const verdicts = await listVerdicts({ limit: 100 });

    const statusCounts = { proposed: 0, accepted: 0, rejected: 0, superseded: 0 };
    const agentCounts: Record<string, number> = {};

    for (const v of verdicts) {
      if (v.status in statusCounts) {
        statusCounts[v.status as keyof typeof statusCounts]++;
      }
      agentCounts[v.agent_source] = (agentCounts[v.agent_source] || 0) + 1;
    }

    const items = verdicts.map((v) => ({
      id: v.verdict_id,
      label: v.title,
      agent: v.agent_source,
      category: v.category,
      status: v.status,
      riskZones: v.risk_zones,
      filesTouched: v.files_touched,
      refs: v.refs,
      supersededBy: v.superseded_by,
      createdAt: v.created_at,
      updatedAt: v.updated_at,
      // First 200 chars of body as preview
      preview: v.body.length > 200 ? v.body.slice(0, 200) + "..." : v.body,
    }));

    return Response.json({
      pulse: {
        verdicts: verdicts.length,
        proposed: statusCounts.proposed,
        accepted: statusCounts.accepted,
        agents: agentCounts,
      },
      items,
    });
  } catch (err) {
    // Graceful fallback if verdicts table doesn't exist yet
    console.warn("[summary] Verdicts query failed (table may not exist):", err);
    return Response.json({
      pulse: {
        verdicts: 0,
        proposed: 0,
        accepted: 0,
        agents: {},
        note: "Verdicts table not yet created. Run: scripts/ddl/verdicts.sql",
      },
      items: [],
    });
  }
}

async function worldcupSummary() {
  const db = getDb("worldcupdb");

  const [fixtureRows] = await db.run({
    sql: `SELECT
            f.FixtureID,
            f.MatchNumber,
            f.HomeSlug,
            f.AwaySlug,
            f.GroupLetter,
            f.Venue,
            f.City,
            f.Kickoff,
            f.Stage,
            t1.Name AS HomeName,
            t2.Name AS AwayName,
            t1.FlagUri AS HomeFlag,
            t2.FlagUri AS AwayFlag,
            p.WriteupUrl,
            p.PublishedAt
          FROM WCFixture f
          JOIN Team t1 ON f.HomeSlug = t1.TeamID
          JOIN Team t2 ON f.AwaySlug = t2.TeamID
          LEFT JOIN WCMatchPreview p ON f.FixtureID = p.FixtureID
          ORDER BY f.Kickoff ASC`,
  });

  const toIsoOrNull = (value: unknown): string | null => {
    if (value == null) return null;
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  };

  const items = fixtureRows.map((r: any) => {
    const row = r.toJSON();
    const homeName = (row.HomeName as string) || "TBD";
    const awayName = (row.AwayName as string) || "TBD";
    const writeupUrlRaw = typeof row.WriteupUrl === "string" ? row.WriteupUrl.trim() : "";
    const writeupUrl = /^https:\/\//i.test(writeupUrlRaw) ? writeupUrlRaw : null;
    return {
      id: row.FixtureID as string,
      label: `${homeName} vs ${awayName}`,
      homeName,
      awayName,
      homeFlag: (row.HomeFlag as string) || null,
      awayFlag: (row.AwayFlag as string) || null,
      groupLetter: row.GroupLetter as string | null,
      venue: row.Venue as string | null,
      city: row.City as string | null,
      kickoff: toIsoOrNull(row.Kickoff),
      stage: row.Stage as string | null,
      writeupUrl,
      publishedAt: toIsoOrNull(row.PublishedAt),
    };
  });

  return Response.json({
    pulse: {
      matches: fixtureRows.length,
      groups: 12,
      previews: items.filter((item: any) => Boolean(item.writeupUrl)).length,
    },
    items,
  });
}

async function facilitySummary() {
  const db = getDb("recruitingdb");

  const [facRows] = await db.run({ sql: `SELECT COUNT(*) as count FROM hc_facilities` });
  const facilityCount = Number(facRows[0]?.toJSON()?.count || 0);

  const [activeRows] = await db.run({
    sql: `SELECT COUNT(*) as count
          FROM hc_assignments
          WHERE status = 'active'`,
  });
  const activeCount = Number(activeRows[0]?.toJSON()?.count || 0);

  const [pipelineRows] = await db.run({
    sql: `SELECT COUNT(*) as count
          FROM hc_assignments
          WHERE status IN ('pending_start', 'in_pipeline')`,
  });
  const pipelineCount = Number(pipelineRows[0]?.toJSON()?.count || 0);

  const [listRows] = await db.run({
    sql: `SELECT
            f.id,
            f.name,
            f.system_name,
            f.city,
            f.state,
            f.vms_platform,
            f.beds,
            f.accepts_locals,
            f.requires_compact,
            SUM(CASE WHEN a.status = 'active' THEN 1 ELSE 0 END) AS active_assignments,
            SUM(CASE WHEN a.status = 'pending_start' THEN 1 ELSE 0 END) AS pending_start_assignments,
            SUM(CASE WHEN a.status = 'in_pipeline' THEN 1 ELSE 0 END) AS pipeline_assignments,
            COUNT(a.id) AS total_assignments,
            SUM(CASE WHEN a.end_reason IS NOT NULL AND TRIM(CAST(a.end_reason AS STRING)) != '' THEN 1 ELSE 0 END) AS closed_assignments,
            SUM(CASE WHEN LOWER(CAST(COALESCE(a.end_reason, '') AS STRING)) LIKE '%cancel%' THEN 1 ELSE 0 END) AS cancelled_assignments,
            SUM(CASE WHEN LOWER(CAST(COALESCE(a.end_reason, '') AS STRING)) LIKE '%extend%' THEN 1 ELSE 0 END) AS extended_assignments
          FROM hc_facilities f
          LEFT JOIN hc_assignments a ON a.facility_id = f.id
          GROUP BY f.id, f.name, f.system_name, f.city, f.state, f.vms_platform, f.beds, f.accepts_locals, f.requires_compact
          ORDER BY f.state, f.name
          LIMIT 250`,
  });

  const items = listRows.map((r: any) => {
    const row = r.toJSON() as Record<string, unknown>;
    const closedAssignments = Number(row.closed_assignments || 0);
    const cancelledAssignments = Number(row.cancelled_assignments || 0);
    const extendedAssignments = Number(row.extended_assignments || 0);
    const cancelRatePct =
      closedAssignments > 0
        ? cancelledAssignments / closedAssignments
        : null;
    const extensionRatePct =
      closedAssignments > 0
        ? extendedAssignments / closedAssignments
        : null;
    const acceptsLocals =
      row.accepts_locals == null ? null : Boolean(row.accepts_locals);
    const requiresCompact =
      row.requires_compact == null ? null : Boolean(row.requires_compact);

    const ruleParts: string[] = [];
    if (requiresCompact === true) ruleParts.push("Compact required");
    if (requiresCompact === false) ruleParts.push("Compact optional");
    if (acceptsLocals === true) ruleParts.push("Locals accepted");
    if (acceptsLocals === false) ruleParts.push("No locals");
    const submittalRules = ruleParts.length > 0 ? ruleParts.join(" · ") : "Not configured";

    let submissionDifficulty: "easy" | "moderate" | "hard" | null = null;
    if (requiresCompact === true && acceptsLocals === false) submissionDifficulty = "hard";
    else if (requiresCompact === false && acceptsLocals === true) submissionDifficulty = "easy";
    else if (requiresCompact !== null || acceptsLocals !== null) submissionDifficulty = "moderate";

    const systemName = row.system_name ? String(row.system_name) : "";
    const facilityProfileUrl = /^https?:\/\//i.test(systemName) ? systemName : null;

    return {
      id: String(row.id || ""),
      label: String(row.name || "Unknown Facility"),
      facilityId: String(row.id || ""),
      facilityName: row.name ? String(row.name) : null,
      facilitySystemName: systemName || null,
      facilityProfileUrl,
      facilityCity: row.city ? String(row.city) : null,
      facilityState: row.state ? String(row.state) : null,
      vmsPlatform: row.vms_platform ? String(row.vms_platform) : null,
      facilityBeds: row.beds == null ? null : Number(row.beds),
      acceptsLocals,
      requiresCompact,
      submittalRules,
      submissionDifficulty,
      payVsLocalCol: null,
      parkingCost: null,
      cancelRatePct,
      extensionRatePct,
      closedAssignments,
      activeAssignments: Number(row.active_assignments || 0),
      pendingStartAssignments: Number(row.pending_start_assignments || 0),
      pipelineAssignments: Number(row.pipeline_assignments || 0),
      totalAssignments: Number(row.total_assignments || 0),
    };
  });

  return Response.json({
    pulse: {
      facilities: facilityCount,
      active: activeCount,
      pipeline: pipelineCount,
      tracked: items.length,
    },
    items,
  });
}

async function marginsSummary() {
  const result = await queryMarginLedger({
    limit: 250,
    include_provenance: false,
  });

  const toNumeric = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/[$,%\s,]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };
  const toPercentDecimal = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.abs(value) > 1 ? value / 100 : value;
    }
    if (typeof value === "string") {
      const raw = value.trim();
      if (!raw) return null;
      const hasPercent = raw.includes("%");
      const parsed = Number(raw.replace(/[$,%\s,]/g, ""));
      if (!Number.isFinite(parsed)) return null;
      if (hasPercent || Math.abs(parsed) > 1) return parsed / 100;
      return parsed;
    }
    return null;
  };
  const toIsoDate = (value: unknown): string | null => {
    if (value == null) return null;
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
      const asString = String(value).trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(asString) ? asString : null;
    }
    return parsed.toISOString().slice(0, 10);
  };
  const toIsoTimestamp = (value: unknown): string | null => {
    if (value == null) return null;
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  };

  const items = result.objects.map((obj: any) => {
    const actualMarginDecimal = toPercentDecimal(obj.actual_margin_pct);
    const targetMarginDecimal = toPercentDecimal(obj.target_margin_pct);
    return {
      id: obj.margin_object_id,
      marginObjectId: obj.margin_object_id,
      label: obj.candidate_name || obj.candidate_id || obj.margin_object_id,
      candidateName: obj.candidate_name,
      candidateId: obj.candidate_id,
      candidateEmail: obj.candidate_email,
      novaUrl: obj.nova_profile_url,
      facilityName: obj.facility_name,
      profession: obj.profession,
      specialty: obj.specialty,
      assignmentStart: toIsoDate(obj.start_date),
      assignmentEnd: toIsoDate(obj.end_date),
      shiftType: obj.shift_type,
      shiftStart: obj.shift_start_hhmm,
      shiftEnd: obj.shift_end_hhmm,
      weeklyHours: toNumeric(obj.weekly_hours),
      weeklyGross: toNumeric(obj.gross_weekly_pay_usd),
      weeklyStipends: toNumeric(obj.weekly_stipends_usd),
      basePayRate: toNumeric(obj.base_pay_rate_usd),
      targetMarginPct: targetMarginDecimal,
      actualMarginPct: actualMarginDecimal,
      grossWeeklyPayComputed: toNumeric(obj.gross_weekly_pay_computed_usd),
      marginId: obj.margin_id,
      jobId: obj.job_id,
      source: obj.source_of_truth,
      lastSeenAt: toIsoTimestamp(obj.last_seen_at),
      isLocal: obj.is_local,
      isCompact: obj.is_compact,
    };
  });

  const marginValues = items
    .map((item: any) => item.actualMarginPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const avgMarginPct =
    marginValues.length > 0
      ? Math.round((marginValues.reduce((sum, value) => sum + value, 0) / marginValues.length) * 10000) / 100
      : 0;
  const targetComparisons = items
    .map((item: any) => {
      if (
        typeof item.actualMarginPct !== "number" ||
        !Number.isFinite(item.actualMarginPct) ||
        typeof item.targetMarginPct !== "number" ||
        !Number.isFinite(item.targetMarginPct)
      ) {
        return null;
      }
      return item.actualMarginPct - item.targetMarginPct;
    })
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const tolerance = 0.0001; // 0.01 percentage points.
  const aboveTarget = targetComparisons.filter((delta) => delta > tolerance).length;
  const belowTarget = targetComparisons.filter((delta) => delta < -tolerance).length;
  const onTarget = targetComparisons.length - aboveTarget - belowTarget;

  return Response.json({
    pulse: {
      avg_margin_pct: avgMarginPct,
      above_target: aboveTarget,
      below_target: belowTarget,
      on_target: onTarget,
    },
    items,
  });
}

async function ayaopsSummary() {
  const db = getDb("recruitingdb");

  // Pulse: Candidates, Facilities, Active Assignments, Submittals
  const [candRows] = await db.run({ sql: `SELECT COUNT(*) as count FROM hc_candidates` });
  const candCount = Number(candRows[0]?.toJSON()?.count || 0);

  const [facRows] = await db.run({ sql: `SELECT COUNT(*) as count FROM hc_facilities` });
  const facCount = Number(facRows[0]?.toJSON()?.count || 0);

  const [activeRows] = await db.run({
    sql: `SELECT COUNT(*) as count FROM hc_assignments WHERE status = 'active'`,
  });
  const activeCount = Number(activeRows[0]?.toJSON()?.count || 0);

  const [subRows] = await db.run({ sql: `SELECT COUNT(*) as count FROM hc_submittals` });
  const subCount = Number(subRows[0]?.toJSON()?.count || 0);

  const columns = await getPriorityColumnPresence(db);
  const priorityScoreExpr = columns.score ? "c.priority_score" : "CAST(NULL AS FLOAT64)";
  const priorityLevelExpr = columns.level ? "c.priority_level" : "CAST(NULL AS STRING)";

  // Candidates with their current assignment + facility
  const [listRows] = await db.run({
    sql: `SELECT c.id, c.nova_id, c.first_name, c.last_name, c.specialty, c.profession,
            c.home_state, c.compliance_risk_level, c.source, c.rc_thread_url, c.outlook_thread_url,
            a.status as assignment_status, a.start_date, a.end_date,
            a.weekly_gross, a.hourly_rate,
            ${priorityScoreExpr} as priority_score,
            ${priorityLevelExpr} as priority_level,
            f.name as facility_name, f.city as facility_city, f.state as facility_state,
            f.vms_platform, f.beds as facility_beds
          FROM hc_candidates c
          LEFT JOIN hc_assignments a ON a.candidate_id = c.id
            AND a.status IN ('active', 'pending_start', 'in_pipeline')
          LEFT JOIN hc_facilities f ON a.facility_id = f.id
          ORDER BY c.specialty, c.last_name
          LIMIT 200`,
  });

  const items = listRows.map((r: any) => {
    const row = r.toJSON();
    const candidate = mapCandidateRow(row);
    const touchPlan = buildAyaFollowupSignal(
      candidate,
      row.priority_score != null ? Number(row.priority_score) : null,
      row.priority_level ? String(row.priority_level) : null
    );
    return {
      id: candidate.id,
      label: candidate.name,
      novaId: candidate.novaId || null,
      novaUrl: candidate.novaUrl || null,
      specialty: candidate.specialty,
      profession: candidate.profession || null,
      homeState: candidate.homeState || null,
      complianceRisk: candidate.complianceRisk || null,
      source: candidate.source || null,
      assignmentStatus: candidate.assignmentStatus || null,
      derivedCurrentStatus: candidate.derivedCurrentStatus || null,
      assignmentStart: candidate.assignmentStart || null,
      assignmentEnd: candidate.assignmentEnd || null,
      weeklyGross: candidate.weeklyGross || null,
      hourlyRate: candidate.hourlyRate || null,
      facilityName: candidate.facilityName || null,
      facilityCity: candidate.facilityCity || null,
      facilityState: candidate.facilityState || null,
      vmsPlatform: candidate.vmsPlatform || null,
      facilityBeds: candidate.facilityBeds || null,
      rcThreadUrl: candidate.rcThreadUrl || null,
      outlookThreadUrl: candidate.outlookThreadUrl || null,
      touchPriorityScore: touchPlan.score,
      touchPriorityLevel: row.priority_level ? String(row.priority_level) : null,
      touchPriorityBand: touchPlan.band,
      touchPriorityReason: touchPlan.reason,
      touchDaysToEnd: touchPlan.daysToEnd,
      touchNoteSeed: touchPlan.noteSeed,
    };
  });

  items.sort((a: any, b: any) => {
    const levelRank = (value: string | null | undefined) => {
      const key = String(value || "").toLowerCase();
      if (key === "critical") return 5;
      if (key === "high") return 4;
      if (key === "medium") return 3;
      if (key === "standard") return 2;
      if (key === "low") return 1;
      return 0;
    };

    const levelDiff = levelRank(b.touchPriorityLevel) - levelRank(a.touchPriorityLevel);
    if (levelDiff !== 0) return levelDiff;

    const scoreDiff = (b.touchPriorityScore || 0) - (a.touchPriorityScore || 0);
    if (scoreDiff !== 0) return scoreDiff;

    const aDays = a.touchDaysToEnd ?? 9999;
    const bDays = b.touchDaysToEnd ?? 9999;
    if (aDays !== bDays) return aDays - bDays;

    return String(a.label || "").localeCompare(String(b.label || ""));
  });

  // Submittal pipeline breakdown
  const [pipeRows] = await db.run({
    sql: `SELECT status, COUNT(*) as count FROM hc_submittals GROUP BY status ORDER BY count DESC`,
  });
  const pipeline = pipeRows.map((r: any) => {
    const row = r.toJSON();
    return { stage: row.status, count: Number(row.count) };
  });

  return Response.json({
    pulse: {
      candidates: candCount,
      facilities: facCount,
      active: activeCount,
      submittals: subCount,
    },
    pipeline,
    items,
  });
}

function parseIsoDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function dateDiffDays(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.round(ms / 86_400_000);
}

async function getPriorityColumnPresence(
  db: ReturnType<ReturnType<Spanner["instance"]>["database"]>
): Promise<{ score: boolean; level: boolean }> {
  if (priorityColumnPresence) return priorityColumnPresence;

  try {
    const [rows] = await db.run({
      sql: `SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'hc_candidates'
              AND COLUMN_NAME IN ('priority_score', 'priority_level')`,
    });
    const names = new Set(rows.map((r: any) => String(r.toJSON().COLUMN_NAME || "").toLowerCase()));
    priorityColumnPresence = {
      score: names.has("priority_score"),
      level: names.has("priority_level"),
    };
  } catch (error) {
    console.warn("Could not inspect candidate priority columns:", error);
    priorityColumnPresence = { score: false, level: false };
  }

  return priorityColumnPresence;
}

function buildAyaFollowupSignal(
  candidate: CandidateRecord,
  existingPriorityScore: number | null,
  existingPriorityLevel: string | null
): {
  score: number;
  band: "today" | "this_week" | "monitor";
  reason: string;
  daysToEnd: number | null;
  noteSeed: string;
} {
  const endDate = parseIsoDate(candidate.assignmentEnd);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysToEnd = endDate ? dateDiffDays(today, endDate) : null;

  const hasExistingScore =
    typeof existingPriorityScore === "number" && Number.isFinite(existingPriorityScore);
  const fallbackScore =
    daysToEnd == null
      ? 40
      : daysToEnd < 0
        ? 100
        : Math.max(1, 100 - Math.min(daysToEnd, 90));
  const boundedScore = Math.max(
    1,
    Math.min(100, Math.round(hasExistingScore ? Number(existingPriorityScore) : fallbackScore))
  );
  const band: "today" | "this_week" | "monitor" =
    boundedScore >= 80 ? "today" : boundedScore >= 60 ? "this_week" : "monitor";
  const reason = hasExistingScore
    ? `existing priority signal${existingPriorityLevel ? `: ${existingPriorityLevel}` : ""}`
    : daysToEnd == null
      ? "fallback timing signal (no explicit priority score)"
      : daysToEnd < 0
        ? `${Math.abs(daysToEnd)}d past assignment end`
        : `${daysToEnd}d to assignment end`;

  const noteSeedParts = [
    `Candidate: ${candidate.name}`,
    `Priority: ${boundedScore}/100 (${band.replace("_", " ")})`,
    `Why now: ${reason}`,
    `Status: ${candidate.derivedCurrentStatus || candidate.assignmentStatus || "unknown"}`,
    `Ask: confirm next placement timing and current readiness`,
  ];

  return {
    score: boundedScore,
    band,
    reason,
    daysToEnd,
    noteSeed: noteSeedParts.join(" | "),
  };
}

// ─── Jobs Summary (Operational — no margin concepts) ────────────────
async function jobsSummary() {
  const result = await queryJobBoard({ limit: 250 });

  const toNumeric = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/[$,%\s,]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };
  const toIsoDate = (value: unknown): string | null => {
    if (value == null) return null;
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
      const asString = String(value).trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(asString) ? asString : null;
    }
    return parsed.toISOString().slice(0, 10);
  };

  const items = result.objects.map((obj: any) => ({
    id: obj.margin_object_id,
    marginObjectId: obj.margin_object_id,
    recordPhase: obj.record_phase,
    label: obj.facility_name || obj.job_id || obj.margin_object_id,
    facilityName: obj.facility_name,
    profession: obj.profession,
    specialty: obj.specialty,
    jobId: obj.job_id,
    assignmentStart: toIsoDate(obj.start_date),
    assignmentEnd: toIsoDate(obj.end_date),
    shiftType: obj.shift_type,
    shiftStart: obj.shift_start_hhmm,
    shiftEnd: obj.shift_end_hhmm,
    weeklyHours: toNumeric(obj.weekly_hours),
    weeklyGross: toNumeric(obj.gross_weekly_pay_usd),
    weeklyStipends: toNumeric(obj.weekly_stipends_usd),
    basePayRate: toNumeric(obj.base_pay_rate_usd),
    isLocal: obj.is_local,
    isCompact: obj.is_compact,
  }));

  // Specialty counts
  const specCounts: Record<string, number> = {};
  const facCounts: Record<string, number> = {};
  for (const item of items) {
    const spec = item.specialty || item.profession || "Unknown";
    specCounts[spec] = (specCounts[spec] || 0) + 1;
    const fac = item.facilityName || "Unknown";
    facCounts[fac] = (facCounts[fac] || 0) + 1;
  }

  const pulse = {
    total_jobs: items.length,
    specialties: Object.keys(specCounts).length,
    facilities: Object.keys(facCounts).length,
  };

  return new Response(
    JSON.stringify({
      pulse,
      items,
      specialtyBreakdown: specCounts,
      facilityBreakdown: facCounts,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

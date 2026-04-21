import { NextRequest } from "next/server";
import { Spanner } from "@google-cloud/spanner";
import crypto from "crypto";
import { getSportsDb, spannerClient } from "@/lib/spanner-pool";

// ── ESPN Config ───────────────────────────────────────────
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";
const ESPN_TIMEOUT_MS = 12_000;

type LeagueConfig = {
  leagueId: string;
  sport: string; // DB sport value (matches GameResult.Sport)
  espnSportPath: string;
  espnLeagueSlug: string;
  matchSuffix: string;
};

const LEAGUES: LeagueConfig[] = [
  // MLB
  { leagueId: "mlb", sport: "baseball", espnSportPath: "baseball", espnLeagueSlug: "mlb", matchSuffix: "mlb" },
  // NBA
  { leagueId: "nba", sport: "basketball", espnSportPath: "basketball", espnLeagueSlug: "nba", matchSuffix: "nba" },
  // NHL
  { leagueId: "nhl", sport: "icehockey", espnSportPath: "hockey", espnLeagueSlug: "nhl", matchSuffix: "nhl" },
  // Soccer
  { leagueId: "eng.1", sport: "soccer", espnSportPath: "soccer", espnLeagueSlug: "eng.1", matchSuffix: "eng.1" },
  { leagueId: "esp.1", sport: "soccer", espnSportPath: "soccer", espnLeagueSlug: "esp.1", matchSuffix: "esp.1" },
  { leagueId: "ger.1", sport: "soccer", espnSportPath: "soccer", espnLeagueSlug: "ger.1", matchSuffix: "ger.1" },
  { leagueId: "ita.1", sport: "soccer", espnSportPath: "soccer", espnLeagueSlug: "ita.1", matchSuffix: "ita.1" },
  { leagueId: "fra.1", sport: "soccer", espnSportPath: "soccer", espnLeagueSlug: "fra.1", matchSuffix: "fra.1" },
  { leagueId: "usa.1", sport: "soccer", espnSportPath: "soccer", espnLeagueSlug: "usa.1", matchSuffix: "usa.1" },
  { leagueId: "uefa.europa", sport: "soccer", espnSportPath: "soccer", espnLeagueSlug: "uefa.europa", matchSuffix: "uefa.europa" },
  { leagueId: "uefa.champions", sport: "soccer", espnSportPath: "soccer", espnLeagueSlug: "uefa.champions", matchSuffix: "uefa.champions" },
  { leagueId: "por.1", sport: "soccer", espnSportPath: "soccer", espnLeagueSlug: "por.1", matchSuffix: "por.1" },
  { leagueId: "ned.1", sport: "soccer", espnSportPath: "soccer", espnLeagueSlug: "ned.1", matchSuffix: "ned.1" },
  { leagueId: "sco.1", sport: "soccer", espnSportPath: "soccer", espnLeagueSlug: "sco.1", matchSuffix: "sco.1" },
  { leagueId: "tur.1", sport: "soccer", espnSportPath: "soccer", espnLeagueSlug: "tur.1", matchSuffix: "tur.1" },
  { leagueId: "bra.1", sport: "soccer", espnSportPath: "soccer", espnLeagueSlug: "bra.1", matchSuffix: "bra.1" },
  { leagueId: "arg.1", sport: "soccer", espnSportPath: "soccer", espnLeagueSlug: "arg.1", matchSuffix: "arg.1" },
  { leagueId: "bel.1", sport: "soccer", espnSportPath: "soccer", espnLeagueSlug: "bel.1", matchSuffix: "bel.1" },
  { leagueId: "mex.1", sport: "soccer", espnSportPath: "soccer", espnLeagueSlug: "mex.1", matchSuffix: "mex.1" },
];

// ── Spanner singleton ─────────────────────────────────────
const DATABASE_ID = "sportsdb";

// ── ESPN fetcher ──────────────────────────────────────────
async function fetchESPNScoreboard(
  sportPath: string,
  leagueSlug: string,
  dateStr: string,
): Promise<any[]> {
  const url = `${ESPN_BASE}/${sportPath}/${leagueSlug}/scoreboard?dates=${dateStr}&limit=500`;
  const res = await fetch(url, { signal: AbortSignal.timeout(ESPN_TIMEOUT_MS) });
  if (!res.ok) {
    console.warn(`ESPN ${sportPath}/${leagueSlug} ${dateStr}: HTTP ${res.status}`);
    return [];
  }
  const data = await res.json();
  return Array.isArray(data?.events) ? data.events : [];
}

// ── Parse ESPN event → GameResult rows ────────────────────
function parseEvent(event: any, config: LeagueConfig, dateStr: string) {
  const competition = event?.competitions?.[0];
  if (!competition) return [];
  const competitors = Array.isArray(competition.competitors)
    ? competition.competitors
    : [];
  const home = competitors.find((c: any) => c.homeAway === "home") ?? competitors[0];
  const away = competitors.find((c: any) => c.homeAway === "away") ?? competitors[1];
  if (!home || !away || !event.id) return [];

  const matchId = `${event.id}_${config.matchSuffix}`;
  const startTime = event.date ?? competition.date ?? null;
  const homeScore = home.score != null ? parseInt(String(home.score), 10) : 0;
  const awayScore = away.score != null ? parseInt(String(away.score), 10) : 0;
  const gameTotal = homeScore + awayScore;
  const homeName = home.team?.displayName ?? home.team?.name ?? "Unknown";
  const awayName = away.team?.displayName ?? away.team?.name ?? "Unknown";
  const homeLogo = home.team?.logo ?? null;
  const awayLogo = away.team?.logo ?? null;

  // Extract team records — prefer playoff if available, else overall
  const extractRecord = (competitor: any): string | null => {
    const records = Array.isArray(competitor?.records) ? competitor.records : [];
    // Look for playoff record first (typically appears during postseason)
    const playoff = records.find((r: any) => r.name === "playoff" || r.type === "playoff");
    if (playoff?.summary) return playoff.summary;
    // Fall back to overall
    const overall = records.find((r: any) => r.name === "overall" || r.type === "total");
    return overall?.summary ?? records[0]?.summary ?? null;
  };
  const homeRecord = extractRecord(home);
  const awayRecord = extractRecord(away);

  // Parse spread/total from odds if available
  const odds = Array.isArray(competition.odds) ? competition.odds[0] : null;
  // Try top-level spread first (NBA/NHL), then dig into pointSpread for soccer
  let closingSpread: number | null = null;
  if (odds?.spread != null) {
    closingSpread = parseFloat(String(odds.spread));
  } else if (odds?.pointSpread?.home?.close?.line != null) {
    closingSpread = parseFloat(String(odds.pointSpread.home.close.line));
  }
  const closingTotal = odds?.overUnder != null ? parseFloat(String(odds.overUnder)) : null;

  const rows = [];

  // Home row
  const homeId = crypto.createHash("md5").update(`${matchId}_home`).digest("hex");
  rows.push({
    GameResultID: homeId,
    MatchID: matchId,
    Sport: config.sport,
    LeagueID: config.leagueId,
    TeamName: homeName,
    OpponentName: awayName,
    Side: "home",
    GameDate: dateStr,
    StartTime: startTime,
    TeamScore: homeScore,
    OpponentScore: awayScore,
    GameTotal: gameTotal,
    ClosingSpread: closingSpread != null && isFinite(closingSpread) ? closingSpread : null,
    ClosingTotal: closingTotal != null && isFinite(closingTotal) ? closingTotal : null,
    CoverMargin: closingSpread != null && isFinite(closingSpread)
      ? homeScore - awayScore + closingSpread
      : null,
    ATSResult: null,
    OUResult: null,
    SourceID: matchId,
    TeamLogoURL: homeLogo,
    TeamRecord: homeRecord,
  });

  // Away row
  const awayId = crypto.createHash("md5").update(`${matchId}_away`).digest("hex");
  rows.push({
    GameResultID: awayId,
    MatchID: matchId,
    Sport: config.sport,
    LeagueID: config.leagueId,
    TeamName: awayName,
    OpponentName: homeName,
    Side: "away",
    GameDate: dateStr,
    StartTime: startTime,
    TeamScore: awayScore,
    OpponentScore: homeScore,
    GameTotal: gameTotal,
    ClosingSpread: closingSpread != null && isFinite(closingSpread) ? -closingSpread : null,
    ClosingTotal: closingTotal != null && isFinite(closingTotal) ? closingTotal : null,
    CoverMargin: closingSpread != null && isFinite(closingSpread)
      ? awayScore - homeScore - closingSpread
      : null,
    ATSResult: null,
    OUResult: null,
    SourceID: matchId,
    TeamLogoURL: awayLogo,
    TeamRecord: awayRecord,
  });

  return rows;
}

// ── Spanner upsert ────────────────────────────────────────
async function upsertToSpanner(
  rows: Array<Record<string, any>>,
): Promise<{ written: number; errors: string[] }> {
  if (rows.length === 0) return { written: 0, errors: [] };

  const db = getSportsDb();
  const table = db.table("GameResult");
  const errors: string[] = [];
  let written = 0;

  // Batch in chunks of 100
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const spannerRows = chunk.map((r) => ({
      GameResultID: r.GameResultID,
      MatchID: r.MatchID,
      Sport: r.Sport,
      LeagueID: r.LeagueID,
      TeamName: r.TeamName,
      OpponentName: r.OpponentName,
      Side: r.Side,
      GameDate: r.GameDate,
      StartTime: r.StartTime ? new Date(r.StartTime).toISOString() : null,
      TeamScore: r.TeamScore,
      OpponentScore: r.OpponentScore,
      GameTotal: r.GameTotal,
      ClosingSpread: r.ClosingSpread != null ? Spanner.float(r.ClosingSpread) : null,
      ClosingTotal: r.ClosingTotal != null ? Spanner.float(r.ClosingTotal) : null,
      CoverMargin: r.CoverMargin != null ? Spanner.float(r.CoverMargin) : null,
      ATSResult: r.ATSResult,
      OUResult: r.OUResult,
      SourceID: r.SourceID,
      TeamLogoURL: r.TeamLogoURL ?? null,
      TeamRecord: r.TeamRecord ?? null,
      MigratedAt: new Date().toISOString(),
    }));

    try {
      await table.upsert(spannerRows);
      written += chunk.length;
    } catch (err: any) {
      errors.push(`Chunk ${i}-${i + chunk.length}: ${err.message?.slice(0, 200)}`);
    }
  }

  return { written, errors };
}

// ── Route handler ─────────────────────────────────────────
export async function POST(req: NextRequest) {
  const start = Date.now();
  const body = await req.json().catch(() => ({}));

  // Optional: sync specific leagues or a date range
  const requestedLeagues: string[] = Array.isArray(body.leagues)
    ? body.leagues
    : [];
  const daysBack = typeof body.daysBack === "number" ? Math.min(body.daysBack, 14) : 3;
  const daysForward = typeof body.daysForward === "number" ? Math.min(body.daysForward, 7) : 3;

  const leaguesToSync = requestedLeagues.length > 0
    ? LEAGUES.filter((l) => requestedLeagues.includes(l.leagueId))
    : LEAGUES;

  // Generate date range
  const dates: string[] = [];
  const now = new Date();
  for (let d = -daysBack; d <= daysForward; d++) {
    const dt = new Date(now);
    dt.setDate(dt.getDate() + d);
    dates.push(dt.toISOString().slice(0, 10));
  }

  const results: Array<{
    league: string;
    date: string;
    events: number;
    rows: number;
    written: number;
    errors: string[];
  }> = [];

  let totalEvents = 0;
  let totalWritten = 0;

  for (const config of leaguesToSync) {
    for (const date of dates) {
      const espnDate = date.replace(/-/g, "");
      try {
        const events = await fetchESPNScoreboard(
          config.espnSportPath,
          config.espnLeagueSlug,
          espnDate,
        );

        if (events.length === 0) {
          results.push({
            league: config.leagueId,
            date,
            events: 0,
            rows: 0,
            written: 0,
            errors: [],
          });
          continue;
        }

        const allRows: Record<string, any>[] = [];
        for (const event of events) {
          const parsed = parseEvent(event, config, date);
          allRows.push(...parsed);
        }

        const { written, errors } = await upsertToSpanner(allRows);
        totalEvents += events.length;
        totalWritten += written;

        results.push({
          league: config.leagueId,
          date,
          events: events.length,
          rows: allRows.length,
          written,
          errors,
        });
      } catch (err: any) {
        results.push({
          league: config.leagueId,
          date,
          events: 0,
          rows: 0,
          written: 0,
          errors: [err.message?.slice(0, 300) ?? String(err)],
        });
      }
    }
  }

  const elapsed = Date.now() - start;

  return Response.json({
    ok: true,
    elapsed_ms: elapsed,
    leagues_synced: leaguesToSync.length,
    dates_covered: dates,
    total_events: totalEvents,
    total_rows_written: totalWritten,
    details: results.filter((r) => r.events > 0 || r.errors.length > 0),
  });
}

// GET: simple status/trigger without body
export async function GET() {
  return Response.json({
    status: "ready",
    endpoint: "POST /api/sports-sync",
    usage: {
      default: "POST with empty body → syncs all leagues, ±3 days",
      custom: "POST { leagues: ['nba','nhl'], daysBack: 5, daysForward: 2 }",
    },
    supported_leagues: LEAGUES.map((l) => l.leagueId),
  });
}

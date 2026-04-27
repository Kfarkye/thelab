import { NextRequest, NextResponse } from "next/server";
import { Spanner } from "@google-cloud/spanner";
import crypto from "crypto";
import { getSportsDb } from "@/lib/spanner-pool";
import { requireAuth } from "@/lib/middleware/auth";
import { fetchMLBLiveState } from "@/lib/sports/mlb-api";
import {
  normalizeMLBStatusCode,
  type CanonicalGameStatus,
} from "@/lib/sports/status";
import {
  upsertGameLiveSnapshots,
  type CanonicalGameLiveSnapshotInput,
} from "@/lib/sports/live-snapshot";

export const runtime = "nodejs";
export const maxDuration = 240;

// ── ESPN Config ───────────────────────────────────────────
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";
const ESPN_TIMEOUT_MS = 12_000;
const MLB_SCHEDULE_TIMEOUT_MS = 10_000;

type LeagueConfig = {
  leagueId: string;
  sport: string; // DB sport value (matches GameResult.Sport)
  espnSportPath: string;
  espnLeagueSlug: string;
  matchSuffix: string;
};

type SportsSyncInput = {
  leagues?: string[];
  daysBack?: number;
  daysForward?: number;
};

type SportsSyncDetail = {
  league: string;
  date: string;
  events: number;
  rows: number;
  written: number;
  live_snapshots_written?: number;
  legacy_live_rows_updated?: number;
  upstream_live_count?: number;
  live_snapshot_table?: string | null;
  errors: string[];
};

const LEAGUES: LeagueConfig[] = [
  // MLB
  { leagueId: "mlb", sport: "baseball", espnSportPath: "baseball", espnLeagueSlug: "mlb", matchSuffix: "mlb" },
  // NBA
  { leagueId: "nba", sport: "basketball", espnSportPath: "basketball", espnLeagueSlug: "nba", matchSuffix: "nba" },
  // WNBA
  { leagueId: "wnba", sport: "basketball", espnSportPath: "basketball", espnLeagueSlug: "wnba", matchSuffix: "wnba" },
  // NHL
  { leagueId: "nhl", sport: "icehockey", espnSportPath: "hockey", espnLeagueSlug: "nhl", matchSuffix: "nhl" },
  // NFL
  { leagueId: "nfl", sport: "americanfootball", espnSportPath: "football", espnLeagueSlug: "nfl", matchSuffix: "nfl" },
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

function readString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

function readInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
}

function clampInteger(value: number | null, fallback: number, min: number, max: number): number {
  if (value == null) return fallback;
  return Math.max(min, Math.min(max, value));
}

function normalizeTeamKey(value: unknown): string {
  return readString(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildDateRange(daysBack: number, daysForward: number): string[] {
  const now = new Date();
  const dates: string[] = [];

  for (let day = -daysBack; day <= daysForward; day += 1) {
    const dt = new Date(now);
    dt.setDate(dt.getDate() + day);
    dates.push(dt.toISOString().slice(0, 10));
  }

  return dates;
}

function normalizeMlbScheduleStatus(rawStatus: Record<string, unknown> | null): CanonicalGameStatus {
  if (!rawStatus) return "SCHEDULED";

  const tokens = [
    rawStatus.codedGameState,
    rawStatus.abstractGameCode,
    rawStatus.detailedState,
    rawStatus.abstractGameState,
    rawStatus.statusCode,
    rawStatus.status,
  ].map((token) => readString(token)).filter(Boolean);

  if (tokens.length === 0) return "SCHEDULED";

  const rank: Record<CanonicalGameStatus, number> = {
    SCHEDULED: 1,
    POSTPONED: 2,
    FINAL: 3,
    LIVE: 4,
  };

  let selected: CanonicalGameStatus = "SCHEDULED";
  for (const token of tokens) {
    const normalized = normalizeMLBStatusCode(token);
    if (rank[normalized] > rank[selected]) {
      selected = normalized;
      if (selected === "LIVE") break;
    }
  }

  return selected;
}

function buildLiveProgress(
  livePayload: Record<string, unknown> | null,
  scheduleStatusText: string,
): string | null {
  if (livePayload) {
    const explicit = readString(livePayload.progress)
      || readString(livePayload.game_progress)
      || readString(livePayload.status)
      || readString(livePayload.game_status)
      || readString(livePayload.gameStatus);
    if (explicit) return explicit;

    const inning = readInteger(livePayload.inning);
    if (inning != null) {
      const half = readString(livePayload.half).toUpperCase() === "BOTTOM" ? "Bottom" : "Top";
      return `${half} ${inning}`;
    }
  }

  return scheduleStatusText || null;
}

function scoreFromPayload(payload: Record<string, unknown> | null, side: "home" | "away"): number | null {
  if (!payload) return null;
  if (side === "home") {
    const direct = readInteger(payload.home_score);
    if (direct != null) return direct;
    const camel = readInteger(payload.homeScore);
    if (camel != null) return camel;
  }

  if (side === "away") {
    const direct = readInteger(payload.away_score);
    if (direct != null) return direct;
    const camel = readInteger(payload.awayScore);
    if (camel != null) return camel;
  }

  return null;
}

// ── ESPN fetcher ──────────────────────────────────────────
async function fetchESPNScoreboard(
  sportPath: string,
  leagueSlug: string,
  dateStr: string,
): Promise<any[]> {
  const url = `${ESPN_BASE}/${sportPath}/${leagueSlug}/scoreboard?dates=${dateStr}&limit=500`;
  const response = await fetch(url, { signal: AbortSignal.timeout(ESPN_TIMEOUT_MS) });
  if (!response.ok) {
    console.warn(`ESPN ${sportPath}/${leagueSlug} ${dateStr}: HTTP ${response.status}`);
    return [];
  }

  const data = await response.json();
  return Array.isArray(data?.events) ? data.events : [];
}

// ── Parse ESPN event → GameResult rows ────────────────────
function parseEvent(event: any, config: LeagueConfig, dateStr: string) {
  const competition = event?.competitions?.[0];
  if (!competition) return [];

  const competitors = Array.isArray(competition.competitors) ? competition.competitors : [];
  const home = competitors.find((entry: any) => entry.homeAway === "home") ?? competitors[0];
  const away = competitors.find((entry: any) => entry.homeAway === "away") ?? competitors[1];
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

  const extractRecord = (competitor: any): string | null => {
    const records = Array.isArray(competitor?.records) ? competitor.records : [];
    const playoff = records.find((record: any) => record.name === "playoff" || record.type === "playoff");
    if (playoff?.summary) return playoff.summary;

    const overall = records.find((record: any) => record.name === "overall" || record.type === "total");
    return overall?.summary ?? records[0]?.summary ?? null;
  };

  const homeRecord = extractRecord(home);
  const awayRecord = extractRecord(away);

  const odds = Array.isArray(competition.odds) ? competition.odds[0] : null;
  let closingSpread: number | null = null;
  if (odds?.spread != null) {
    closingSpread = parseFloat(String(odds.spread));
  } else if (odds?.pointSpread?.home?.close?.line != null) {
    closingSpread = parseFloat(String(odds.pointSpread.home.close.line));
  }
  const closingTotal = odds?.overUnder != null ? parseFloat(String(odds.overUnder)) : null;

  const rows = [];

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
    ClosingSpread: closingSpread != null && Number.isFinite(closingSpread) ? closingSpread : null,
    ClosingTotal: closingTotal != null && Number.isFinite(closingTotal) ? closingTotal : null,
    CoverMargin: closingSpread != null && Number.isFinite(closingSpread)
      ? homeScore - awayScore + closingSpread
      : null,
    ATSResult: null,
    OUResult: null,
    SourceID: String(event.id),
    TeamLogoURL: homeLogo,
    TeamRecord: homeRecord,
  });

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
    ClosingSpread: closingSpread != null && Number.isFinite(closingSpread) ? -closingSpread : null,
    ClosingTotal: closingTotal != null && Number.isFinite(closingTotal) ? closingTotal : null,
    CoverMargin: closingSpread != null && Number.isFinite(closingSpread)
      ? awayScore - homeScore - closingSpread
      : null,
    ATSResult: null,
    OUResult: null,
    SourceID: String(event.id),
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

  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const spannerRows = chunk.map((row: any) => ({
      GameResultID: row.GameResultID,
      MatchID: row.MatchID,
      Sport: row.Sport,
      LeagueID: row.LeagueID,
      TeamName: row.TeamName,
      OpponentName: row.OpponentName,
      Side: row.Side,
      GameDate: row.GameDate,
      StartTime: row.StartTime ? new Date(row.StartTime).toISOString() : null,
      TeamScore: row.TeamScore,
      OpponentScore: row.OpponentScore,
      GameTotal: row.GameTotal,
      ClosingSpread: row.ClosingSpread != null ? Spanner.float(row.ClosingSpread) : null,
      ClosingTotal: row.ClosingTotal != null ? Spanner.float(row.ClosingTotal) : null,
      CoverMargin: row.CoverMargin != null ? Spanner.float(row.CoverMargin) : null,
      ATSResult: row.ATSResult,
      OUResult: row.OUResult,
      SourceID: row.SourceID,
      TeamLogoURL: row.TeamLogoURL ?? null,
      TeamRecord: row.TeamRecord ?? null,
      MigratedAt: new Date().toISOString(),
    }));

    try {
      await table.upsert(spannerRows);
      written += chunk.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Chunk ${i}-${i + chunk.length}: ${message.slice(0, 220)}`);
    }
  }

  return { written, errors };
}

function buildMatchLookup(
  rows: Array<Record<string, any>>,
): Map<string, { matchId: string; homeId: string | null; awayId: string | null }> {
  const byMatch = new Map<string, { home: Record<string, any> | null; away: Record<string, any> | null }>();

  for (const row of rows) {
    const matchId = readString(row.MatchID);
    if (!matchId) continue;

    const current = byMatch.get(matchId) || { home: null, away: null };
    if (String(row.Side || "").toLowerCase() === "home") {
      current.home = row;
    } else if (String(row.Side || "").toLowerCase() === "away") {
      current.away = row;
    }
    byMatch.set(matchId, current);
  }

  const lookup = new Map<string, { matchId: string; homeId: string | null; awayId: string | null }>();
  for (const [matchId, value] of byMatch.entries()) {
    if (!value.home) continue;
    const homeTeam = normalizeTeamKey(value.home.TeamName);
    const awayTeam = normalizeTeamKey(value.home.OpponentName);
    if (!homeTeam || !awayTeam) continue;

    const key = `${homeTeam}::${awayTeam}`;
    lookup.set(key, {
      matchId,
      homeId: readString(value.home.GameResultID),
      awayId: value.away ? readString(value.away.GameResultID) : null,
    });
  }

  return lookup;
}

async function applyLegacyGameResultLiveUpdates(
  updates: Array<Record<string, unknown>>,
): Promise<{ written: number; errors: string[] }> {
  if (updates.length === 0) return { written: 0, errors: [] };

  const db = getSportsDb();
  const table = db.table("GameResult");
  const errors: string[] = [];
  let written = 0;

  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100);
    try {
      await table.update(chunk);
      written += chunk.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Legacy chunk ${i}-${i + chunk.length}: ${message.slice(0, 220)}`);
    }
  }

  return { written, errors };
}

async function syncMlbLiveState(
  date: string,
  parsedRows: Array<Record<string, any>>,
): Promise<{
  snapshotsWritten: number;
  legacyRowsUpdated: number;
  upstreamLiveCount: number;
  snapshotTable: string | null;
  errors: string[];
}> {
  const scheduleResponse = await fetch(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`,
    { signal: AbortSignal.timeout(MLB_SCHEDULE_TIMEOUT_MS) },
  );
  if (!scheduleResponse.ok) {
    throw new Error(`MLB schedule HTTP ${scheduleResponse.status}`);
  }

  const scheduleData = await scheduleResponse.json();
  const games: Array<Record<string, unknown>> = [];
  for (const scheduleDate of scheduleData?.dates || []) {
    for (const game of scheduleDate?.games || []) {
      if (game && typeof game === "object") {
        games.push(game as Record<string, unknown>);
      }
    }
  }

  const matchLookup = buildMatchLookup(parsedRows);
  const snapshotRows: CanonicalGameLiveSnapshotInput[] = [];
  const legacyGameResultUpdates: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  let upstreamLiveCount = 0;

  for (const game of games) {
    const statusRaw = game.status && typeof game.status === "object"
      ? game.status as Record<string, unknown>
      : null;
    const status = normalizeMlbScheduleStatus(statusRaw);
    const detailedState = statusRaw ? readString(statusRaw.detailedState) : "";

    if (status === "LIVE") upstreamLiveCount += 1;

    const gamePk = readString(game.gamePk);
    if (!gamePk) continue;

    const teams = game.teams && typeof game.teams === "object"
      ? game.teams as Record<string, unknown>
      : null;
    const homeBlock = teams?.home && typeof teams.home === "object"
      ? teams.home as Record<string, unknown>
      : null;
    const awayBlock = teams?.away && typeof teams.away === "object"
      ? teams.away as Record<string, unknown>
      : null;

    const homeTeamObj = homeBlock?.team && typeof homeBlock.team === "object"
      ? homeBlock.team as Record<string, unknown>
      : null;
    const awayTeamObj = awayBlock?.team && typeof awayBlock.team === "object"
      ? awayBlock.team as Record<string, unknown>
      : null;

    const homeTeamName = readString(homeTeamObj?.name) || readString(homeTeamObj?.teamName);
    const awayTeamName = readString(awayTeamObj?.name) || readString(awayTeamObj?.teamName);

    const homeScoreFromSchedule = readInteger(homeBlock?.score);
    const awayScoreFromSchedule = readInteger(awayBlock?.score);

    const lookupKey = `${normalizeTeamKey(homeTeamName)}::${normalizeTeamKey(awayTeamName)}`;
    const matched = matchLookup.get(lookupKey);

    let livePayload: Record<string, unknown> | null = null;
    if (status === "LIVE") {
      try {
        livePayload = await fetchMLBLiveState(gamePk);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`gamePk=${gamePk} live feed failed: ${message.slice(0, 220)}`);
      }
    }

    const homeScore = homeScoreFromSchedule ?? scoreFromPayload(livePayload, "home");
    const awayScore = awayScoreFromSchedule ?? scoreFromPayload(livePayload, "away");
    const progress = buildLiveProgress(livePayload, detailedState);
    const isLiveStale = status === "LIVE" ? !livePayload : true;

    snapshotRows.push({
      gameId: gamePk,
      leagueId: "mlb",
      sport: "baseball",
      status,
      homeScore,
      awayScore,
      progress,
      source: "mlb_statsapi",
      providerGameId: gamePk,
      providerMatchId: matched?.matchId || null,
      livePayload,
      lastSyncAt: new Date().toISOString(),
      isLiveStale,
    });

    const liveSituation = status === "LIVE" && livePayload ? livePayload : null;

    if (matched?.homeId) {
      const homeUpdate: Record<string, unknown> = {
        GameResultID: matched.homeId,
        live_situation: liveSituation,
        last_sync_at: Spanner.COMMIT_TIMESTAMP,
        is_live_stale: isLiveStale,
      };
      if (homeScore != null) homeUpdate.TeamScore = homeScore;
      if (awayScore != null) homeUpdate.OpponentScore = awayScore;
      if (homeScore != null && awayScore != null) {
        homeUpdate.GameTotal = homeScore + awayScore;
      }
      legacyGameResultUpdates.push(homeUpdate);
    }

    if (matched?.awayId) {
      const awayUpdate: Record<string, unknown> = {
        GameResultID: matched.awayId,
        live_situation: liveSituation,
        last_sync_at: Spanner.COMMIT_TIMESTAMP,
        is_live_stale: isLiveStale,
      };
      if (awayScore != null) awayUpdate.TeamScore = awayScore;
      if (homeScore != null) awayUpdate.OpponentScore = homeScore;
      if (homeScore != null && awayScore != null) {
        awayUpdate.GameTotal = homeScore + awayScore;
      }
      legacyGameResultUpdates.push(awayUpdate);
    }
  }

  const snapshotResult = await upsertGameLiveSnapshots(snapshotRows);
  const legacyResult = await applyLegacyGameResultLiveUpdates(legacyGameResultUpdates);

  errors.push(...snapshotResult.errors, ...legacyResult.errors);

  return {
    snapshotsWritten: snapshotResult.written,
    legacyRowsUpdated: legacyResult.written,
    upstreamLiveCount,
    snapshotTable: snapshotResult.table,
    errors,
  };
}

function parseSyncInput(raw: unknown): {
  requestedLeagues: string[];
  daysBack: number;
  daysForward: number;
} {
  const payload = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as SportsSyncInput
    : {};

  const requestedLeagues = Array.isArray(payload.leagues)
    ? payload.leagues
      .map((value) => readString(value).toLowerCase())
      .filter(Boolean)
    : [];

  const daysBack = clampInteger(readInteger(payload.daysBack), 3, 0, 14);
  const daysForward = clampInteger(readInteger(payload.daysForward), 3, 0, 7);

  return {
    requestedLeagues,
    daysBack,
    daysForward,
  };
}

export async function runSportsSync(input: unknown = {}): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const parsedInput = parseSyncInput(input);

  const leaguesToSync = parsedInput.requestedLeagues.length > 0
    ? LEAGUES.filter((league) => parsedInput.requestedLeagues.includes(league.leagueId))
    : LEAGUES;

  const dates = buildDateRange(parsedInput.daysBack, parsedInput.daysForward);

  const details: SportsSyncDetail[] = [];
  let totalEvents = 0;
  let totalRowsWritten = 0;
  let totalLiveSnapshotsWritten = 0;
  let totalLegacyLiveRowsUpdated = 0;

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
          details.push({
            league: config.leagueId,
            date,
            events: 0,
            rows: 0,
            written: 0,
            errors: [],
          });
          continue;
        }

        const allRows: Array<Record<string, any>> = [];
        for (const event of events) {
          const parsedRows = parseEvent(event, config, date);
          allRows.push(...parsedRows);
        }

        const writeResult = await upsertToSpanner(allRows);
        let liveSnapshotsWritten = 0;
        let legacyLiveRowsUpdated = 0;
        let upstreamLiveCount = 0;
        let liveSnapshotTable: string | null = null;
        const errors = [...writeResult.errors];

        if (config.leagueId === "mlb") {
          try {
            const liveResult = await syncMlbLiveState(date, allRows);
            liveSnapshotsWritten = liveResult.snapshotsWritten;
            legacyLiveRowsUpdated = liveResult.legacyRowsUpdated;
            upstreamLiveCount = liveResult.upstreamLiveCount;
            liveSnapshotTable = liveResult.snapshotTable;
            errors.push(...liveResult.errors);
            totalLiveSnapshotsWritten += liveSnapshotsWritten;
            totalLegacyLiveRowsUpdated += legacyLiveRowsUpdated;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`[mlb-live] ${message.slice(0, 260)}`);
          }
        }

        totalEvents += events.length;
        totalRowsWritten += writeResult.written;

        details.push({
          league: config.leagueId,
          date,
          events: events.length,
          rows: allRows.length,
          written: writeResult.written,
          live_snapshots_written: liveSnapshotsWritten,
          legacy_live_rows_updated: legacyLiveRowsUpdated,
          upstream_live_count: upstreamLiveCount,
          live_snapshot_table: liveSnapshotTable,
          errors,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        details.push({
          league: config.leagueId,
          date,
          events: 0,
          rows: 0,
          written: 0,
          errors: [message.slice(0, 300)],
        });
      }
    }
  }

  return {
    ok: true,
    elapsed_ms: Date.now() - startedAt,
    leagues_synced: leaguesToSync.length,
    dates_covered: dates,
    total_events: totalEvents,
    total_rows_written: totalRowsWritten,
    total_live_snapshots_written: totalLiveSnapshotsWritten,
    total_legacy_live_rows_updated: totalLegacyLiveRowsUpdated,
    details: details.filter((detail) => detail.events > 0 || detail.errors.length > 0),
  };
}

// ── Route handlers ─────────────────────────────────────────
export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const { response } = await requireAuth(request);
  if (response) return response;

  const body = await request.json().catch(() => ({}));

  try {
    const result = await runSportsSync(body);
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store, max-age=0, must-revalidate",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    console.error("[sports-sync] failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: "Failed to sync sports data." },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0, must-revalidate",
          "x-request-id": requestId,
        },
      },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ready",
    endpoint: "POST /api/sports-sync",
    scheduler_endpoint: "POST /api/system/cron/sports-sync",
    auth: "Bearer Firebase ID token or Cloud Scheduler OIDC token",
    usage: {
      default: "POST with empty body -> syncs all leagues, +/-3 days",
      custom: "POST { leagues: ['mlb','nba'], daysBack: 1, daysForward: 2 }",
    },
    supported_leagues: LEAGUES.map((league) => league.leagueId),
  });
}

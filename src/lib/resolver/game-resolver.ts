import {
  loadCanonicalSportsGame,
  searchCanonicalSportsGames,
  withSportsGameUrls,
} from "@/lib/sports/game-canonical";
import { buildGameLinks } from "./links";
import type { HubResponse } from "./candidate-resolver";

function buildSummary(game: ReturnType<typeof withSportsGameUrls>): string {
  const league = game.leagueLabel || game.leagueId || "Sports";
  const matchup = `${game.awayTeam} @ ${game.homeTeam}`;
  const dateOrTime = game.startTime || game.date || "TBD";
  const status = game.status || "unknown";

  return `${league} | ${matchup} | ${dateOrTime} | Status: ${status}`;
}

export async function resolveGame(identifier: string): Promise<HubResponse> {
  // Check for /live suffix FIRST, before any DB lookups
  if (identifier.endsWith("/live")) {
    return resolveLiveGame(identifier.replace(/\/live$/, ""));
  }

  const game = await loadCanonicalSportsGame(identifier);

  if (game) {
    const canonical = withSportsGameUrls(game);
    return {
      type: "game",
      id: canonical.id,
      status: "resolved",
      summary: buildSummary(canonical),
      data: {
        id: canonical.id,
        source: canonical.source,
        sport: canonical.sport,
        league_id: canonical.leagueId,
        league_label: canonical.leagueLabel,
        home_team: canonical.homeTeam,
        away_team: canonical.awayTeam,
        home_abbrev: canonical.homeAbbrev,
        away_abbrev: canonical.awayAbbrev,
        home_logo: canonical.homeLogo,
        away_logo: canonical.awayLogo,
        date: canonical.date,
        start_time: canonical.startTime,
        status: canonical.status,
        venue: canonical.venue,
        home_record: canonical.homeRecord,
        away_record: canonical.awayRecord,
        spread: canonical.spread,
        total: canonical.total,
        writeup_url: canonical.writeupUrl,
        published_at: canonical.publishedAt,
        hub_url: canonical.hubUrl,
        api_url: canonical.apiUrl,
        public_url: canonical.publicUrl,
      },
      links: buildGameLinks(canonical.id, {
        writeupUrl: canonical.writeupUrl,
      }),
    };
  }

  const alternatives = await searchCanonicalSportsGames(identifier, 5);
  if (alternatives.length === 0) {
    return {
      type: "game",
      status: "not_found",
      summary: `No game matched "${identifier}".`,
      data: null,
      links: {},
    };
  }

  if (alternatives.length === 1) {
    const single = await loadCanonicalSportsGame(alternatives[0].id);
    if (single) {
      const canonical = withSportsGameUrls(single);
      return {
        type: "game",
        id: canonical.id,
        status: "resolved",
        summary: buildSummary(canonical),
        data: {
          id: canonical.id,
          source: canonical.source,
          sport: canonical.sport,
          league_id: canonical.leagueId,
          league_label: canonical.leagueLabel,
          home_team: canonical.homeTeam,
          away_team: canonical.awayTeam,
          home_abbrev: canonical.homeAbbrev,
          away_abbrev: canonical.awayAbbrev,
          home_logo: canonical.homeLogo,
          away_logo: canonical.awayLogo,
          date: canonical.date,
          start_time: canonical.startTime,
          status: canonical.status,
          venue: canonical.venue,
          home_record: canonical.homeRecord,
          away_record: canonical.awayRecord,
          spread: canonical.spread,
          total: canonical.total,
          writeup_url: canonical.writeupUrl,
          published_at: canonical.publishedAt,
          hub_url: canonical.hubUrl,
          api_url: canonical.apiUrl,
          public_url: canonical.publicUrl,
        },
        links: buildGameLinks(canonical.id, {
          writeupUrl: canonical.writeupUrl,
        }),
      };
    }
  }


  return {
    type: "game",
    status: "ambiguous",
    summary: `Multiple games matched "${identifier}". Please clarify using the game id.`,
    data: null,
    links: {},
    alternatives: alternatives.map((entry) => ({
      name: entry.label,
      id: entry.id,
      nova_id: null,
      status: entry.status,
      specialty: entry.leagueLabel,
      confidence: 50,
    })),
  };
}

export async function resolveLiveGame(gameId: string): Promise<HubResponse> {
  const { getDb } = await import("@/lib/spanner-pool");
  const db = getDb("sportsdb");
  const [rows] = await db.run({
    sql: `SELECT live_situation, is_live_stale 
          FROM GameResult 
          WHERE MatchID = @gameId OR MatchID = CONCAT(@gameId, '_mlb')`,
    params: { gameId },
    types: { gameId: { type: "string" } },
  });

  if (!rows.length) {
    return {
      type: "live_status",
      status: "not_found",
      summary: `No live data found for game ${gameId}.`,
      data: null,
      links: {},
    };
  }

  const data = rows[0].toJSON();
  const situation = data.live_situation;
  
  if (!situation) {
    return {
      type: "live_status",
      status: "not_found",
      summary: `Game ${gameId} has not started or has no live data feed.`,
      data: null,
      links: {},
    };
  }

  const lastUpdate = new Date(situation.last_updated).getTime();
  const isStale = data.is_live_stale || (Date.now() - lastUpdate > 300_000);

  return {
    type: "live_status",
    status: "resolved",
    summary: `Live status for game ${gameId}`,
    data: {
      url: `hub://sports/mlb/game/${gameId}/live`,
      ...situation,
      is_stale: isStale,
    },
    links: {
      game: `/api/hub/games/${encodeURIComponent(gameId)}`,
    },
  };
}

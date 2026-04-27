import {
  loadCanonicalSportsGame,
  searchCanonicalSportsGames,
  withSportsGameUrls,
} from "@/lib/sports/game-canonical";
import { loadGameLiveSnapshotByGameId } from "@/lib/sports/live-snapshot";
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
        live: canonical.live,
        is_live_stale: canonical.is_live_stale,
        live_source: canonical.liveSource,
        last_sync_at: canonical.lastSyncAt,
        provider_game_id: canonical.providerGameId,
        provider_match_id: canonical.providerMatchId,
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
          live: canonical.live,
          is_live_stale: canonical.is_live_stale,
          live_source: canonical.liveSource,
          last_sync_at: canonical.lastSyncAt,
          provider_game_id: canonical.providerGameId,
          provider_match_id: canonical.providerMatchId,
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
  const snapshot = await loadGameLiveSnapshotByGameId(gameId);
  if (!snapshot) {
    return {
      type: "live_status",
      status: "not_found",
      summary: `No live data found for game ${gameId}.`,
      data: null,
      links: {},
    };
  }

  const livePayload =
    snapshot.status === "LIVE" && !snapshot.isLiveStale
      ? {
          ...(snapshot.livePayload || {}),
          status: snapshot.status,
          game_status: snapshot.status,
          progress: snapshot.progress || null,
          last_updated: snapshot.lastSyncAt || null,
        }
      : null;

  return {
    type: "live_status",
    status: "resolved",
    summary: `${gameId} | ${snapshot.status}${snapshot.progress ? ` | ${snapshot.progress}` : ""}`,
    data: {
      url: `hub://sports/mlb/game/${gameId}/live`,
      game_id: snapshot.gameId,
      status: snapshot.status,
      home_score: snapshot.homeScore,
      away_score: snapshot.awayScore,
      progress: snapshot.progress,
      source: snapshot.source,
      provider_game_id: snapshot.providerGameId,
      provider_match_id: snapshot.providerMatchId,
      last_sync_at: snapshot.lastSyncAt,
      is_stale: snapshot.isLiveStale,
      live: livePayload,
    },
    links: {
      game: `/api/hub/games/${encodeURIComponent(gameId)}`,
    },
  };
}

import { NextRequest, NextResponse } from "next/server";
import {
  loadCanonicalSportsGame,
  loadGameTrendTables,
  withSportsGameUrls,
} from "@/lib/sports/game-canonical";

export const runtime = "nodejs";

function jsonNoStore(body: unknown, status: number, requestId: string) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0, must-revalidate",
      "x-request-id": requestId,
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const { gameId: gameIdRaw } = await params;
  const gameId = String(gameIdRaw || "").trim();

  if (!gameId) {
    return jsonNoStore({ error: "Game ID is required." }, 400, requestId);
  }

  try {
    const game = await loadCanonicalSportsGame(gameId);

    if (!game) {
      return jsonNoStore(
        {
          type: "game",
          status: "not_found",
          summary: `No game matched "${gameId}".`,
          data: null,
          links: {},
        },
        404,
        requestId,
      );
    }

    const canonical = withSportsGameUrls(game);
    const trends = await loadGameTrendTables(game, 5);

    return jsonNoStore(
      {
        type: "game",
        id: canonical.id,
        status: "resolved",
        summary: `${canonical.leagueLabel || canonical.leagueId || "Sports"} | ${canonical.awayTeam} @ ${canonical.homeTeam}`,
        data: {
          id: canonical.id,
          source: canonical.source,
          sport: canonical.sport,
          leagueId: canonical.leagueId,
          leagueLabel: canonical.leagueLabel,
          homeTeam: canonical.homeTeam,
          awayTeam: canonical.awayTeam,
          homeAbbrev: canonical.homeAbbrev,
          awayAbbrev: canonical.awayAbbrev,
          homeLogo: canonical.homeLogo,
          awayLogo: canonical.awayLogo,
          date: canonical.date,
          startTime: canonical.startTime,
          status: canonical.status,
          venue: canonical.venue,
          homeRecord: canonical.homeRecord,
          awayRecord: canonical.awayRecord,
          spread: canonical.spread,
          total: canonical.total,
          homeScore: canonical.homeScore,
          awayScore: canonical.awayScore,
          homeATSResult: canonical.homeATSResult,
          awayATSResult: canonical.awayATSResult,
          live: canonical.live,
          is_live_stale: canonical.is_live_stale,
          liveSource: canonical.liveSource,
          lastSyncAt: canonical.lastSyncAt,
          providerGameId: canonical.providerGameId,
          providerMatchId: canonical.providerMatchId,
          trendHome: trends.home,
          trendAway: trends.away,
          writeupUrl: canonical.writeupUrl,
          publishedAt: canonical.publishedAt,
          hubUrl: canonical.hubUrl,
          apiUrl: canonical.apiUrl,
          publicUrl: canonical.publicUrl,
        },
        links: {
          self: canonical.apiUrl,
          hub: canonical.hubUrl,
          public: canonical.publicUrl,
          writeup: canonical.writeupUrl,
        },
      },
      200,
      requestId,
    );
  } catch (error) {
    console.error("[sports-game-api] Failed to resolve game", {
      gameId,
      error: error instanceof Error ? error.message : String(error),
    });

    return jsonNoStore(
      { error: "Failed to resolve sports game." },
      500,
      requestId,
    );
  }
}

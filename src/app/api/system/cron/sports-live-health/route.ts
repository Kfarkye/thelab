import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import { normalizeMLBStatusCode } from "@/lib/sports/status";
import { loadGameLiveSnapshotsByGameIds } from "@/lib/sports/live-snapshot";

export const runtime = "nodejs";

function readString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

function resolveDate(input: string | null): string {
  if (input && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    return input.trim();
  }
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const { response } = await requireAuth(request);
  if (response) return response;

  const date = resolveDate(request.nextUrl.searchParams.get("date"));

  try {
    const upstreamResponse = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!upstreamResponse.ok) {
      return NextResponse.json(
        { error: `MLB schedule upstream returned HTTP ${upstreamResponse.status}` },
        {
          status: 502,
          headers: {
            "Cache-Control": "no-store, max-age=0, must-revalidate",
            "x-request-id": requestId,
          },
        },
      );
    }

    const scheduleData = await upstreamResponse.json();
    const gameRows: Array<{ gameId: string; status: string }> = [];

    for (const scheduleDate of scheduleData?.dates || []) {
      for (const game of scheduleDate?.games || []) {
        const gameId = readString(game?.gamePk);
        if (!gameId) continue;

        const statusTokens = [
          game?.status?.codedGameState,
          game?.status?.abstractGameCode,
          game?.status?.detailedState,
          game?.status?.abstractGameState,
        ]
          .map((token: unknown) => readString(token))
          .filter(Boolean);

        const normalizedStatus = statusTokens.length > 0
          ? normalizeMLBStatusCode(statusTokens.join(" "))
          : "SCHEDULED";

        gameRows.push({ gameId, status: normalizedStatus });
      }
    }

    const upstreamLiveGameIds = gameRows
      .filter((row) => row.status === "LIVE")
      .map((row) => row.gameId);

    const snapshotsByGameId = await loadGameLiveSnapshotsByGameIds(
      gameRows.map((row) => row.gameId),
    );

    const appLiveGameIds: string[] = [];
    const missingLiveGameIds: string[] = [];

    for (const gameId of upstreamLiveGameIds) {
      const snapshot = snapshotsByGameId.get(gameId);
      if (snapshot && snapshot.status === "LIVE" && !snapshot.isLiveStale) {
        appLiveGameIds.push(gameId);
      } else {
        missingLiveGameIds.push(gameId);
      }
    }

    const unexpectedLiveGameIds: string[] = [];
    for (const [gameId, snapshot] of snapshotsByGameId.entries()) {
      if (snapshot.status === "LIVE" && !snapshot.isLiveStale && !upstreamLiveGameIds.includes(gameId)) {
        unexpectedLiveGameIds.push(gameId);
      }
    }

    return NextResponse.json(
      {
        ok: missingLiveGameIds.length === 0,
        date,
        upstream_live_count: upstreamLiveGameIds.length,
        app_live_count: appLiveGameIds.length,
        missing_live_game_ids: missingLiveGameIds,
        unexpected_live_game_ids: unexpectedLiveGameIds,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0, must-revalidate",
          "x-request-id": requestId,
        },
      },
    );
  } catch (error) {
    console.error("[sports-live-health] failed", {
      date,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: "Failed to evaluate sports live health." },
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

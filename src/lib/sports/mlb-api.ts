import { LiveSituation } from "@/lib/sports/types";

export async function fetchMLBLiveState(gamePk: string): Promise<LiveSituation | null> {
  const url = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });

  if (!response.ok) return null;
  const data = await response.json();

  const linescore = data?.liveData?.linescore;
  const currentPlay = data?.liveData?.plays?.currentPlay;

  const inning = Number(linescore?.currentInning ?? 0) || 0;
  const inningHalfRaw = String(linescore?.inningHalf || "TOP").toUpperCase();
  const half = inningHalfRaw === "BOTTOM" ? "BOTTOM" : "TOP";
  const progress = inning > 0 ? `${half === "BOTTOM" ? "Bottom" : "Top"} ${inning}` : null;

  const homeScore = linescore?.teams?.home?.runs != null
    ? Number(linescore.teams.home.runs)
    : null;
  const awayScore = linescore?.teams?.away?.runs != null
    ? Number(linescore.teams.away.runs)
    : null;

  const detailedState = String(data?.gameData?.status?.detailedState || "").trim();

  return {
    current_play: currentPlay?.result?.description ?? "Game in progress",
    batter_id: String(currentPlay?.matchup?.batter?.id ?? ""),
    pitcher_id: String(currentPlay?.matchup?.pitcher?.id ?? ""),
    inning: inning || 1,
    half,
    outs: Number(linescore?.outs ?? 0) || 0,
    balls: Number(currentPlay?.count?.balls ?? 0) || 0,
    strikes: Number(currentPlay?.count?.strikes ?? 0) || 0,
    bases: {
      first: Boolean(linescore?.offense?.first),
      second: Boolean(linescore?.offense?.second),
      third: Boolean(linescore?.offense?.third),
    },
    last_updated: new Date().toISOString(),
    status: detailedState || "IN_PROGRESS",
    game_status: detailedState || "IN_PROGRESS",
    progress,
    home_score: Number.isFinite(homeScore) ? homeScore : null,
    away_score: Number.isFinite(awayScore) ? awayScore : null,
    provider_game_id: gamePk,
  };
}

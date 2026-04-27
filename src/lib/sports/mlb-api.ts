import { LiveSituation } from "@/lib/sports/types";

export async function fetchMLBLiveState(gamePk: string): Promise<LiveSituation | null> {
  const url = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;
  const response = await fetch(url);
  
  if (!response.ok) return null;
  const data = await response.json();
  
  const ls = data.liveData.linescore;
  const cp = data.liveData.plays.currentPlay;

  return {
    current_play: cp?.result?.description ?? "Game in progress",
    batter_id: String(cp?.matchup?.batter?.id ?? ""),
    pitcher_id: String(cp?.matchup?.pitcher?.id ?? ""),
    inning: ls?.currentInning ?? 1,
    half: (ls?.inningHalf?.toUpperCase() ?? "TOP") as "TOP" | "BOTTOM",
    outs: ls?.outs ?? 0,
    balls: cp?.count?.balls ?? 0,
    strikes: cp?.count?.strikes ?? 0,
    bases: {
      first: !!ls?.offense?.first,
      second: !!ls?.offense?.second,
      third: !!ls?.offense?.third,
    },
    last_updated: new Date().toISOString(),
  };
}

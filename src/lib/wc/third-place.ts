/**
 * World Cup 2026 — Third-Place Ladder Resolver
 * Ranks all 12 third-place teams; top 8 advance to Round of 32.
 * Ranking: Points → GD → GS → Fair Play → FIFA Ranking
 */

import { type TeamStanding } from "./standings";

export interface ThirdPlaceEntry {
  teamId: string;
  teamName: string;
  fifaCode: string;
  groupCode: string;
  points: number;
  goalDifference: number;
  goalsScored: number;
  fairPlayScore: number;
  rank: number;            // 1–12 among all third-place teams
  qualifying: boolean;     // top 8 qualify
}

/**
 * Resolves the third-place ladder.
 * Input: Map of group standings (from resolveAllGroupStandings)
 * Output: Ranked ladder of all 12 third-place teams
 */
export function resolveThirdPlaceLadder(
  groupStandings: Map<string, TeamStanding[]>
): ThirdPlaceEntry[] {
  // Extract 3rd-place teams from each group
  const thirdPlaceTeams: Array<{
    teamId: string;
    teamName: string;
    fifaCode: string;
    groupCode: string;
    points: number;
    goalDifference: number;
    goalsScored: number;
    fairPlayScore: number;
  }> = [];

  for (const [, standings] of groupStandings) {
    const third = standings.find((s) => s.position === 3);
    if (third) {
      thirdPlaceTeams.push({
        teamId: third.teamId,
        teamName: third.teamName,
        fifaCode: third.fifaCode,
        groupCode: third.groupCode,
        points: third.points,
        goalDifference: third.goalDifference,
        goalsScored: third.goalsScored,
        fairPlayScore: third.fairPlayScore,
      });
    }
  }

  // Sort: Points DESC → GD DESC → GS DESC → Fair Play ASC (fewer = better)
  const sorted = thirdPlaceTeams.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsScored !== a.goalsScored) return b.goalsScored - a.goalsScored;
    if (a.fairPlayScore !== b.fairPlayScore) return a.fairPlayScore - b.fairPlayScore;
    return 0;
  });

  return sorted.map((team, index) => ({
    ...team,
    rank: index + 1,
    qualifying: index < 8, // top 8 advance
  }));
}

/**
 * Returns the set of group codes whose third-place team qualifies.
 * This is the key input for the third-place matrix mapping.
 */
export function getQualifyingThirdPlaceGroups(
  ladder: ThirdPlaceEntry[]
): string[] {
  return ladder
    .filter((e) => e.qualifying)
    .map((e) => e.groupCode)
    .sort();
}

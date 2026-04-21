/**
 * World Cup 2026 — Group Standings Resolver
 * Sorts teams by: Points → GD → GS → Fair Play → Head-to-Head → Random
 */

export interface TeamStanding {
  teamId: string;
  teamName: string;
  fifaCode: string;
  groupCode: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsScored: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  fairPlayScore: number;
  yellowCards: number;
  redCards: number;
  position: number;
  advancing: boolean; // top 2 auto-advance
  thirdPlace: boolean; // 3rd goes to third-place ladder
}

/**
 * Resolves sorted standings for a single group.
 * Input: array of team states for one group (4 teams)
 * Output: sorted standings with positions and advancing status
 */
export function resolveGroupStandings(
  teamStates: Array<{
    teamId: string;
    teamName: string;
    fifaCode: string;
    groupCode: string;
    played: number;
    won: number;
    drawn: number;
    lost: number;
    goalsScored: number;
    goalsAgainst: number;
    goalDifference: number;
    points: number;
    fairPlayScore: number;
    yellowCards: number;
    redCards: number;
  }>
): TeamStanding[] {
  // Sort: points DESC → GD DESC → GS DESC → fair play ASC (fewer = better) → random
  const sorted = [...teamStates].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsScored !== a.goalsScored) return b.goalsScored - a.goalsScored;
    if (a.fairPlayScore !== b.fairPlayScore) return a.fairPlayScore - b.fairPlayScore;
    return 0; // tie — would go to head-to-head then drawing of lots
  });

  return sorted.map((team, index) => ({
    ...team,
    position: index + 1,
    advancing: index < 2,    // top 2 auto-advance
    thirdPlace: index === 2, // 3rd goes to ladder
  }));
}

/**
 * Resolves standings for all 12 groups
 */
export function resolveAllGroupStandings(
  allTeamStates: Array<{
    teamId: string;
    teamName: string;
    fifaCode: string;
    groupCode: string;
    played: number;
    won: number;
    drawn: number;
    lost: number;
    goalsScored: number;
    goalsAgainst: number;
    goalDifference: number;
    points: number;
    fairPlayScore: number;
    yellowCards: number;
    redCards: number;
  }>
): Map<string, TeamStanding[]> {
  // Group by groupCode
  const groups = new Map<string, typeof allTeamStates>();
  for (const team of allTeamStates) {
    const existing = groups.get(team.groupCode) || [];
    existing.push(team);
    groups.set(team.groupCode, existing);
  }

  // Resolve each group
  const result = new Map<string, TeamStanding[]>();
  for (const [groupCode, teams] of groups) {
    result.set(groupCode, resolveGroupStandings(teams));
  }

  return result;
}

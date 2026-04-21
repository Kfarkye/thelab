/**
 * World Cup 2026 — What-If Simulator
 * Clones tournament state, applies hypothetical results, re-resolves everything.
 * Returns a structured diff.
 */

import { resolveGroupStandings, resolveAllGroupStandings, type TeamStanding } from "./standings";
import { resolveThirdPlaceLadder, getQualifyingThirdPlaceGroups, type ThirdPlaceEntry } from "./third-place";
import { resolveRoundOf32, type BracketMatch } from "./bracket";

export interface HypotheticalResult {
  groupCode: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
}

export interface TeamStateDelta {
  teamId: string;
  teamName: string;
  field: string;
  before: string | number | boolean;
  after: string | number | boolean;
}

export interface SimulationDiff {
  changedGroupPositions: TeamStateDelta[];
  changedThirdPlaceLadder: TeamStateDelta[];
  changedBracketOpponents: Array<{
    teamId: string;
    teamName: string;
    beforeOpponent: string | null;
    afterOpponent: string | null;
    round: string;
  }>;
  explanation: string;
}

export interface TournamentSnapshot {
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
  }>;
}

/**
 * Deep clone a tournament snapshot
 */
function cloneSnapshot(snapshot: TournamentSnapshot): TournamentSnapshot {
  return {
    teamStates: snapshot.teamStates.map((t) => ({ ...t })),
  };
}

/**
 * Apply a hypothetical match result to team states
 */
function applyResult(
  states: TournamentSnapshot["teamStates"],
  result: HypotheticalResult
): void {
  const home = states.find((s) => s.teamId === result.homeTeamId);
  const away = states.find((s) => s.teamId === result.awayTeamId);

  if (!home || !away) return;

  // Update match stats
  home.played += 1;
  away.played += 1;
  home.goalsScored += result.homeScore;
  home.goalsAgainst += result.awayScore;
  away.goalsScored += result.awayScore;
  away.goalsAgainst += result.homeScore;
  home.goalDifference = home.goalsScored - home.goalsAgainst;
  away.goalDifference = away.goalsScored - away.goalsAgainst;

  if (result.homeScore > result.awayScore) {
    home.won += 1;
    away.lost += 1;
    home.points += 3;
  } else if (result.homeScore < result.awayScore) {
    away.won += 1;
    home.lost += 1;
    away.points += 3;
  } else {
    home.drawn += 1;
    away.drawn += 1;
    home.points += 1;
    away.points += 1;
  }
}

/**
 * Run a what-if simulation.
 * 
 * 1. Clones current state
 * 2. Applies hypothetical results
 * 3. Re-resolves standings, ladder, bracket
 * 4. Computes diff against baseline
 */
export function simulate(
  currentSnapshot: TournamentSnapshot,
  hypotheticals: HypotheticalResult[]
): SimulationDiff {
  // Resolve baseline state
  const baseStandings = resolveAllGroupStandings(currentSnapshot.teamStates);
  const baseLadder = resolveThirdPlaceLadder(baseStandings);
  const baseQualGroups = getQualifyingThirdPlaceGroups(baseLadder);
  const baseBracket = resolveRoundOf32(baseStandings, baseQualGroups);

  // Clone + apply hypotheticals
  const simSnapshot = cloneSnapshot(currentSnapshot);
  for (const result of hypotheticals) {
    applyResult(simSnapshot.teamStates, result);
  }

  // Resolve simulated state
  const simStandings = resolveAllGroupStandings(simSnapshot.teamStates);
  const simLadder = resolveThirdPlaceLadder(simStandings);
  const simQualGroups = getQualifyingThirdPlaceGroups(simLadder);
  const simBracket = resolveRoundOf32(simStandings, simQualGroups);

  // Compute diffs
  const changedGroupPositions: TeamStateDelta[] = [];
  for (const [groupCode, simTeams] of simStandings) {
    const baseTeams = baseStandings.get(groupCode) || [];
    for (const simTeam of simTeams) {
      const baseTeam = baseTeams.find((b) => b.teamId === simTeam.teamId);
      if (!baseTeam) continue;
      if (baseTeam.position !== simTeam.position) {
        changedGroupPositions.push({
          teamId: simTeam.teamId,
          teamName: simTeam.teamName,
          field: "position",
          before: baseTeam.position,
          after: simTeam.position,
        });
      }
      if (baseTeam.advancing !== simTeam.advancing) {
        changedGroupPositions.push({
          teamId: simTeam.teamId,
          teamName: simTeam.teamName,
          field: "advancing",
          before: baseTeam.advancing,
          after: simTeam.advancing,
        });
      }
    }
  }

  // Third-place ladder diffs
  const changedThirdPlaceLadder: TeamStateDelta[] = [];
  for (const simEntry of simLadder) {
    const baseEntry = baseLadder.find((b) => b.teamId === simEntry.teamId);
    if (!baseEntry) continue;
    if (baseEntry.rank !== simEntry.rank) {
      changedThirdPlaceLadder.push({
        teamId: simEntry.teamId,
        teamName: simEntry.teamName,
        field: "rank",
        before: baseEntry.rank,
        after: simEntry.rank,
      });
    }
    if (baseEntry.qualifying !== simEntry.qualifying) {
      changedThirdPlaceLadder.push({
        teamId: simEntry.teamId,
        teamName: simEntry.teamName,
        field: "qualifying",
        before: baseEntry.qualifying,
        after: simEntry.qualifying,
      });
    }
  }

  // Bracket opponent diffs
  const changedBracketOpponents: SimulationDiff["changedBracketOpponents"] = [];
  for (let i = 0; i < baseBracket.length; i++) {
    const baseMatch = baseBracket[i];
    const simMatch = simBracket[i];
    if (!baseMatch || !simMatch) continue;

    if (baseMatch.team1.teamId !== simMatch.team1.teamId) {
      changedBracketOpponents.push({
        teamId: simMatch.team1.teamId || "TBD",
        teamName: simMatch.team1.teamName || "TBD",
        beforeOpponent: baseMatch.team2.teamName,
        afterOpponent: simMatch.team2.teamName,
        round: "R32",
      });
    }
  }

  // Generate explanation
  const explanationParts: string[] = [];
  if (changedGroupPositions.length > 0) {
    const posChanges = changedGroupPositions.filter((d) => d.field === "position");
    if (posChanges.length > 0) {
      explanationParts.push(
        `${posChanges.map((d) => `${d.teamName} moves from ${d.before} to ${d.after}`).join("; ")}`
      );
    }
  }
  if (changedThirdPlaceLadder.length > 0) {
    const qualChanges = changedThirdPlaceLadder.filter((d) => d.field === "qualifying");
    if (qualChanges.length > 0) {
      explanationParts.push(
        `Third-place ladder: ${qualChanges.map((d) => `${d.teamName} ${d.after ? "now qualifies" : "is eliminated"}`).join("; ")}`
      );
    }
  }
  if (changedBracketOpponents.length > 0) {
    explanationParts.push(
      `Bracket shifts: ${changedBracketOpponents.map((d) => `${d.teamName} would now face ${d.afterOpponent || "TBD"} in ${d.round}`).join("; ")}`
    );
  }

  const explanation = explanationParts.length > 0
    ? explanationParts.join(". ") + "."
    : "No changes to standings, ladder, or bracket.";

  return {
    changedGroupPositions,
    changedThirdPlaceLadder,
    changedBracketOpponents,
    explanation,
  };
}

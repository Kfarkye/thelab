/**
 * World Cup 2026 — Bracket Path Resolver
 * Materializes the full knockout bracket from group standings + third-place ladder.
 *
 * Round of 32 structure (16 matches):
 * - 24 teams from top-2 of each group (12 groups × 2)
 * - 8 teams from best third-place
 * Total: 32 teams → 16 R32 matches → 8 R16 → 4 QF → 2 SF → Final
 */

import { type TeamStanding } from "./standings";
import { type ThirdPlaceEntry } from "./third-place";
import { resolveThirdPlaceSlots } from "./third-place-matrix";

export interface BracketSlot {
  slotId: string;       // e.g. "R32-1", "R16-1", "QF-1", "SF-1", "F"
  round: "R32" | "R16" | "QF" | "SF" | "F";
  teamId: string | null;
  teamName: string | null;
  fifaCode: string | null;
  seedSource: string;   // e.g. "1st Group A", "3rd Group C"
}

export interface BracketMatch {
  matchSlot: string;
  round: "R32" | "R16" | "QF" | "SF" | "F";
  team1: BracketSlot;
  team2: BracketSlot;
  winnerAdvancesTo: string | null;
}

/**
 * The fixed bracket structure for 48-team World Cup.
 * Each R32 match pairs a group winner/runner-up with another seed.
 * This is the template — teams are filled in based on standings.
 */
const R32_TEMPLATE: Array<{
  matchSlot: string;
  team1Source: { type: "group_pos"; group: string; position: 1 | 2 };
  team2Source: { type: "group_pos"; group: string; position: 1 | 2 } | { type: "third_place"; group: string };
  winnerAdvancesTo: string;
}> = [
  // Top half
  { matchSlot: "R32-1",  team1Source: { type: "group_pos", group: "A", position: 1 }, team2Source: { type: "third_place", group: "A" }, winnerAdvancesTo: "R16-1" },
  { matchSlot: "R32-2",  team1Source: { type: "group_pos", group: "B", position: 1 }, team2Source: { type: "third_place", group: "B" }, winnerAdvancesTo: "R16-1" },
  { matchSlot: "R32-3",  team1Source: { type: "group_pos", group: "C", position: 1 }, team2Source: { type: "third_place", group: "C" }, winnerAdvancesTo: "R16-2" },
  { matchSlot: "R32-4",  team1Source: { type: "group_pos", group: "D", position: 1 }, team2Source: { type: "third_place", group: "D" }, winnerAdvancesTo: "R16-2" },
  { matchSlot: "R32-5",  team1Source: { type: "group_pos", group: "A", position: 2 }, team2Source: { type: "group_pos", group: "B", position: 2 }, winnerAdvancesTo: "R16-3" },
  { matchSlot: "R32-6",  team1Source: { type: "group_pos", group: "C", position: 2 }, team2Source: { type: "group_pos", group: "D", position: 2 }, winnerAdvancesTo: "R16-3" },
  { matchSlot: "R32-7",  team1Source: { type: "group_pos", group: "E", position: 1 }, team2Source: { type: "third_place", group: "E" }, winnerAdvancesTo: "R16-4" },
  { matchSlot: "R32-8",  team1Source: { type: "group_pos", group: "F", position: 1 }, team2Source: { type: "third_place", group: "F" }, winnerAdvancesTo: "R16-4" },
  // Bottom half
  { matchSlot: "R32-9",  team1Source: { type: "group_pos", group: "G", position: 1 }, team2Source: { type: "third_place", group: "G" }, winnerAdvancesTo: "R16-5" },
  { matchSlot: "R32-10", team1Source: { type: "group_pos", group: "H", position: 1 }, team2Source: { type: "third_place", group: "H" }, winnerAdvancesTo: "R16-5" },
  { matchSlot: "R32-11", team1Source: { type: "group_pos", group: "I", position: 1 }, team2Source: { type: "group_pos", group: "J", position: 2 }, winnerAdvancesTo: "R16-6" },
  { matchSlot: "R32-12", team1Source: { type: "group_pos", group: "J", position: 1 }, team2Source: { type: "group_pos", group: "I", position: 2 }, winnerAdvancesTo: "R16-6" },
  { matchSlot: "R32-13", team1Source: { type: "group_pos", group: "E", position: 2 }, team2Source: { type: "group_pos", group: "F", position: 2 }, winnerAdvancesTo: "R16-7" },
  { matchSlot: "R32-14", team1Source: { type: "group_pos", group: "G", position: 2 }, team2Source: { type: "group_pos", group: "H", position: 2 }, winnerAdvancesTo: "R16-7" },
  { matchSlot: "R32-15", team1Source: { type: "group_pos", group: "K", position: 1 }, team2Source: { type: "group_pos", group: "L", position: 2 }, winnerAdvancesTo: "R16-8" },
  { matchSlot: "R32-16", team1Source: { type: "group_pos", group: "L", position: 1 }, team2Source: { type: "group_pos", group: "K", position: 2 }, winnerAdvancesTo: "R16-8" },
];

/**
 * Resolves the Round of 32 bracket from current standings.
 */
export function resolveRoundOf32(
  groupStandings: Map<string, TeamStanding[]>,
  qualifyingThirdPlaceGroups: string[]
): BracketMatch[] {
  // Build lookup maps
  const teamByGroupPosition = new Map<string, TeamStanding>();
  for (const [groupCode, standings] of groupStandings) {
    for (const team of standings) {
      teamByGroupPosition.set(`${groupCode}-${team.position}`, team);
    }
  }

  // Resolve third-place slots
  const thirdPlaceSlots = resolveThirdPlaceSlots(qualifyingThirdPlaceGroups);
  const qualifyingSet = new Set(qualifyingThirdPlaceGroups);

  // Build bracket
  return R32_TEMPLATE.map((template) => {
    const resolveSlot = (
      source: { type: "group_pos"; group: string; position: 1 | 2 } | { type: "third_place"; group: string },
      slotId: string
    ): BracketSlot => {
      if (source.type === "group_pos") {
        const key = `${source.group}-${source.position}`;
        const team = teamByGroupPosition.get(key);
        return {
          slotId,
          round: "R32",
          teamId: team?.teamId || null,
          teamName: team?.teamName || null,
          fifaCode: team?.fifaCode || null,
          seedSource: `${source.position === 1 ? "1st" : "2nd"} Group ${source.group}`,
        };
      } else {
        // Third place — check if this group's 3rd place qualifies
        if (!qualifyingSet.has(source.group)) {
          return {
            slotId,
            round: "R32",
            teamId: null,
            teamName: null,
            fifaCode: null,
            seedSource: `3rd Group ${source.group} (eliminated)`,
          };
        }
        const key = `${source.group}-3`;
        const team = teamByGroupPosition.get(key);
        return {
          slotId,
          round: "R32",
          teamId: team?.teamId || null,
          teamName: team?.teamName || null,
          fifaCode: team?.fifaCode || null,
          seedSource: `3rd Group ${source.group}`,
        };
      }
    };

    return {
      matchSlot: template.matchSlot,
      round: "R32" as const,
      team1: resolveSlot(template.team1Source, `${template.matchSlot}-1`),
      team2: resolveSlot(template.team2Source, `${template.matchSlot}-2`),
      winnerAdvancesTo: template.winnerAdvancesTo,
    };
  });
}

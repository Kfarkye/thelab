/**
 * World Cup 2026 — Third-Place Matrix
 * 
 * Maps the combination of 8 qualifying third-place groups
 * to their Round of 32 bracket positions.
 * 
 * FIFA has NOT yet published the official matrix for 48 teams.
 * This is a best-estimate stub based on the 2026 bracket structure.
 * 
 * ISOLATED: This is the ONE function to patch when FIFA publishes.
 *
 * Key format: sorted 8-character string of qualifying group codes
 * Value: map of group_code → R32 slot ID
 */

// Round of 32 slots (16 matches)
// R32-1 through R32-16
// Winners of each R32 match advance to R16

export interface ThirdPlaceMapping {
  /** Which R32 slot this third-place team goes into */
  [groupCode: string]: string; // e.g. "A" → "R32-3"
}

/**
 * The matrix mapping.
 * 
 * With 12-choose-8 = 495 possible combinations, FIFA will publish a
 * deterministic matrix. For now, we use a simplified default mapping
 * that covers the most likely scenarios.
 * 
 * The fallback assigns based on group proximity in the bracket.
 */
const MATRIX: Record<string, ThirdPlaceMapping> = {
  // This will be populated with all 495 combinations once FIFA publishes.
  // For now: default fallback mapping by group proximity.
};

/**
 * Default mapping when exact combination isn't in the matrix.
 * Maps each group's third-place team to a "natural" R32 slot.
 * This ensures the bracket always resolves, even before FIFA publishes.
 */
const DEFAULT_SLOT_ORDER: Record<string, string> = {
  "A": "R32-1",
  "B": "R32-2",
  "C": "R32-3",
  "D": "R32-4",
  "E": "R32-5",
  "F": "R32-6",
  "G": "R32-7",
  "H": "R32-8",
  "I": "R32-9",
  "J": "R32-10",
  "K": "R32-11",
  "L": "R32-12",
};

/**
 * Resolves third-place bracket mappings.
 * 
 * @param qualifyingGroups - sorted array of 8 group codes whose 3rd-place teams qualify
 * @returns mapping of group code to R32 slot
 */
export function resolveThirdPlaceSlots(
  qualifyingGroups: string[]
): ThirdPlaceMapping {
  const key = qualifyingGroups.sort().join("");

  // Check if exact combination is in the published matrix
  if (MATRIX[key]) {
    return MATRIX[key];
  }

  // Fallback: assign qualifying teams to their natural slots
  const mapping: ThirdPlaceMapping = {};
  for (const groupCode of qualifyingGroups) {
    mapping[groupCode] = DEFAULT_SLOT_ORDER[groupCode] || `R32-UNKNOWN`;
  }

  return mapping;
}

/**
 * Updates the matrix with new mappings.
 * Call this when FIFA publishes the official matrix.
 */
export function patchThirdPlaceMatrix(
  newMappings: Record<string, ThirdPlaceMapping>
): void {
  Object.assign(MATRIX, newMappings);
}

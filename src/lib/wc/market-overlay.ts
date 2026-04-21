/**
 * World Cup 2026 — Market Overlay Engine
 * Computes the gap between market-implied probabilities and model-adjusted state probabilities.
 * Tags gaps with actionable reason codes.
 */

export type ReasonCode =
  | "THIRD_PLACE_PATH_SHIFT"
  | "HIGH_TRAVEL_FATIGUE"
  | "ALTITUDE_TAX"
  | "SHORT_REST_WINDOW"
  | "CLIMATE_SWITCH"
  | "MARKET_NOT_PRICING_FORMAT"
  | "GROUP_DEATH_DISCOUNT"
  | "FAVORABLE_BRACKET_DRAW"
  | "HISTORICAL_OVERPERFORMANCE"
  | "SQUAD_AGE_RISK"
  | "NONE";

export interface MarketOverlayResult {
  teamId: string;
  teamName: string;
  marketProbability: number;     // from odds/market (0-1)
  modelProbability: number;      // from state engine (0-1)
  gap: number;                   // model - market (positive = undervalued by market)
  gapPct: number;                // gap as percentage
  reasonCodes: ReasonCode[];
  summary: string;
  direction: "BUY" | "SELL" | "HOLD";
}

export interface MarketInput {
  teamId: string;
  teamName: string;
  marketImpliedProbability: number; // 0-1
}

export interface ModelInput {
  teamId: string;
  standingPosition: number;
  thirdPlaceLadderRank: number | null;
  tfiScore: number;
  bracketDifficulty: number;
  groupStrength: number; // avg FIFA ranking of group opponents
  worldCupTitles: number;
}

const REASON_THRESHOLDS = {
  TFI_HIGH: 45,
  ALTITUDE_HIGH: 1500,
  REST_SHORT: 72,
  BRACKET_EASY: 0.4,
  GROUP_DEATH: 20, // avg FIFA ranking below this = group of death
};

/**
 * Compute model-adjusted probability from state engine inputs.
 * Simplified logistic regression proxy.
 */
function computeModelProbability(input: ModelInput): number {
  // Base probability from standing position
  let base = 0;
  if (input.standingPosition === 1) base = 0.85;
  else if (input.standingPosition === 2) base = 0.65;
  else if (input.standingPosition === 3) {
    if (input.thirdPlaceLadderRank !== null && input.thirdPlaceLadderRank <= 8) {
      base = 0.40;
    } else {
      base = 0.15;
    }
  } else {
    base = 0.05;
  }

  // TFI penalty
  const tfiPenalty = Math.min(input.tfiScore / 200, 0.15);

  // Bracket draw adjustment
  const bracketAdj = (1 - input.bracketDifficulty) * 0.1;

  // Historical bonus
  const histBonus = Math.min(input.worldCupTitles * 0.02, 0.10);

  const raw = base - tfiPenalty + bracketAdj + histBonus;
  return Math.max(0, Math.min(1, raw));
}

/**
 * Determine reason codes for a gap
 */
function determineReasonCodes(
  gap: number,
  model: ModelInput,
  tfiScore: number,
  altitudeM?: number,
  restHours?: number
): ReasonCode[] {
  const codes: ReasonCode[] = [];

  if (Math.abs(gap) < 0.03) {
    codes.push("NONE");
    return codes;
  }

  if (tfiScore >= REASON_THRESHOLDS.TFI_HIGH) {
    codes.push("HIGH_TRAVEL_FATIGUE");
  }
  if (altitudeM && altitudeM >= REASON_THRESHOLDS.ALTITUDE_HIGH) {
    codes.push("ALTITUDE_TAX");
  }
  if (restHours && restHours < REASON_THRESHOLDS.REST_SHORT) {
    codes.push("SHORT_REST_WINDOW");
  }
  if (model.thirdPlaceLadderRank !== null && model.standingPosition === 3) {
    codes.push("THIRD_PLACE_PATH_SHIFT");
  }
  if (model.bracketDifficulty < REASON_THRESHOLDS.BRACKET_EASY) {
    codes.push("FAVORABLE_BRACKET_DRAW");
  }
  if (model.groupStrength < REASON_THRESHOLDS.GROUP_DEATH) {
    codes.push("GROUP_DEATH_DISCOUNT");
  }
  if (model.worldCupTitles > 0 && gap > 0.05) {
    codes.push("HISTORICAL_OVERPERFORMANCE");
  }

  if (codes.length === 0) codes.push("MARKET_NOT_PRICING_FORMAT");
  return codes;
}

/**
 * Compute overlay for a batch of teams
 */
export function computeMarketOverlay(
  marketInputs: MarketInput[],
  modelInputs: ModelInput[],
  context?: {
    tfiScores?: Map<string, number>;
    altitudes?: Map<string, number>;
    restHours?: Map<string, number>;
  }
): MarketOverlayResult[] {
  const modelMap = new Map(modelInputs.map((m) => [m.teamId, m]));

  return marketInputs.map((market) => {
    const model = modelMap.get(market.teamId);
    if (!model) {
      return {
        teamId: market.teamId,
        teamName: market.teamName,
        marketProbability: market.marketImpliedProbability,
        modelProbability: 0,
        gap: -market.marketImpliedProbability,
        gapPct: -100,
        reasonCodes: ["NONE" as ReasonCode],
        summary: "No model data available.",
        direction: "HOLD" as const,
      };
    }

    const modelProb = computeModelProbability(model);
    const gap = modelProb - market.marketImpliedProbability;
    const gapPct = Math.round(gap * 10000) / 100;

    const tfiScore = context?.tfiScores?.get(market.teamId) || model.tfiScore;
    const altitude = context?.altitudes?.get(market.teamId);
    const restH = context?.restHours?.get(market.teamId);

    const reasonCodes = determineReasonCodes(gap, model, tfiScore, altitude, restH);

    let direction: "BUY" | "SELL" | "HOLD";
    if (gap > 0.05) direction = "BUY";
    else if (gap < -0.05) direction = "SELL";
    else direction = "HOLD";

    const summary = gap > 0.05
      ? `Market undervalues ${market.teamName} by ${Math.abs(gapPct).toFixed(1)}%. ${reasonCodes.filter(c => c !== "NONE").map(c => c.replace(/_/g, " ").toLowerCase()).join(", ")}.`
      : gap < -0.05
      ? `Market overvalues ${market.teamName} by ${Math.abs(gapPct).toFixed(1)}%. ${reasonCodes.filter(c => c !== "NONE").map(c => c.replace(/_/g, " ").toLowerCase()).join(", ")}.`
      : `${market.teamName} is fairly priced. No significant edge.`;

    return {
      teamId: market.teamId,
      teamName: market.teamName,
      marketProbability: market.marketImpliedProbability,
      modelProbability: Math.round(modelProb * 10000) / 10000,
      gap: Math.round(gap * 10000) / 10000,
      gapPct,
      reasonCodes,
      summary,
      direction,
    };
  });
}

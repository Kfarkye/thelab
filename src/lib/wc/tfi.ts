/**
 * World Cup 2026 — Travel Fatigue Index (TFI) Engine
 * Calculates logistical stress on a squad between matches.
 * Score range: 0 (optimal) to 100 (critical failure risk)
 */

export interface TFIInput {
  distanceKm: number;
  altitudeM: number;
  tempC: number;
  humidityPct: number;
  restHours: number;
  squadAvgAge: number;
}

export interface TFIConfig {
  altitudeCeiling: number;   // max altitude reference (default: 2240 = Azteca)
  altitudeExponent: number;  // steepness (default: 1.5)
  altitudeMaxTax: number;    // cap on altitude component (default: 45)
  tempBaseline: number;      // comfortable temp threshold (default: 24)
  tempMultiplier: number;    // per-degree penalty (default: 2)
  humidityBaseline: number;  // comfortable humidity (default: 60)
  humidityMultiplier: number;// per-pct penalty (default: 0.5)
  restCeiling: number;       // ideal rest hours (default: 120 = 5 days)
  restDivisor: number;       // rest penalty steepness (default: 2)
  travelPerThousandKm: number; // distance penalty (default: 4)
  ageBaseline: number;       // reference squad age (default: 26)
}

export const DEFAULT_TFI_CONFIG: TFIConfig = {
  altitudeCeiling: 2240,
  altitudeExponent: 1.5,
  altitudeMaxTax: 45,
  tempBaseline: 24,
  tempMultiplier: 2,
  humidityBaseline: 60,
  humidityMultiplier: 0.5,
  restCeiling: 120,
  restDivisor: 2,
  travelPerThousandKm: 4,
  ageBaseline: 26,
};

export type LogisticsWarningLevel = "low" | "moderate" | "high" | "critical";

export interface TFIResult {
  score: number;
  warningLevel: LogisticsWarningLevel;
  components: {
    altitudeTax: number;
    climateTax: number;
    restPenalty: number;
    travelTax: number;
    ageMultiplier: number;
  };
  explanation: string;
}

export function calculateTFI(
  input: TFIInput,
  config: TFIConfig = DEFAULT_TFI_CONFIG
): TFIResult {
  const { distanceKm, altitudeM, tempC, humidityPct, restHours, squadAvgAge } = input;

  // Altitude tax: exponential curve, capped
  const altitudeTax = Math.min(
    Math.pow(altitudeM / config.altitudeCeiling, config.altitudeExponent) * 30,
    config.altitudeMaxTax
  );

  // Climate tax: heat + humidity
  const heatTax = Math.max(0, (tempC - config.tempBaseline) * config.tempMultiplier);
  const humidityTax = Math.max(0, (humidityPct - config.humidityBaseline) * config.humidityMultiplier);
  const climateTax = heatTax + humidityTax;

  // Rest penalty: less rest = higher penalty
  const restPenalty = Math.max(0, (config.restCeiling - restHours) / config.restDivisor);

  // Travel tax: distance cost
  const travelTax = (distanceKm / 1000) * config.travelPerThousandKm;

  // Age multiplier: older squads pay more
  const ageMultiplier = squadAvgAge / config.ageBaseline;

  // Final TFI
  const rawScore = (altitudeTax + climateTax + restPenalty + travelTax) * ageMultiplier;
  const score = Math.round(Math.min(rawScore, 100) * 100) / 100;

  // Warning level
  let warningLevel: LogisticsWarningLevel;
  if (score >= 70) warningLevel = "critical";
  else if (score >= 45) warningLevel = "high";
  else if (score >= 25) warningLevel = "moderate";
  else warningLevel = "low";

  // Explanation
  const factors: string[] = [];
  if (altitudeTax > 10) factors.push(`altitude at ${altitudeM}m`);
  if (heatTax > 5) factors.push(`${tempC}°C heat`);
  if (humidityTax > 3) factors.push(`${humidityPct}% humidity`);
  if (restPenalty > 10) factors.push(`only ${Math.round(restHours)}h rest`);
  if (travelTax > 8) factors.push(`${Math.round(distanceKm)}km travel`);

  const explanation = factors.length === 0
    ? "Minimal logistical stress. No significant factors."
    : `Elevated stress from ${factors.join(", ")}. ${warningLevel === "critical" ? "Squad rotation strongly advised." : warningLevel === "high" ? "Recovery management recommended." : "Monitor squad load."}`;

  return {
    score,
    warningLevel,
    components: {
      altitudeTax: Math.round(altitudeTax * 100) / 100,
      climateTax: Math.round(climateTax * 100) / 100,
      restPenalty: Math.round(restPenalty * 100) / 100,
      travelTax: Math.round(travelTax * 100) / 100,
      ageMultiplier: Math.round(ageMultiplier * 100) / 100,
    },
    explanation,
  };
}

/**
 * Haversine distance between two lat/lng points in km
 */
export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

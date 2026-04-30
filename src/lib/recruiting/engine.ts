import type { CandidateObject, MatchObject, PackageObject } from "./types";

const SPECIALTY_MAP: Record<string, string> = {
  DIET: "Dietitian",
  DIETICIAN: "Dietitian",
  DIETITIAN: "Dietitian",
  "REG DIETITIAN": "Dietitian",
  "REGISTERED DIETITIAN": "Dietitian",
  CLINNUTRMAN: "Clinical Nutrition Manager",
  "CLIN NUTR MAN": "Clinical Nutrition Manager",
  "CLINICAL NUTRITION MANAGER": "Clinical Nutrition Manager",
  RT: "Respiratory Therapy",
  RRT: "Respiratory Therapy",
  "RESPIRATORY THERAPY": "Respiratory Therapy",
  "RESPIRATORY THERAPIST": "Respiratory Therapy",
};

export function normalizeSpecialty(input: string | null | undefined): string {
  const clean = String(input || "")
    .toUpperCase()
    .replace(/\(\d+\)/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  return SPECIALTY_MAP[clean] || clean;
}

export function getDistance(
  lat1: number | null | undefined,
  lng1: number | null | undefined,
  lat2: number | null | undefined,
  lng2: number | null | undefined,
): number | null {
  if (
    typeof lat1 !== "number" ||
    typeof lng1 !== "number" ||
    typeof lat2 !== "number" ||
    typeof lng2 !== "number" ||
    !Number.isFinite(lat1) ||
    !Number.isFinite(lng1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lng2)
  ) {
    return null;
  }

  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.7613;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sameState(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.trim().toUpperCase() === b.trim().toUpperCase());
}

function calculateDurationWeeks(startDate: string | null, endDate: string | null): number | null {
  if (!startDate || !endDate) return null;
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const days = Math.max(0, (end.getTime() - start.getTime()) / 86_400_000);
  return Math.round(days / 7);
}

export function calculateMatch(cand: CandidateObject, pkg: PackageObject): MatchObject {
  let score = 0;
  const reasons: string[] = [];
  const riskFlags: string[] = [];

  if (
    cand.normalized_specialty &&
    pkg.normalized_specialty &&
    cand.normalized_specialty === pkg.normalized_specialty
  ) {
    score += 40;
    reasons.push("Specialty match");
  } else {
    riskFlags.push(`Specialty mismatch: ${cand.specialty || "unknown"} vs ${pkg.specialty || "unknown"}`);
  }

  const distance = getDistance(
    cand.home_lat,
    cand.home_lng,
    pkg.location.lat,
    pkg.location.lng,
  );
  if (distance != null && distance <= 25) {
    score += 25;
    reasons.push(`Very local (${Math.round(distance)} miles)`);
  } else if (distance != null && distance <= 50) {
    score += 15;
    reasons.push(`Local (${Math.round(distance)} miles)`);
  } else if (sameState(cand.home_state, pkg.location.state)) {
    score += 10;
    reasons.push("Same state (approximate)");
  }

  if (pkg.start_date && cand.available_date && pkg.start_date >= cand.available_date) {
    score += 15;
    reasons.push("Available for start date");
  } else if (!cand.available_date) {
    riskFlags.push("Availability unknown");
  }

  if (pkg.location.state && !cand.license_states.includes(String(pkg.location.state).toUpperCase())) {
    riskFlags.push(`License for ${pkg.location.state} not confirmed`);
  }

  const pedsReq = pkg.requirements.some((requirement) =>
    requirement.toLowerCase().includes("peds"),
  );
  if (pedsReq) {
    riskFlags.push("Peds experience required (check profile)");
  }
  if (cand.bucket === "protected" || cand.bucket === "excluded") {
    riskFlags.push(`Candidate bucket: ${cand.bucket}`);
  }

  const matchBucket: MatchObject["match_bucket"] =
    score > 75
      ? "closest_qualified"
      : score > 50
        ? "qualified_nearby"
        : "needs_review";

  return {
    match_id: `AYA.MATCH.${cand.candidate_id}.${pkg.package_id}`,
    match_score: Math.min(100, score),
    match_bucket: matchBucket,
    distance_miles: distance,
    reasons,
    risk_flags: riskFlags,
  };
}

export const calculateRecruiterMatch = calculateMatch;

export function packageDurationWeeks(startDate: string | null, endDate: string | null): number | null {
  return calculateDurationWeeks(startDate, endDate);
}

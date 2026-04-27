import { SportsClaim } from "./types";

export type ClaimResolutionOutcome = "RESOLVED" | "CONFLICT" | "EMPTY";

export type ClaimResolution = {
  outcome: ClaimResolutionOutcome;
  winner: SportsClaim | null;
  shortlisted: SportsClaim[];
  stale: SportsClaim[];
  superseded: SportsClaim[];
  conflicts: SportsClaim[];
  reason: string;
};

function toEpochMs(value: string): number {
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function isActiveClaimStatus(status: string): boolean {
  const normalized = status.trim().toUpperCase();
  return normalized === "ACTIVE" || normalized === "VERIFIED";
}

function isClaimStale(claim: SportsClaim, nowMs: number): boolean {
  const staleAtMs = toEpochMs(claim.stale_at);
  if (!staleAtMs) return true;
  return staleAtMs <= nowMs;
}

function compareByPriorityAndTime(a: SportsClaim, b: SportsClaim): number {
  const priorityDiff = b.source_priority - a.source_priority;
  if (priorityDiff !== 0) return priorityDiff;
  return toEpochMs(b.observed_at) - toEpochMs(a.observed_at);
}

export function resolveClaimSet(
  claims: SportsClaim[],
  now: Date = new Date(),
): ClaimResolution {
  if (claims.length === 0) {
    return {
      outcome: "EMPTY",
      winner: null,
      shortlisted: [],
      stale: [],
      superseded: [],
      conflicts: [],
      reason: "No claims provided.",
    };
  }

  const nowMs = now.getTime();
  const activeClaims = claims.filter((claim) => isActiveClaimStatus(claim.status));
  const staleClaims = activeClaims.filter((claim) => isClaimStale(claim, nowMs));
  const freshClaims = activeClaims.filter((claim) => !isClaimStale(claim, nowMs));

  if (freshClaims.length === 0) {
    return {
      outcome: "EMPTY",
      winner: null,
      shortlisted: [],
      stale: staleClaims,
      superseded: [],
      conflicts: [],
      reason: "No fresh active claims remained after stale filtering.",
    };
  }

  const sorted = [...freshClaims].sort(compareByPriorityAndTime);
  const winner = sorted[0];
  const samePriority = sorted.filter((claim) => claim.source_priority === winner.source_priority);
  const samePriorityConflicts = samePriority.filter((claim) => claim.payload_hash !== winner.payload_hash);

  if (samePriorityConflicts.length > 0) {
    const conflicts = [winner, ...samePriorityConflicts].sort(compareByPriorityAndTime);
    return {
      outcome: "CONFLICT",
      winner: null,
      shortlisted: sorted,
      stale: staleClaims,
      superseded: [],
      conflicts,
      reason: "Top-priority claims disagree on payload hash.",
    };
  }

  const superseded = sorted.filter((claim) => claim.claim_id !== winner.claim_id);
  return {
    outcome: "RESOLVED",
    winner,
    shortlisted: sorted,
    stale: staleClaims,
    superseded,
    conflicts: [],
    reason: "Fresh claim selected by priority and observed_at.",
  };
}


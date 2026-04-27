export type CanonicalGameStatus = "SCHEDULED" | "LIVE" | "FINAL" | "POSTPONED";

const FINAL_STATUS_CODES = new Set([
  "F",
  "O",
  "FR",
  "FO",
  "FT",
  "FINAL",
  "FINAL/OT",
  "FINAL/SO",
  "COMPLETE",
  "COMPLETED",
  "CLOSED",
  "GAME_OVER",
  "POST",
]);

const LIVE_STATUS_CODES = new Set([
  "I",
  "IN",
  "LIVE",
  "STATUS_LIVE",
  "STATUS_IN",
  "STATUS_IN_PROGRESS",
  "IN_PROGRESS",
  "IN PROGRESS",
  "TOP",
  "BOT",
  "MIDDLE",
  "MID",
  "HALFTIME",
  "OVERTIME",
]);

const SCHEDULED_STATUS_CODES = new Set([
  "P",
  "S",
  "NS",
  "UPCOMING",
  "SCHEDULED",
  "PRE",
  "PRE-GAME",
  "PREGAME",
  "NOT_STARTED",
]);

const POSTPONED_STATUS_CODES = new Set([
  "PPD",
  "POSTPONED",
  "CANCELED",
  "CANCELLED",
  "SUSPENDED",
  "DELAYED",
]);

function normalizeStatusToken(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function normalizeMLBStatusCode(value: unknown): CanonicalGameStatus {
  const token = normalizeStatusToken(value);
  if (!token) return "SCHEDULED";

  const tokenWithoutStatusPrefix = token.replace(/^STATUS[_\s-]+/, "").trim();
  const tokenWithSpaces = token.replace(/[_-]+/g, " ").trim();
  const tokenCandidates = new Set([token, tokenWithoutStatusPrefix, tokenWithSpaces]);

  for (const candidate of tokenCandidates) {
    if (!candidate) continue;
    if (FINAL_STATUS_CODES.has(candidate)) return "FINAL";
    if (POSTPONED_STATUS_CODES.has(candidate)) return "POSTPONED";
    if (LIVE_STATUS_CODES.has(candidate)) return "LIVE";
    if (SCHEDULED_STATUS_CODES.has(candidate)) return "SCHEDULED";
  }

  if (
    token.includes("FINAL") ||
    token.includes("GAME OVER") ||
    token.includes("ENDED")
  ) {
    return "FINAL";
  }

  if (
    token.includes("POSTPONED") ||
    token.includes("CANCEL") ||
    token.includes("SUSPENDED") ||
    token.includes("DELAYED")
  ) {
    return "POSTPONED";
  }

  if (
    token.includes("IN PROGRESS") ||
    token.includes("STATUS_IN_PROGRESS") ||
    token === "IN" ||
    token.includes("LIVE") ||
    token.startsWith("TOP ") ||
    token.startsWith("BOT ") ||
    token.startsWith("BOTTOM ") ||
    token.startsWith("MID ")
  ) {
    return "LIVE";
  }

  return "SCHEDULED";
}

export function parseLiveLastUpdatedMs(livePayload: Record<string, unknown> | null): number | null {
  if (!livePayload) return null;
  const raw = livePayload.last_updated;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function isLivePayloadStale(
  livePayload: Record<string, unknown> | null,
  thresholdMs = 10 * 60 * 1000,
): boolean {
  const lastUpdated = parseLiveLastUpdatedMs(livePayload);
  if (!lastUpdated) return true;
  return Date.now() - lastUpdated > thresholdMs;
}

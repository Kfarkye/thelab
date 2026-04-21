export const PURSUIT_STATES = [
  "draft",
  "submitted",
  "reviewed",
  "interviewed",
  "offered",
  "prestart",
  "active",
  "completed",
  "rejected",
  "withdrawn",
  "cancelled",
  "terminated",
  "expired",
] as const;

export type PursuitState = (typeof PURSUIT_STATES)[number];

export const PURSUIT_STATUS_SOURCES = ["recruiter", "nova", "inferred"] as const;
export type PursuitStatusSource = (typeof PURSUIT_STATUS_SOURCES)[number];

export const PURSUIT_STATUS_SOURCE_PRIORITY: Record<PursuitStatusSource, number> = {
  recruiter: 3,
  nova: 2,
  inferred: 1,
};

export const PURSUIT_NEXT_ACTION_OWNERS = [
  "recruiter",
  "candidate",
  "facility",
  "system",
  "compliance",
  "unknown",
] as const;

export type PursuitNextActionOwner = (typeof PURSUIT_NEXT_ACTION_OWNERS)[number];

const TERMINAL_STATES = new Set<PursuitState>([
  "completed",
  "rejected",
  "withdrawn",
  "cancelled",
  "terminated",
  "expired",
]);

const LEGAL_TRANSITIONS: Record<PursuitState, ReadonlyArray<PursuitState>> = {
  draft: ["submitted", "withdrawn", "cancelled", "expired"],
  submitted: ["reviewed", "rejected", "withdrawn", "cancelled", "expired"],
  reviewed: ["interviewed", "offered", "rejected", "withdrawn", "cancelled", "expired"],
  interviewed: ["offered", "rejected", "withdrawn", "cancelled", "expired"],
  offered: ["prestart", "rejected", "withdrawn", "cancelled", "expired"],
  prestart: ["active", "cancelled", "withdrawn", "expired", "terminated"],
  active: ["completed", "terminated", "cancelled"],
  completed: [],
  rejected: [],
  withdrawn: [],
  cancelled: [],
  terminated: [],
  expired: [],
};

export const PURSUIT_REQUIRED_TIMESTAMP_FIELDS = [
  "submitted_at",
  "first_reviewed_at",
  "offered_at",
  "accepted_at",
  "started_at",
  "completed_at",
  "terminal_at",
] as const;

export function isValidPursuitState(value: unknown): value is PursuitState {
  return typeof value === "string" && (PURSUIT_STATES as readonly string[]).includes(value);
}

export function normalizePursuitState(value: unknown): PursuitState | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return isValidPursuitState(normalized) ? normalized : null;
}

export function isTerminalPursuitState(value: PursuitState): boolean {
  return TERMINAL_STATES.has(value);
}

export function canTransitionPursuitState(from: PursuitState, to: PursuitState): boolean {
  if (from === to) return true;
  return LEGAL_TRANSITIONS[from].includes(to);
}

export function assertPursuitTransition(from: PursuitState, to: PursuitState): void {
  if (!canTransitionPursuitState(from, to)) {
    throw new Error(`PURSUIT_STATE_TRANSITION_NOT_ALLOWED: '${from}' -> '${to}'`);
  }
}

export function normalizeNextActionOwner(value: unknown): PursuitNextActionOwner {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  return (PURSUIT_NEXT_ACTION_OWNERS as readonly string[]).includes(normalized)
    ? (normalized as PursuitNextActionOwner)
    : "unknown";
}

export function getPursuitLegalTransitions(): Record<PursuitState, ReadonlyArray<PursuitState>> {
  return LEGAL_TRANSITIONS;
}

export function normalizePursuitStatusSource(value: unknown): PursuitStatusSource {
  if (typeof value !== "string") return "inferred";
  const normalized = value.trim().toLowerCase();
  return (PURSUIT_STATUS_SOURCES as readonly string[]).includes(normalized)
    ? (normalized as PursuitStatusSource)
    : "inferred";
}

export function shouldAdoptStatusSource(
  currentSource: PursuitStatusSource,
  incomingSource: PursuitStatusSource,
): boolean {
  return PURSUIT_STATUS_SOURCE_PRIORITY[incomingSource] >= PURSUIT_STATUS_SOURCE_PRIORITY[currentSource];
}

export function shouldFlagPursuitStatusDrift(input: {
  status: PursuitState;
  statusSource: PursuitStatusSource;
  statusSetAt: string | Date | null | undefined;
  novaStatus: PursuitState | null | undefined;
  now?: Date;
}): boolean {
  const { status, statusSource, novaStatus } = input;
  if (!novaStatus) return false;
  if (statusSource !== "recruiter") return false;
  if (status === novaStatus) return false;

  const now = input.now || new Date();
  const setAt = input.statusSetAt instanceof Date ? input.statusSetAt : new Date(String(input.statusSetAt || ""));
  if (Number.isNaN(setAt.getTime())) return false;

  const ageMs = now.getTime() - setAt.getTime();
  return ageMs >= 72 * 60 * 60 * 1000;
}

export const PURSUIT_STATE_SEMANTICS = {
  reviewed: "Facility acknowledgment or documented human review event.",
  interviewed: "Structured interview event; can be skipped when flow goes reviewed -> offered.",
} as const;

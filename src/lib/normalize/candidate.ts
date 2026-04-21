// ── Specialty + status normalization ─────────────────────────────
// Server-side only. Maps raw DB values to canonical display values.
// Add entries here as new inconsistencies are discovered.

const SPECIALTY_CANONICAL: Record<string, string> = {
  "respiratory therapist": "Respiratory Therapy",
  "respiratory therapy": "Respiratory Therapy",
  "registered respiratory therapist": "Respiratory Therapy",
  "rrt": "Respiratory Therapy",
};

export function normalizeSpecialty(value?: string | null): string {
  if (!value) return "Unknown";
  const key = value.trim().toLowerCase();
  return SPECIALTY_CANONICAL[key] || value.trim();
}

const STATUS_CANONICAL: Record<string, string> = {
  "active": "On Assignment",
  "on_assignment": "On Assignment",
  "on assignment": "On Assignment",
  "pending_start": "Starting Soon",
  "pending start": "Starting Soon",
  "completed": "Wrapped Up",
  "cancelled": "Cancelled",
  "in_pipeline": "In Pipeline",
  "in pipeline": "In Pipeline",
};

export function normalizeAssignmentStatus(value?: string | null): string | undefined {
  if (!value) return undefined;
  const key = value.trim().toLowerCase();
  return STATUS_CANONICAL[key] || value.trim();
}

const COMPLIANCE_DISPLAY: Record<string, string> = {
  "high": "flagged",
  "medium": "review",
  "standard": undefined as unknown as string,
  "low": undefined as unknown as string,
};

export function normalizeComplianceRisk(value?: string | null): string | undefined {
  if (!value) return undefined;
  const key = value.trim().toLowerCase();
  if (key in COMPLIANCE_DISPLAY) return COMPLIANCE_DISPLAY[key] || undefined;
  return value.trim();
}

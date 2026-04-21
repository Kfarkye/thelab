// ── Canonical candidate record ──────────────────────────────────
// This is the single source of truth for every layer:
// DB row → mapCandidateRow → CandidateRecord → UI / Chat API

export interface CandidateRecord {
  id: string;
  name: string;
  specialty: string;              // canonicalized via normalizeSpecialty
  rawSpecialty?: string;          // original DB value for audit
  profession?: string;
  facilityName?: string;
  facilityCity?: string;
  facilityState?: string;
  assignmentStatus?: string;      // human-readable from DB ("Starting Soon", "On Assignment")
  derivedCurrentStatus?: string;  // date-computed reality ("On Assignment" if start < today < end)
  isStale?: boolean;              // true when DB status disagrees with date-derived status
  assignmentStart?: string;
  assignmentEnd?: string;
  homeState?: string;
  weeklyGross?: number;
  hourlyRate?: number;
  complianceRisk?: string;        // "flagged" | "review" | omitted
  source?: string;
  novaId?: string;
  novaUrl?: string;
  vmsPlatform?: string;
  facilityBeds?: number;
  rcThreadUrl?: string;
}

// ── Retrieval policy ────────────────────────────────────────────
// Sent alongside chat requests to control model grounding behavior

export interface RetrievalPolicy {
  source: "internal_candidate_record" | "web" | "default";
  webSearchAllowed: boolean;
}

export interface InternalContext {
  candidate?: CandidateRecord;
}

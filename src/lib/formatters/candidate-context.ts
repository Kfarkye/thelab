// ── Internal context formatter ──────────────────────────────────
// Server-side. Builds the grounding text injected into model context
// when the retrieval policy is "internal_candidate_record".

import type { CandidateRecord } from "@/lib/types/candidate";

export function formatCandidateContext(candidate: CandidateRecord): string {
  const payStr = candidate.weeklyGross
    ? `$${candidate.weeklyGross.toLocaleString()}/wk`
    : candidate.hourlyRate
      ? `$${candidate.hourlyRate}/hr`
      : "N/A";

  const facilityStr = candidate.facilityName
    ? `${candidate.facilityName}${candidate.facilityState ? `, ${candidate.facilityState}` : ""}`
    : "N/A";

  const dateStr =
    candidate.assignmentStart && candidate.assignmentEnd
      ? `${candidate.assignmentStart} to ${candidate.assignmentEnd}`
      : candidate.assignmentStart || "N/A";

  // Show both statuses when they differ (raw DB vs date-derived)
  const statusLine = candidate.derivedCurrentStatus &&
    candidate.derivedCurrentStatus !== candidate.assignmentStatus
    ? `${candidate.derivedCurrentStatus} (record shows: ${candidate.assignmentStatus})`
    : (candidate.derivedCurrentStatus || candidate.assignmentStatus || "N/A");

  const novaLine = candidate.novaUrl || "N/A";
  const rcThreadLine = candidate.rcThreadUrl || "N/A";

  return `INTERNAL DATA SOURCE: SECURE_CANDIDATE_RECORD
RESTRICTION: DO NOT USE EXTERNAL WEB SEARCH. USE ONLY THE FIELDS BELOW.

<CANDIDATE_DATA>
ID: ${candidate.id}
Name: ${candidate.name}
Specialty: ${candidate.specialty}
Home State: ${candidate.homeState ?? "N/A"}
Current Status: ${statusLine}
Facility: ${facilityStr}
Dates: ${dateStr}
Pay: ${payStr}
Compliance: ${candidate.complianceRisk ?? "standard"}
Nova Profile: ${novaLine}
RingCentral App Link: ${rcThreadLine}${candidate.isStale ? `\nALERT: STALE_RECORD — Status flag "${candidate.assignmentStatus}" does not match date-derived status "${candidate.derivedCurrentStatus}". Proactively mention this discrepancy.` : ""}
</CANDIDATE_DATA>

Rules:
- Summarize the candidate's current status based strictly on the data above.
- If Nova Profile is a URL, always include it as a clickable link in your response.
- If Current Status differs from the record status, explain why (e.g. "record shows Starting Soon but dates indicate currently on assignment").`;
}

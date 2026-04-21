// ── Candidate Resolver ───────────────────────────────────────────
// Wraps existing resolveCandidateIdentifier + loadCandidateSnapshotForIdentifier
// into the Hub response format with HATEOAS links.

import {
  resolveCandidateIdentifier,
  loadCandidateSnapshotForIdentifier,
  type CandidateResolveResult,
  type CandidateSnapshot,
} from "@/lib/ayaops/candidate-grounding-hub";
import { buildCandidateLinks } from "./links";

export type HubResponse = {
  type: string;
  id?: string;
  status: string;
  summary: string;
  novaUrl?: string;
  data: Record<string, unknown> | null;
  links: Record<string, unknown>;
  alternatives?: Array<{
    name: string;
    id: string;
    nova_id: string | null;
    status: string | null;
    specialty: string | null;
    confidence: number;
  }>;
};

function buildNovaUrl(novaId: string | null): string | null {
  if (!novaId) return null;
  return `https://nova.ayahealthcare.com/#/recruiting/candidates/${novaId}/new-profile/about`;
}

function buildSummary(snapshot: CandidateSnapshot): string {
  const parts: string[] = [snapshot.display_name];
  if (snapshot.specialty_title) parts.push(snapshot.specialty_title);

  const status = snapshot.assignment?.status || "Unknown";
  parts.push(`Status: ${status}`);

  if (snapshot.assignment?.facility_name) {
    const loc = [snapshot.assignment.facility_city, snapshot.assignment.facility_state]
      .filter(Boolean)
      .join(", ");
    parts.push(`${snapshot.assignment.facility_name}${loc ? ` (${loc})` : ""}`);
  } else if (snapshot.addresses?.home) {
    parts.push(snapshot.addresses.home);
  }

  return parts.join(" | ");
}

export async function resolveCandidate(identifier: string): Promise<HubResponse> {
  const sourceUrl = `/api/hub/candidates/${encodeURIComponent(identifier)}`;

  // Use the existing resolution engine
  const { resolution, snapshot } = await loadCandidateSnapshotForIdentifier(identifier, sourceUrl);

  if (resolution.status === "not_found") {
    return {
      type: "candidate",
      status: "not_found",
      summary: resolution.message || `No candidate matched "${identifier}".`,
      data: null,
      links: {},
    };
  }

  if (resolution.status === "ambiguous") {
    return {
      type: "candidate",
      status: "ambiguous",
      summary: resolution.message || `Multiple candidates matched "${identifier}". Please clarify.`,
      data: null,
      links: {},
      alternatives: resolution.candidates.map((c) => ({
        name: c.display_name,
        id: c.candidate_id,
        nova_id: c.nova_id,
        status: c.assignment_status,
        specialty: c.specialty,
        confidence: c.confidence,
      })),
    };
  }

  // Status: resolved
  if (!snapshot) {
    return {
      type: "candidate",
      status: "error",
      summary: `Resolved "${identifier}" but snapshot failed to load.`,
      data: null,
      links: {},
    };
  }

  const novaUrl = buildNovaUrl(
    snapshot.candidate_id && /^\d+$/.test(snapshot.candidate_id)
      ? snapshot.candidate_id
      : null
  ) || snapshot.profile_url;

  const candidateId = snapshot.internal_candidate_uuid;

  return {
    type: "candidate",
    id: candidateId,
    status: "resolved",
    summary: buildSummary(snapshot),
    novaUrl: novaUrl || undefined,
    data: {
      internal_id: candidateId,
      nova_id: snapshot.candidate_id,
      display_name: snapshot.display_name,
      specialty: snapshot.specialty_title,
      profession: snapshot.employment_type,
      contact: snapshot.contact,
      addresses: snapshot.addresses,
      job_desires: snapshot.job_desires,
      team_info: snapshot.team_info,
      assignment: snapshot.assignment,
      latest_submittal: snapshot.latest_submittal,
      profile_status_tags: snapshot.profile_status_tags,
      match_reason: resolution.match_reason,
      confidence: resolution.confidence,
    },
    links: buildCandidateLinks(candidateId, snapshot.candidate_id, novaUrl),
  };
}

import { NextRequest, NextResponse } from "next/server";
import {
  loadCandidateSnapshotForIdentifier,
  resolveBaseUrlFromHeaders,
} from "@/lib/ayaops/candidate-grounding-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreJson(body: unknown, status: number = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0, must-revalidate",
    },
  });
}

function buildGroundingText(snapshot: Record<string, any>, actionUrl: string): string {
  return [
    "CANDIDATE_PROFILE",
    `Candidate ID: ${String(snapshot.candidate_id || "")}`,
    `Display Name: ${String(snapshot.display_name || "Unknown Candidate")}`,
    `Nova Profile: ${String(snapshot.profile_url || "none")}`,
    `Specialty: ${String(snapshot.specialty_title || "unknown")}`,
    `Current Status: ${String(snapshot.assignment?.status || "unknown")}`,
    `Current Facility: ${String(snapshot.assignment?.facility_name || "unknown")}`,
    `Direct Link: ${actionUrl}`,
  ].join("\n");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> },
) {
  const resolvedParams = await params;
  const identifier = String(resolvedParams.identifier || "").trim();
  if (!identifier) {
    return noStoreJson(
      {
        ok: false,
        error_code: "MISSING_IDENTIFIER",
        message: "Candidate identifier is required.",
      },
      400,
    );
  }

  const baseUrl = resolveBaseUrlFromHeaders(request.headers);
  const sourceUrl = baseUrl
    ? `${baseUrl}/api/grounding/c/${encodeURIComponent(identifier)}`
    : `/api/grounding/c/${encodeURIComponent(identifier)}`;
  const searchUrl = baseUrl
    ? `${baseUrl}/api/grounding/search?q=${encodeURIComponent(identifier)}`
    : `/api/grounding/search?q=${encodeURIComponent(identifier)}`;

  const { resolution, snapshot } = await loadCandidateSnapshotForIdentifier(identifier, sourceUrl);

  if (resolution.status === "not_found" || !snapshot) {
    return noStoreJson(
      {
        ok: false,
        error_code: "CANDIDATE_NOT_FOUND",
        message: resolution.message,
        query: identifier,
        candidates: resolution.candidates,
        search_url: searchUrl,
      },
      404,
    );
  }

  if (resolution.status === "ambiguous") {
    return noStoreJson(
      {
        ok: false,
        error_code: "AMBIGUOUS_CANDIDATE",
        message: resolution.message,
        query: identifier,
        candidates: resolution.candidates,
        search_url: searchUrl,
      },
      409,
    );
  }

  const actionUrl = baseUrl
    ? `${baseUrl}/c/${encodeURIComponent(snapshot.internal_candidate_uuid)}`
    : `/c/${encodeURIComponent(snapshot.internal_candidate_uuid)}`;

  return noStoreJson({
    ok: true,
    query: identifier,
    source_url: sourceUrl,
    action_url: actionUrl,
    resolved_identifier: {
      candidate_id: resolution.candidate_id,
      nova_id: resolution.nova_id,
      display_name: resolution.display_name,
      match_reason: resolution.match_reason,
      confidence: resolution.confidence,
    },
    candidate: snapshot,
    grounding_text: buildGroundingText(snapshot as unknown as Record<string, any>, actionUrl),
  });
}


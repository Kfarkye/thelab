import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/middleware/auth";
import { parseRecruiterIntent } from "@/lib/recruiting/intent";
import {
  askCandidatesForChat,
  emitRecruitingEvent,
  type RecruiterCandidateCard,
} from "@/lib/recruiting/queryAgent";

export const runtime = "nodejs";

const requestSchema = z.object({
  input: z.string().trim().min(1).max(500),
  conversation_id: z.string().trim().min(1).max(128).nullable().optional(),
});

const actorWindows = new Map<string, number[]>();

type EmptyReason = "likely_data_gap" | "over_filtered" | "unknown";

function rateLimit(actorId: string): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  const recent = (actorWindows.get(actorId) || []).filter((entry) => entry >= windowStart);
  if (recent.length >= 30) {
    actorWindows.set(actorId, recent);
    return false;
  }
  recent.push(now);
  actorWindows.set(actorId, recent);
  return true;
}

function jsonError(code: string, status: number): Response {
  return NextResponse.json({ error: { code } }, { status });
}

function locationLabel(candidate: RecruiterCandidateCard): string | null {
  const parts = [candidate.location.city, candidate.location.state].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

function summarizeCandidates(input: {
  candidates: RecruiterCandidateCard[];
  specialty: string | null;
  locationText: string | null;
  missingNovaIdCount: number;
}): string {
  const { candidates, specialty, locationText, missingNovaIdCount } = input;
  if (candidates.length === 0) return "No matching candidates found in the current recruiter book.";
  const subject = specialty || "candidates";
  const place = locationText ? ` near ${locationText}` : "";
  const profileText = missingNovaIdCount === 0
    ? "all have profile links"
    : `${missingNovaIdCount} missing profile link${missingNovaIdCount === 1 ? "" : "s"}`;
  return `Found ${candidates.length} ${subject}${place}, ${profileText}.`;
}

function inferEmptyReason(input: {
  resultCount: number;
  specialty: string | null;
  requiresLocation: boolean;
}): EmptyReason | undefined {
  if (input.resultCount > 0) return undefined;
  const specialty = (input.specialty || "").toLowerCase();
  if (/\bpt\b|\bot\b|physical therapist|occupational therapist/.test(specialty)) {
    return "likely_data_gap";
  }
  return input.requiresLocation ? "over_filtered" : "unknown";
}

function suggestedNextSearches(specialty: string | null, emptyReason: EmptyReason | undefined): string[] {
  if (!emptyReason) return [];
  if (emptyReason === "over_filtered") {
    return [
      specialty ? `${specialty} candidates without a location filter` : "Active candidates without a location filter",
      "Active RN candidates",
    ];
  }
  if (emptyReason === "likely_data_gap") {
    return ["Active RN candidates", "Respiratory therapist candidates", "Dietitians in Sacramento"];
  }
  return ["Active RN candidates", "Dietitians in Sacramento"];
}

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await requireAuth(request);
  if (auth.response) return auth.response;

  const actorId = auth.user.email || auth.user.uid;
  if (!rateLimit(actorId)) return jsonError("RATE_LIMITED", 429);

  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return jsonError("INVALID_REQUEST", 400);

    const conversationId = parsed.data.conversation_id || randomUUID();
    const intent = await parseRecruiterIntent(parsed.data.input);
    const result = await askCandidatesForChat(intent, auth.user);
    const missingNovaIdCandidates = result.candidates.filter((candidate) => !candidate.nova_url);
    const coordinatedMissingNovaIdCandidates = missingNovaIdCandidates.filter((candidate) => candidate.has_coordinates);
    const missingNovaIdCount = missingNovaIdCandidates.length;
    const warningCount = result.candidates.reduce((count, candidate) => count + candidate.warnings.length, 0);
    const emptyReason = inferEmptyReason({
      resultCount: result.candidates.length,
      specialty: intent.specialty,
      requiresLocation: intent.requires_location,
    });

    await emitRecruitingEvent({
      actorId,
      eventName: "AYA.EVT.CANDIDATE_SEARCH",
      payload: {
        conversation_id: conversationId,
        query_id: result.queryId,
        raw_query: intent.raw_query,
        specialty: intent.specialty,
        location_text: intent.location_text,
        result_count: result.candidates.length,
        empty_reason: emptyReason || null,
      },
      resultCount: result.candidates.length,
      latencyMs: result.latencyMs,
    });

    await Promise.all(coordinatedMissingNovaIdCandidates.map((candidate) => emitRecruitingEvent({
      actorId,
      eventName: "AYA.EVT.DATA_QUALITY.MISSING_NOVA_ID",
      payload: {
        conversation_id: conversationId,
        query_id: result.queryId,
        candidate_id: candidate.candidate_id,
        candidate_name: candidate.candidate_name,
        location: locationLabel(candidate),
      },
      resultCount: 0,
      latencyMs: 0,
    })));

    return NextResponse.json({
      conversation_id: conversationId,
      summary: summarizeCandidates({
        candidates: result.candidates,
        specialty: intent.specialty,
        locationText: intent.location_text,
        missingNovaIdCount,
      }),
      candidates: result.candidates,
      empty_reason: emptyReason,
      suggested_next_searches: suggestedNextSearches(intent.specialty, emptyReason),
      diagnostics: {
        warning_count: warningCount,
        missing_nova_id_count: missingNovaIdCount,
      },
    });
  } catch (error) {
    console.error(JSON.stringify({
      severity: "ERROR",
      component: "recruiting_chat",
      event: "chat_query_failed",
      actor_id: actorId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return jsonError("CHAT_QUERY_FAILED", 500);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import { parseRecruiterNote } from "@/lib/recruiting/intake";
import { calculateRecruiterMatch, findQualifiedNearby } from "@/lib/recruiting/matcher";
import { loadCandidatePool, packageFromUnknown } from "@/lib/recruiting/store";
import type { CandidateMatchResult } from "@/lib/recruiting/types";

export const runtime = "nodejs";

function readString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.trunc(parsed), 50));
}

export async function POST(request: NextRequest): Promise<Response> {
  const { response } = await requireAuth(request);
  if (response) return response;

  try {
    const body = await request.json();
    const packageId = readString(body.packageId || body.package_id);
    const searchQuery = readString(body.searchQuery || body.search_query);
    const recruiterNote = readString(body.note || body.recruiterNote || body.text);

    if (packageId && (searchQuery || recruiterNote)) {
      const parsed = searchQuery
        ? { searchQuery, reasoning: "Search query provided by request." }
        : await parseRecruiterNote(recruiterNote);
      const matches = await findQualifiedNearby(
        packageId,
        parsed.searchQuery,
        readLimit(body.limit || body.resultLimit, 10),
      );

      return NextResponse.json({
        ok: true,
        source: "spanner_search",
        packageId,
        searchQuery: parsed.searchQuery,
        reasoning: parsed.reasoning,
        matches,
        count: matches.length,
      });
    }

    const pkg = packageFromUnknown(body.package || body.selectedPackage || body);
    const candidates = await loadCandidatePool({
      normalizedSpecialty: pkg.normalized_specialty,
      state: pkg.location.state,
      limit: readLimit(body.limit, 200),
    });

    const matches: CandidateMatchResult[] = candidates
      .map((candidate) => ({
        ...calculateRecruiterMatch(candidate, pkg),
        candidate,
      }))
      .filter((match) => match.match_score > 0 || match.risk_flags.length > 0)
      .sort((a, b) => {
        if (b.match_score !== a.match_score) return b.match_score - a.match_score;
        return a.candidate.candidate_name.localeCompare(b.candidate.candidate_name);
      })
      .slice(0, readLimit(body.resultLimit, 10));

    return NextResponse.json({
      ok: true,
      package: pkg,
      matches,
      count: matches.length,
    });
  } catch (error) {
    console.error("Recruiting match failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to match candidates." },
      { status: 500 },
    );
  }
}

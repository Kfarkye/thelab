import { NextRequest, NextResponse } from "next/server";
import {
  resolveBaseUrlFromHeaders,
  searchCandidateGrounding,
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

export async function GET(request: NextRequest) {
  const q = String(request.nextUrl.searchParams.get("q") || "").trim();
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") || 5);
  const limit = Math.min(Math.max(Math.trunc(Number.isFinite(requestedLimit) ? requestedLimit : 5), 1), 10);

  if (!q) {
    return noStoreJson(
      {
        ok: false,
        error_code: "MISSING_QUERY",
        message: "Query parameter q is required.",
      },
      400,
    );
  }

  const baseUrl = resolveBaseUrlFromHeaders(request.headers);
  const results = await searchCandidateGrounding(q, baseUrl, limit);

  return noStoreJson({
    ok: true,
    query: q,
    count: results.length,
    results,
  });
}


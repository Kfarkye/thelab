import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import { runPickGradingSweep } from "@/lib/sports/picks-ledger";

export const runtime = "nodejs";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 200;
  return Math.max(10, Math.min(1000, Math.trunc(parsed)));
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  const { response } = await requireAuth(request);
  if (response) return response;

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

  try {
    const result = await runPickGradingSweep(limit);
    return NextResponse.json(
      {
        status: "ok",
        ...result,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0, must-revalidate",
          "x-request-id": requestId,
        },
      },
    );
  } catch (error) {
    console.error("[picks-grade-cron] failed", {
      limit,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: "Failed to grade picks." },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0, must-revalidate",
          "x-request-id": requestId,
        },
      },
    );
  }
}

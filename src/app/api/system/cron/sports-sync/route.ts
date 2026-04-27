import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import { runSportsSync } from "@/app/api/sports-sync/route";

export const runtime = "nodejs";
export const maxDuration = 240;

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const { response } = await requireAuth(request);
  if (response) return response;

  const body = await request.json().catch(() => ({}));

  try {
    const result = await runSportsSync(body);
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store, max-age=0, must-revalidate",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    console.error("[sports-sync-cron] failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: "Failed to execute sports sync cron." },
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

export async function GET() {
  return NextResponse.json({
    status: "ready",
    endpoint: "POST /api/system/cron/sports-sync",
    auth: "Bearer Firebase ID token or Cloud Scheduler OIDC token",
    note: "Scheduler-safe wrapper for /api/sports-sync",
  });
}

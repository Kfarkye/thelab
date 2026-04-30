import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/middleware/auth";
import { askCandidates } from "@/lib/recruiting/queryAgent";

export const runtime = "nodejs";

const requestSchema = z.object({
  input: z.string().trim().min(1).max(500),
});

const actorWindows = new Map<string, number[]>();

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

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await requireAuth(request);
  if (auth.response) return auth.response;

  const actorId = auth.user.email || auth.user.uid;
  if (!rateLimit(actorId)) return jsonError("RATE_LIMITED", 429);

  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return jsonError("INVALID_REQUEST", 400);

    const result = await askCandidates(parsed.data.input, auth.user);
    return NextResponse.json({
      matches: result.matches,
      queryId: result.queryId,
      latencyMs: result.latencyMs,
    });
  } catch (error) {
    console.error(JSON.stringify({
      severity: "ERROR",
      component: "recruiting_ask",
      event: "query_failed",
      actor_id: actorId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return jsonError("QUERY_FAILED", 500);
  }
}

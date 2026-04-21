import { NextRequest } from "next/server";
import { stopLiveEmitSession } from "@/lib/live-emit/session-store";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    session_id?: string;
    sessionId?: string;
    session_token?: string;
    sessionToken?: string;
  };
  const sessionId = String(body.session_id || body.sessionId || "").trim();
  const sessionToken = String(body.session_token || body.sessionToken || "").trim();
  if (!sessionId) {
    return new Response(JSON.stringify({ error: "session_id is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!sessionToken) {
    return new Response(JSON.stringify({ error: "session_token is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stopped = stopLiveEmitSession(sessionId, sessionToken);
  return new Response(JSON.stringify({ stopped, session_id: sessionId }), {
    headers: { "Content-Type": "application/json" },
  });
}

import { NextRequest } from "next/server";
import { getLiveEmitSession } from "@/lib/live-emit/session-store";

type ValidateBody = {
  session_id?: string;
  sessionId?: string;
  session_token?: string;
  sessionToken?: string;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as ValidateBody;
  const sessionId = String(body.session_id || body.sessionId || "").trim();
  const sessionToken = String(body.session_token || body.sessionToken || "").trim();

  if (!sessionId || !sessionToken) {
    return new Response(
      JSON.stringify({
        valid: false,
        error: "session_id and session_token are required",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const session = getLiveEmitSession(sessionId, sessionToken);
  if (!session) {
    return new Response(JSON.stringify({ valid: false, error: "invalid_or_expired_session" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      valid: true,
      session_id: session.id,
      mode: session.mode,
      expires_at: new Date(session.expiresAt).toISOString(),
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}

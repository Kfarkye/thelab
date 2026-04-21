import { NextRequest } from "next/server";
import { getLiveEmitSystemInstruction } from "@/lib/live-emit/system-instruction";
import { createLiveEmitSession, getMaxLiveEmitRuntimeMs } from "@/lib/live-emit/session-store";
import type { LiveEmitSessionConfig } from "@/lib/live-emit/types";

const DEFAULT_MODEL = process.env.GEMINI_LIVE_EMIT_MODEL || "gemini-3.1-pro-preview";
const LIVE_EMIT_WS_URL = (process.env.LIVE_EMIT_WS_URL || "").trim();

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode") || "code";
  const session = createLiveEmitSession(mode);
  const payload: LiveEmitSessionConfig = {
    provider: "vertex",
    model: DEFAULT_MODEL,
    websocket_url: LIVE_EMIT_WS_URL || null,
    sse_url: "/api/live-emit/stream",
    default_thinking_level: "HIGH",
    allowed_thinking_levels: ["LOW", "MEDIUM", "HIGH"],
    thinking_parameter: "thinking_level",
    include_thoughts_supported: true,
    system_instruction_sample: getLiveEmitSystemInstruction(mode),
    session_id: session.id,
    session_token: session.token,
    expires_at: new Date(session.expiresAt).toISOString(),
    max_runtime_ms: getMaxLiveEmitRuntimeMs(),
  };

  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

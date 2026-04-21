/**
 * WebSocket upgrades are served by a dedicated runtime service in production.
 * Next.js route handlers cannot reliably terminate long-lived WS upgrade sessions
 * on all hosting targets. This endpoint documents the expected handoff.
 */
export async function GET() {
  return new Response(
    JSON.stringify({
      error: "WEBSOCKET_UPGRADE_NOT_SUPPORTED_HERE",
      message:
        "Use LIVE_EMIT_WS_URL for direct WebSocket transport (with session_id + session_token validated by /api/live-emit/session/validate), or /api/live-emit/stream for server-stream fallback.",
      websocket_url: process.env.LIVE_EMIT_WS_URL || null,
      fallback_sse_url: "/api/live-emit/stream",
      session_validate_url: "/api/live-emit/session/validate",
    }),
    {
      status: 426,
      headers: { "Content-Type": "application/json" },
    },
  );
}

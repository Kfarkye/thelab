import { NextRequest } from "next/server";
import { GeminiStreamManager } from "@/lib/live-emit/gemini-stream-manager";
import type { LiveEmitStartRequest } from "@/lib/live-emit/types";
import { getLiveEmitSession, getMaxLiveEmitRuntimeMs } from "@/lib/live-emit/session-store";

const manager = new GeminiStreamManager();

function readPrompt(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const prompt = (input as Record<string, unknown>).prompt;
  return typeof prompt === "string" ? prompt.trim() : "";
}

const LIVE_EMIT_MODES = new Set<NonNullable<LiveEmitStartRequest["mode"]>>([
  "healthcare",
  "sports",
  "code",
  "worldcup",
  "ayaops",
]);

function resolveLiveEmitMode(bodyMode: LiveEmitStartRequest["mode"], sessionMode: string): NonNullable<LiveEmitStartRequest["mode"]> {
  if (bodyMode && LIVE_EMIT_MODES.has(bodyMode)) return bodyMode;
  if (LIVE_EMIT_MODES.has(sessionMode as NonNullable<LiveEmitStartRequest["mode"]>)) {
    return sessionMode as NonNullable<LiveEmitStartRequest["mode"]>;
  }
  return "code";
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as LiveEmitStartRequest;
  const prompt = readPrompt(body);
  const sessionId = String(body.sessionId || "").trim();
  const sessionToken = String(body.sessionToken || "").trim();
  if (!sessionId) {
    return new Response(JSON.stringify({ error: "sessionId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!sessionToken) {
    return new Response(JSON.stringify({ error: "sessionToken is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const session = getLiveEmitSession(sessionId, sessionToken);
  if (!session) {
    return new Response(JSON.stringify({ error: "invalid_or_expired_session" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!prompt) {
    return new Response(JSON.stringify({ error: "prompt is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const resolvedMode = resolveLiveEmitMode(body.mode, session.mode);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      try {
        await manager.stream({
          prompt,
          mode: resolvedMode,
          thinkingLevel: body.thinkingLevel,
          includeThoughts: body.includeThoughts,
          sessionId: session.id,
          maxRuntimeMs: getMaxLiveEmitRuntimeMs(),
          lastAckSequence:
            typeof body.lastAckSequence === "number" && Number.isFinite(body.lastAckSequence)
              ? body.lastAckSequence
              : undefined,
          signal: request.signal,
          onPacket: (packet) => emit(packet as unknown as Record<string, unknown>),
        });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (error) {
        const message = error instanceof Error ? error.message : "live_emit_failed";
        const baseSequence =
          typeof body.lastAckSequence === "number" && Number.isFinite(body.lastAckSequence)
            ? Math.max(0, Math.trunc(body.lastAckSequence))
            : 0;
        emit({
          id: `err_${Date.now()}`,
          session_id: session.id,
          sequence: baseSequence + 1,
          type: "VETO_SIGNAL",
          payload: {
            componentName: "LiveEmitStatus",
            props: { level: "High", reason: message },
            timestamp: Date.now(),
          },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

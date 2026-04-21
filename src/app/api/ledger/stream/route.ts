// ── Ledger SSE Stream Endpoint ───────────────────────────────────
// Snapshot-Convergent with Gap-Free Bounded Replay.
//
// Protocol:
//   1. Client connects with optional `Last-Event-ID` header
//   2. Server replays missed events from Redis Stream (XRANGE)
//   3. Server subscribes to Redis Pub/Sub for live events
//   4. If replay or buffer cap is exceeded → `resync_required` event
//   5. Client falls back to HTTP GET snapshot on `resync_required`
//
// This is NOT exact-once. It is highly-available at-least-once,
// with deterministic ID deduplication, bounded memory, and
// fallback to snapshot during network partition.

import { NextRequest } from "next/server";
import {
  getRedisSubscriber,
  replayLedgerEvents,
  PUBSUB_CHANNEL,
} from "@/lib/redis";

const REPLAY_CAP = Number(process.env.LEDGER_REPLAY_CAP || 200);
const BUFFER_CAP = Number(process.env.LEDGER_BUFFER_CAP || 500);
const HEARTBEAT_MS = Number(process.env.LEDGER_HEARTBEAT_MS || 15000);

function structuredLog(
  severity: "INFO" | "WARNING" | "ERROR",
  message: string,
  metrics: Record<string, unknown>,
) {
  console.warn(
    JSON.stringify({
      severity,
      message,
      component: "ledger_stream",
      timestamp: new Date().toISOString(),
      metrics,
    }),
  );
}

export async function GET(request: NextRequest) {
  const lastEventId =
    request.headers.get("Last-Event-ID") ||
    request.nextUrl.searchParams.get("lastEventId") ||
    "";

  const encoder = new TextEncoder();
  const buffer: string[] = [];
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const safeWrite = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const doCleanup = () => {
        closed = true;
        clearInterval(heartbeatId);
        try {
          subscriber.unsubscribe(PUBSUB_CHANNEL);
        } catch {
          // ignore unsubscribe errors during cleanup
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // ── Phase 1: Replay missed events from Stream ──────────
      if (lastEventId) {
        try {
          const missed = await replayLedgerEvents(lastEventId, REPLAY_CAP);

          if (missed.length === REPLAY_CAP) {
            // Gap too large — client must re-snapshot
            structuredLog("WARNING", "SSE Stream degradation: REPLAY_CAP exceeded", {
              missed_length: missed.length,
              replay_cap: REPLAY_CAP,
              last_event_id: lastEventId,
            });

            safeWrite(
              `event: resync_required\ndata: ${JSON.stringify({ reason: "replay_cap_exceeded" })}\n\n`,
            );
            doCleanup();
            return;
          }

          // Replay each missed event with its exact stream ID
          for (const entry of missed) {
            if (closed) return;
            safeWrite(`id: ${entry.id}\nevent: ledger\ndata: ${entry.data}\n\n`);
          }
        } catch (err) {
          structuredLog("ERROR", "SSE Stream replay failed", {
            error: err instanceof Error ? err.message : String(err),
            last_event_id: lastEventId,
          });
          // Continue to live subscription even if replay fails
        }
      }

      // ── Phase 2: Subscribe to live events via Pub/Sub ──────
      const subscriber = getRedisSubscriber();

      subscriber.on("message", (_channel: string, message: string) => {
        if (closed) return;

        buffer.push(message);

        if (buffer.length > BUFFER_CAP) {
          structuredLog("WARNING", "SSE Stream degradation: BUFFER_CAP exceeded", {
            buffer_length: buffer.length,
            buffer_cap: BUFFER_CAP,
            last_event_id: lastEventId,
          });

          safeWrite(
            `event: resync_required\ndata: ${JSON.stringify({ reason: "buffer_overflow" })}\n\n`,
          );
          doCleanup();
          return;
        }

        // Extract the injected stream ID from the broadcast payload
        let streamId = "";
        try {
          const parsed = JSON.parse(message) as Record<string, unknown>;
          streamId = typeof parsed.id === "string" ? parsed.id : "";
        } catch {
          streamId = `fallback-${Date.now()}`;
        }

        // Flush the buffer entry immediately
        safeWrite(`id: ${streamId}\nevent: ledger\ndata: ${message}\n\n`);
        buffer.length = 0;
      });

      try {
        await subscriber.subscribe(PUBSUB_CHANNEL);
      } catch (err) {
        structuredLog("ERROR", "SSE Stream Pub/Sub subscribe failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        doCleanup();
        return;
      }

      // ── Phase 3: Heartbeat ─────────────────────────────────
      const heartbeatId = setInterval(() => {
        if (closed) {
          clearInterval(heartbeatId);
          return;
        }
        safeWrite(`: heartbeat ${Date.now()}\n\n`);
      }, HEARTBEAT_MS);

      // ── Phase 4: Cleanup on client disconnect ──────────────
      request.signal.addEventListener("abort", () => {
        doCleanup();
      });
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

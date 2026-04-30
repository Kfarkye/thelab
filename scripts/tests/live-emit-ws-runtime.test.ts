import test, { after } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import type { RawData } from "ws";
import { startLiveEmitWsRuntime } from "@/live-emit-ws/runtime";
import { closeAllDbs } from "@/lib/spanner-pool";
import {
  INITIAL_LIVE_EMIT_STATE,
  mergeLiveEmitPacket,
  shouldAcceptPacket,
} from "@/lib/live-emit/client-runtime";
import { coerceLiveEmitPacket } from "@/lib/live-emit/types";

type StreamCall = {
  sessionId: string;
  lastAckSequence?: number;
  signal?: AbortSignal;
};

const openSockets = new Set<WebSocket>();

after(async () => {
  for (const ws of openSockets) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.terminate();
    }
  }
  openSockets.clear();
  await closeAllDbs();
});

function withTimeout<T>(promise: Promise<T>, label: string, ms = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function connectSocket(url: string): Promise<WebSocket> {
  return withTimeout(
    new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      openSockets.add(ws);
      ws.once("close", () => openSockets.delete(ws));
      ws.once("open", () => resolve(ws));
      ws.once("error", reject);
    }),
    "ws_connect",
  );
}

function waitForMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return withTimeout(
    new Promise((resolve, reject) => {
      ws.once("message", (raw) => {
        try {
          const parsed = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
          resolve(parsed);
        } catch (error) {
          reject(error);
        }
      });
      ws.once("error", reject);
    }),
    "ws_message",
  );
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return withTimeout(
    new Promise((resolve) => {
      ws.once("close", (code, reason) => {
        resolve({ code, reason: reason.toString("utf8") });
      });
    }),
    "ws_close",
  );
}

async function closeRuntime(runtime: { close: () => Promise<void> }) {
  await withTimeout(runtime.close(), "ws_runtime_close", 6000);
}

test("health and version endpoints respond", async () => {
  const runtime = await startLiveEmitWsRuntime({
    port: 0,
    validateSession: async () => ({ valid: false }),
    streamManager: { stream: async () => undefined } as never,
  });
  try {
    const base = `http://127.0.0.1:${runtime.port}`;
    const health = await withTimeout(fetch(`${base}/healthz`).then((r) => r.json()), "healthz_fetch");
    const version = await withTimeout(fetch(`${base}/version`).then((r) => r.json()), "version_fetch");
    assert.equal(health.ok, true);
    assert.equal(version.ws_path, "/ws/live-emit");
  } finally {
    await closeRuntime(runtime);
  }
});

test("ws runtime connects and streams packets for valid session", async () => {
  const calls: StreamCall[] = [];
  const runtime = await startLiveEmitWsRuntime({
    port: 0,
    validateSession: async () => ({ valid: true, session_id: "sess_1", mode: "sports" }),
    streamManager: {
      stream: async (options) => {
        calls.push({
          sessionId: options.sessionId,
          lastAckSequence: options.lastAckSequence,
          signal: options.signal,
        });
        options.onPacket({
          id: "packet_1",
          session_id: options.sessionId,
          sequence: (options.lastAckSequence ?? 0) + 1,
          type: "DELTA_UPDATE",
          payload: {
            componentName: "MatchSnapshot",
            props: { title: "Live packet" },
            timestamp: Date.now(),
          },
        });
      },
    } as never,
  });

  try {
    const ws = await connectSocket(`ws://127.0.0.1:${runtime.port}${runtime.path}`);
    ws.send(
      JSON.stringify({
        type: "START_STREAM",
        payload: {
          prompt: "stream test",
          mode: "sports",
          sessionId: "sess_1",
          sessionToken: "token_1",
        },
      }),
    );

    const message = await waitForMessage(ws);
    const packet = coerceLiveEmitPacket(message);
    assert.ok(packet);
    assert.equal(packet.session_id, "sess_1");
    assert.equal(packet.type, "DELTA_UPDATE");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sessionId, "sess_1");
    ws.close(1000);
  } finally {
    await closeRuntime(runtime);
  }
});

test("ws runtime rejects invalid session and closes", async () => {
  const runtime = await startLiveEmitWsRuntime({
    port: 0,
    validateSession: async () => ({ valid: false }),
    streamManager: { stream: async () => undefined } as never,
  });

  try {
    const ws = await connectSocket(`ws://127.0.0.1:${runtime.port}${runtime.path}`);
    ws.send(
      JSON.stringify({
        type: "START_STREAM",
        payload: {
          prompt: "auth fail",
          sessionId: "sess_invalid",
          sessionToken: "bad",
        },
      }),
    );

    const msg = await waitForMessage(ws);
    const packet = coerceLiveEmitPacket(msg);
    assert.ok(packet);
    assert.equal(packet.type, "VETO_SIGNAL");
    const closed = await waitForClose(ws);
    assert.equal(closed.code, 4401);
  } finally {
    await closeRuntime(runtime);
  }
});

test("ws reconnect passes lastAckSequence through to stream manager", async () => {
  const calls: StreamCall[] = [];
  const runtime = await startLiveEmitWsRuntime({
    port: 0,
    validateSession: async () => ({ valid: true, session_id: "sess_2", mode: "sports" }),
    streamManager: {
      stream: async (options) => {
        calls.push({
          sessionId: options.sessionId,
          lastAckSequence: options.lastAckSequence,
          signal: options.signal,
        });
        options.onPacket({
          id: `packet_${calls.length}`,
          session_id: options.sessionId,
          sequence: (options.lastAckSequence ?? 0) + 1,
          type: "DELTA_UPDATE",
          payload: {
            componentName: "MatchSnapshot",
            props: { turn: calls.length },
            timestamp: Date.now(),
          },
        });
      },
    } as never,
  });

  try {
    const baseUrl = `ws://127.0.0.1:${runtime.port}${runtime.path}`;
    const ws1 = await connectSocket(baseUrl);
    ws1.send(
      JSON.stringify({
        type: "START_STREAM",
        payload: {
          prompt: "first",
          sessionId: "sess_2",
          sessionToken: "token_2",
        },
      }),
    );
    const first = await waitForMessage(ws1);
    const firstPacket = coerceLiveEmitPacket(first);
    assert.ok(firstPacket);
    assert.equal(firstPacket.sequence, 1);
    ws1.close(1000);

    const ws2 = await connectSocket(baseUrl);
    ws2.send(
      JSON.stringify({
        type: "START_STREAM",
        payload: {
          prompt: "second",
          sessionId: "sess_2",
          sessionToken: "token_2",
          lastAckSequence: 7,
        },
      }),
    );
    const second = await waitForMessage(ws2);
    const secondPacket = coerceLiveEmitPacket(second);
    assert.ok(secondPacket);
    assert.equal(secondPacket.sequence, 8);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].lastAckSequence, 7);
    ws2.close(1000);
  } finally {
    await closeRuntime(runtime);
  }
});

test("stale WS packets are ignored by client merge", async () => {
  const runtime = await startLiveEmitWsRuntime({
    port: 0,
    validateSession: async () => ({ valid: true, session_id: "sess_3", mode: "sports" }),
    streamManager: {
      stream: async (options) => {
        options.onPacket({
          id: "newer",
          session_id: options.sessionId,
          sequence: 2,
          type: "DELTA_UPDATE",
          payload: {
            componentName: "MatchSnapshot",
            props: { title: "newer" },
            timestamp: Date.now(),
          },
        });
        options.onPacket({
          id: "older",
          session_id: options.sessionId,
          sequence: 1,
          type: "DELTA_UPDATE",
          payload: {
            componentName: "MatchSnapshot",
            props: { title: "older" },
            timestamp: Date.now(),
          },
        });
      },
    } as never,
  });

  try {
    const ws = await connectSocket(`ws://127.0.0.1:${runtime.port}${runtime.path}`);
    const received: Record<string, unknown>[] = [];
    const waitForBatch = withTimeout(
      new Promise<void>((resolve) => {
        const onMessage = (raw: RawData) => {
          try {
            received.push(JSON.parse(raw.toString("utf8")) as Record<string, unknown>);
            if (received.length >= 2) {
              ws.off("message", onMessage);
              resolve();
            }
          } catch {
            // ignore malformed test packets
          }
        };
        ws.on("message", onMessage);
      }),
      "ws_message_batch",
    );
    ws.send(
      JSON.stringify({
        type: "START_STREAM",
        payload: {
          prompt: "stale test",
          sessionId: "sess_3",
          sessionToken: "token_3",
        },
      }),
    );

    await waitForBatch;

    const message1 = coerceLiveEmitPacket(received[0]);
    const message2 = coerceLiveEmitPacket(received[1]);
    assert.ok(message1);
    assert.ok(message2);

    let state = INITIAL_LIVE_EMIT_STATE;
    if (shouldAcceptPacket(message1, state)) state = mergeLiveEmitPacket(state, message1);
    if (shouldAcceptPacket(message2, state)) state = mergeLiveEmitPacket(state, message2);

    assert.equal(state.lastSequence, 2);
    assert.equal(state.props.title, "newer");
    ws.close(1000);
  } finally {
    await closeRuntime(runtime);
  }
});

test("disconnect aborts active stream", async () => {
  let aborted = false;
  const runtime = await startLiveEmitWsRuntime({
    port: 0,
    validateSession: async () => ({ valid: true, session_id: "sess_4", mode: "sports" }),
    streamManager: {
      stream: async (options) =>
        await new Promise<void>((resolve) => {
          options.signal?.addEventListener("abort", () => {
            aborted = true;
            resolve();
          });
        }),
    } as never,
  });

  try {
    const ws = await connectSocket(`ws://127.0.0.1:${runtime.port}${runtime.path}`);
    ws.send(
      JSON.stringify({
        type: "START_STREAM",
        payload: {
          prompt: "disconnect test",
          sessionId: "sess_4",
          sessionToken: "token_4",
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 30));
    ws.close(1000);
    await withTimeout(new Promise((resolve) => setTimeout(resolve, 80)), "abort_wait", 250);
    assert.equal(aborted, true);
  } finally {
    await closeRuntime(runtime);
  }
});

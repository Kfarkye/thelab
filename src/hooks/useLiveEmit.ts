"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  coerceLiveEmitPacket,
  type LiveEmitPacket,
  type LiveEmitSessionConfig,
  type LiveEmitStartRequest,
} from "@/lib/live-emit/types";
import {
  INITIAL_LIVE_EMIT_STATE,
  mergeLiveEmitPacket,
  parseSseEventPackets,
  shouldAcceptPacket,
  type LiveEmitClientState,
} from "@/lib/live-emit/client-runtime";

type ConnectionState = "idle" | "connecting" | "streaming" | "reconnecting" | "closed" | "error";

const MAX_RETRIES = 5;

export function useLiveEmit() {
  const [sessionConfig, setSessionConfig] = useState<LiveEmitSessionConfig | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [packets, setPackets] = useState<LiveEmitPacket[]>([]);
  const [liveState, setLiveState] = useState<LiveEmitClientState>(INITIAL_LIVE_EMIT_STATE);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectWaitResolveRef = useRef<(() => void) | null>(null);
  const sseAbortRef = useRef<AbortController | null>(null);
  const retryCountRef = useRef(0);
  const pendingRequestRef = useRef<LiveEmitStartRequest | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const activeSessionTokenRef = useRef<string | null>(null);
  const lastAckSequenceRef = useRef(0);

  const resetRuntime = useCallback(() => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (reconnectWaitResolveRef.current) {
      reconnectWaitResolveRef.current();
      reconnectWaitResolveRef.current = null;
    }
    if (sseAbortRef.current) {
      sseAbortRef.current.abort();
      sseAbortRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const applyPacket = useCallback((packet: LiveEmitPacket) => {
    setLiveState((current) => {
      if (!shouldAcceptPacket(packet, current)) return current;
      const next = mergeLiveEmitPacket(current, packet);
      lastAckSequenceRef.current = next.lastSequence;
      return next;
    });
    setPackets((current) => {
      const last = current[current.length - 1];
      if (
        last &&
        packet.session_id === last.session_id &&
        packet.sequence <= last.sequence
      ) {
        return current;
      }
      return [...current, packet].slice(-300);
    });
  }, []);

  const loadSession = useCallback(async (mode: string) => {
    const res = await fetch(`/api/live-emit/session?mode=${encodeURIComponent(mode)}`);
    if (!res.ok) throw new Error(`Session bootstrap failed (${res.status})`);
    const json = (await res.json()) as LiveEmitSessionConfig;
    setSessionConfig(json);
    return json;
  }, []);

  const runSseStream = useCallback(
    async (config: LiveEmitSessionConfig, request: LiveEmitStartRequest) => {
      let attempt = 0;
      while (attempt <= MAX_RETRIES) {
        setConnectionState(attempt === 0 ? "connecting" : "reconnecting");
        const abortController = new AbortController();
        sseAbortRef.current = abortController;
        try {
          const res = await fetch(config.sse_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: abortController.signal,
            body: JSON.stringify({
              ...request,
              sessionId: request.sessionId,
              sessionToken: request.sessionToken,
              lastAckSequence: request.lastAckSequence,
            }),
          });
          if (!res.ok || !res.body) {
            throw new Error(`Live stream failed (${res.status})`);
          }

          setConnectionState("streaming");
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split("\n\n");
            buffer = chunks.pop() || "";
            for (const chunk of chunks) {
              const packetRows = parseSseEventPackets(`${chunk}\n\n`);
              for (const packet of packetRows) applyPacket(packet);
            }
          }

          if (sseAbortRef.current === abortController) {
            sseAbortRef.current = null;
          }
          pendingRequestRef.current = null;
          setConnectionState("closed");
          return;
        } catch (err) {
          if (sseAbortRef.current === abortController) {
            sseAbortRef.current = null;
          }
          if (!pendingRequestRef.current) {
            setConnectionState("closed");
            return;
          }
          if (attempt >= MAX_RETRIES) {
            pendingRequestRef.current = null;
            setConnectionState("error");
            setError(err instanceof Error ? err.message : "SSE stream failed");
            return;
          }
          attempt += 1;
          request.lastAckSequence = lastAckSequenceRef.current;
          const retryMs = Math.min(1000 * 2 ** (attempt - 1), 15000);
          await new Promise((resolve) => {
            reconnectWaitResolveRef.current = () => resolve(undefined);
            reconnectTimerRef.current = window.setTimeout(() => {
              reconnectTimerRef.current = null;
              reconnectWaitResolveRef.current = null;
              resolve(undefined);
            }, retryMs);
          });
        }
      }
    },
    [applyPacket],
  );

  const connectWebSocket = useCallback(
    (config: LiveEmitSessionConfig, request: LiveEmitStartRequest) => {
      const wsUrl = config.websocket_url;
      if (!wsUrl) return false;

      pendingRequestRef.current = request;
      setConnectionState(retryCountRef.current > 0 ? "reconnecting" : "connecting");

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionState("streaming");
        retryCountRef.current = 0;
        setError(null);
        ws.send(
          JSON.stringify({
            type: "START_STREAM",
            payload: {
              ...request,
              sessionId: request.sessionId,
              sessionToken: request.sessionToken,
              lastAckSequence: lastAckSequenceRef.current,
            },
          }),
        );
      };

      ws.onmessage = (event) => {
        try {
          const parsed = coerceLiveEmitPacket(JSON.parse(String(event.data || "{}")));
          if (parsed) applyPacket(parsed);
        } catch {
          // Ignore non-packet messages from upstream servers.
        }
      };

      ws.onerror = () => {
        setError("WebSocket stream error");
        setConnectionState("error");
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!pendingRequestRef.current) {
          setConnectionState("closed");
          return;
        }
        if (retryCountRef.current >= MAX_RETRIES) {
          pendingRequestRef.current = null;
          setConnectionState("error");
          setError("WebSocket reconnect attempts exhausted");
          return;
        }
        const retryMs = Math.min(1000 * 2 ** retryCountRef.current, 15000);
        retryCountRef.current += 1;
        reconnectTimerRef.current = window.setTimeout(() => {
          const next = pendingRequestRef.current;
          if (!next) return;
          next.lastAckSequence = lastAckSequenceRef.current;
          connectWebSocket(config, next);
        }, retryMs);
      };

      return true;
    },
    [applyPacket],
  );

  const start = useCallback(
    async (request: LiveEmitStartRequest) => {
      setError(null);
      setPackets([]);
      lastAckSequenceRef.current = 0;
      setLiveState(INITIAL_LIVE_EMIT_STATE);

      const mode = request.mode || "code";
      const config = await loadSession(mode);
      activeSessionIdRef.current = config.session_id;
      activeSessionTokenRef.current = config.session_token;

      const requestWithDefaults: LiveEmitStartRequest = {
        ...request,
        thinkingLevel: request.thinkingLevel || config.default_thinking_level,
        sessionId: config.session_id,
        sessionToken: config.session_token,
        lastAckSequence: lastAckSequenceRef.current,
      };
      pendingRequestRef.current = requestWithDefaults;

      const connectedViaWs = connectWebSocket(config, requestWithDefaults);
      if (!connectedViaWs) {
        await runSseStream(config, requestWithDefaults);
      }
    },
    [connectWebSocket, loadSession, runSseStream],
  );

  const disconnect = useCallback(() => {
    pendingRequestRef.current = null;
    retryCountRef.current = 0;
    const sessionId = activeSessionIdRef.current;
    const sessionToken = activeSessionTokenRef.current;
    activeSessionIdRef.current = null;
    activeSessionTokenRef.current = null;
    resetRuntime();
    setConnectionState("closed");
    if (sessionId && sessionToken) {
      void fetch("/api/live-emit/session/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, session_token: sessionToken }),
      }).catch(() => undefined);
    }
  }, [resetRuntime]);

  useEffect(
    () => () => {
      disconnect();
    },
    [disconnect],
  );

  const latestPacket = useMemo(() => (packets.length ? packets[packets.length - 1] : null), [packets]);

  return {
    sessionConfig,
    connectionState,
    error,
    packets,
    latestPacket,
    liveState,
    start,
    disconnect,
    loadSession,
  };
}

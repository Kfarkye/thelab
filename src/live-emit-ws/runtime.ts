import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import { coerceLiveEmitPacket, type LiveEmitStartRequest } from "@/lib/live-emit/types";

type RawData = string | Buffer | ArrayBuffer | Buffer[];
type WebSocket = {
  on: (event: string, listener: (...args: any[]) => void) => void;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  ping: () => void;
  terminate: () => void;
  readyState: number;
  OPEN: number;
};

type SessionValidationResult = {
  valid: boolean;
  session_id?: string;
  mode?: string;
};

export type ValidateSessionFn = (
  sessionId: string,
  sessionToken: string,
) => Promise<SessionValidationResult>;

export type WsRuntimeOptions = {
  port?: number;
  path?: string;
  heartbeatMs?: number;
  validateSession?: ValidateSessionFn;
  streamManager?: {
    stream: (options: {
      prompt: string;
      mode?: LiveEmitStartRequest["mode"];
      thinkingLevel?: LiveEmitStartRequest["thinkingLevel"];
      includeThoughts?: boolean;
      sessionId: string;
      sessionToken?: string;
      lastAckSequence?: number;
      signal?: AbortSignal;
      onPacket: (packet: Record<string, unknown>) => void;
    }) => Promise<void>;
  };
  allowedOrigins?: string[] | null;
};

const DEFAULT_PATH = "/ws/live-emit";
const DEFAULT_HEARTBEAT_MS = 20_000;
const SERVICE_NAME = "live-emit-ws";

function nowIso(): string {
  return new Date().toISOString();
}

type LogLevel = "INFO" | "WARN" | "ERROR";

function logEvent(level: LogLevel, event: string, payload: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      severity: level,
      service: SERVICE_NAME,
      event,
      timestamp: nowIso(),
      ...payload,
    }),
  );
}

function writeJson(res: ServerResponse, statusCode: number, payload: Record<string, unknown>) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function normalizePath(value: string | undefined): string {
  if (!value) return DEFAULT_PATH;
  if (value.startsWith("/")) return value;
  return `/${value}`;
}

function parseJson(raw: RawData): Record<string, unknown> | null {
  try {
    const text = typeof raw === "string" ? raw : raw.toString("utf8");
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseStartPayload(row: Record<string, unknown>): LiveEmitStartRequest | null {
  const payload = row.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const body = payload as Record<string, unknown>;
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const sessionToken = typeof body.sessionToken === "string" ? body.sessionToken.trim() : "";
  if (!prompt || !sessionId || !sessionToken) return null;
  return {
    prompt,
    mode: typeof body.mode === "string" ? (body.mode as LiveEmitStartRequest["mode"]) : undefined,
    thinkingLevel:
      typeof body.thinkingLevel === "string"
        ? (body.thinkingLevel as LiveEmitStartRequest["thinkingLevel"])
        : undefined,
    includeThoughts: Boolean(body.includeThoughts),
    sessionId,
    sessionToken,
    lastAckSequence:
      typeof body.lastAckSequence === "number" && Number.isFinite(body.lastAckSequence)
        ? Math.max(0, Math.trunc(body.lastAckSequence))
        : undefined,
  };
}

async function defaultValidateSession(
  sessionId: string,
  sessionToken: string,
): Promise<SessionValidationResult> {
  const validateUrl =
    process.env.LIVE_EMIT_SESSION_VALIDATE_URL ||
    "http://127.0.0.1:3000/api/live-emit/session/validate";
  const authHeader = process.env.LIVE_EMIT_SESSION_VALIDATE_AUTH || "";
  const res = await fetch(validateUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify({ session_id: sessionId, session_token: sessionToken }),
  });
  if (!res.ok) return { valid: false };
  const json = (await res.json()) as SessionValidationResult;
  return {
    valid: Boolean(json.valid),
    session_id: typeof json.session_id === "string" ? json.session_id : undefined,
    mode: typeof json.mode === "string" ? json.mode : undefined,
  };
}

function closeWithPacket(
  ws: WebSocket,
  code: number,
  reason: string,
  packet: Record<string, unknown>,
): void {
  try {
    ws.send(JSON.stringify(packet));
  } catch {
    // ignore send failures during close
  } finally {
    ws.close(code, reason);
  }
}

export async function startLiveEmitWsRuntime(options: WsRuntimeOptions = {}) {
  const path = normalizePath(options.path);
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const startedAt = Date.now();
  const deployedAt = process.env.LIVE_EMIT_WS_DEPLOYED_AT || "unknown";
  const version =
    process.env.LIVE_EMIT_WS_VERSION ||
    process.env.K_REVISION ||
    process.env.GIT_SHA ||
    "dev";

  const manager =
    options.streamManager ??
    new (await import("@/lib/live-emit/gemini-stream-manager")).GeminiStreamManager();
  const validateSession = options.validateSession ?? defaultValidateSession;
  const allowedOrigins =
    options.allowedOrigins ??
    String(process.env.LIVE_EMIT_WS_ALLOWED_ORIGINS || "")
      .split(",")
      .map((row) => row.trim())
      .filter(Boolean);

  const server = createServer((req, res) => {
    const reqUrl = new URL(req.url || "/", "http://localhost");
    if (reqUrl.pathname === "/healthz") {
      writeJson(res, 200, {
        ok: true,
        service: SERVICE_NAME,
        version,
        deployed_at: deployedAt,
        uptime_s: Math.round((Date.now() - startedAt) / 1000),
      });
      return;
    }
    if (reqUrl.pathname === "/version") {
      writeJson(res, 200, {
        service: SERVICE_NAME,
        version,
        deployed_at: deployedAt,
        ws_path: path,
      });
      return;
    }
    writeJson(res, 404, {
      error: "not_found",
      service: SERVICE_NAME,
      ws_path: path,
      endpoints: ["/healthz", "/version", path],
    });
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });

  const heartbeatTimer = setInterval(() => {
    for (const client of wss.clients) {
      const row = client as WebSocket & { isAlive?: boolean };
      if (row.isAlive === false) {
        row.terminate();
        continue;
      }
      row.isAlive = false;
      try {
        row.ping();
      } catch {
        row.terminate();
      }
    }
  }, heartbeatMs);

  server.on("upgrade", (request, socket, head) => {
    const reqUrl = new URL(request.url || "/", "http://localhost");
    const connectionId = `conn_${randomUUID()}`;
    if (reqUrl.pathname !== path) {
      logEvent("WARN", "ws_upgrade_rejected_path", {
        connection_id: connectionId,
        path: reqUrl.pathname,
      });
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    const origin = String(request.headers.origin || "");
    if (allowedOrigins.length > 0 && origin && !allowedOrigins.includes(origin)) {
      logEvent("WARN", "ws_upgrade_rejected_origin", {
        connection_id: connectionId,
        origin,
      });
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws: unknown) => {
      (ws as WebSocket & { connectionId?: string }).connectionId = connectionId;
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws: unknown, request: IncomingMessage) => {
    const connection = ws as WebSocket & { isAlive?: boolean; connectionId?: string };
    connection.isAlive = true;
    const connectionId = connection.connectionId || `conn_${randomUUID()}`;
    connection.connectionId = connectionId;
    let abortController: AbortController | null = null;
    let closed = false;
    let currentRequestId: string | null = null;
    let currentSessionId: string | null = null;

    logEvent("INFO", "ws_connection_open", {
      connection_id: connectionId,
      remote: request.socket.remoteAddress || "unknown",
      user_agent: request.headers["user-agent"] || "unknown",
      deployed_at: deployedAt,
      version,
    });

    connection.on("pong", () => {
      connection.isAlive = true;
    });

    connection.on("message", async (raw: RawData) => {
      const requestId = `req_${randomUUID()}`;
      const msg = parseJson(raw);
      if (!msg) {
        logEvent("WARN", "ws_bad_message", {
          connection_id: connectionId,
          request_id: requestId,
        });
        closeWithPacket(connection, 4400, "bad_request", {
          id: `ws_err_${Date.now()}`,
          session_id: "unknown",
          sequence: 1,
          type: "VETO_SIGNAL",
          payload: {
            componentName: "LiveEmitStatus",
            props: { level: "High", reason: "Malformed WS packet payload." },
            timestamp: Date.now(),
          },
        });
        return;
      }

      const type = String(msg.type || "").trim().toUpperCase();
      if (type === "ACK") return;
      if (type !== "START_STREAM") {
        logEvent("WARN", "ws_unsupported_type", {
          connection_id: connectionId,
          request_id: requestId,
          received_type: type || "unknown",
        });
        closeWithPacket(connection, 4400, "bad_request", {
          id: `ws_err_${Date.now()}`,
          session_id: "unknown",
          sequence: 1,
          type: "VETO_SIGNAL",
          payload: {
            componentName: "LiveEmitStatus",
            props: { level: "High", reason: "Unsupported WS message type." },
            timestamp: Date.now(),
          },
        });
        return;
      }

      const start = parseStartPayload(msg);
      if (!start?.sessionId || !start.sessionToken) {
        logEvent("WARN", "ws_missing_start_fields", {
          connection_id: connectionId,
          request_id: requestId,
          session_id: start?.sessionId || "unknown",
        });
        closeWithPacket(connection, 4400, "bad_request", {
          id: `ws_err_${Date.now()}`,
          session_id: start?.sessionId || "unknown",
          sequence: (start?.lastAckSequence ?? 0) + 1,
          type: "VETO_SIGNAL",
          payload: {
            componentName: "LiveEmitStatus",
            props: { level: "High", reason: "Missing required start payload fields." },
            timestamp: Date.now(),
          },
        });
        return;
      }
      currentRequestId = requestId;
      currentSessionId = start.sessionId;
      logEvent("INFO", "ws_start_stream_received", {
        connection_id: connectionId,
        request_id: requestId,
        session_id: start.sessionId,
        last_ack_sequence: start.lastAckSequence ?? 0,
      });

      const validated = await validateSession(start.sessionId, start.sessionToken);
      if (!validated.valid) {
        logEvent("WARN", "ws_session_invalid", {
          connection_id: connectionId,
          request_id: requestId,
          session_id: start.sessionId,
        });
        closeWithPacket(connection, 4401, "unauthorized", {
          id: `ws_auth_${Date.now()}`,
          session_id: start.sessionId,
          sequence: (start.lastAckSequence ?? 0) + 1,
          type: "VETO_SIGNAL",
          payload: {
            componentName: "LiveEmitStatus",
            props: { level: "High", reason: "Invalid or expired live emit session." },
            timestamp: Date.now(),
          },
        });
        return;
      }

      abortController?.abort();
      abortController = new AbortController();
      let firstPacketSent = false;
      const sessionId = start.sessionId;
      const sessionToken = start.sessionToken;

      void manager
        .stream({
          prompt: start.prompt,
          sessionId,
          sessionToken,
          lastAckSequence: start.lastAckSequence,
          thinkingLevel: start.thinkingLevel,
          includeThoughts: start.includeThoughts,
          mode: start.mode || (validated.mode as LiveEmitStartRequest["mode"]) || "code",
          signal: abortController.signal,
          onPacket: (packet) => {
            if (closed || connection.readyState !== connection.OPEN) return;
            const safePacket = coerceLiveEmitPacket(packet);
            if (!safePacket) return;
            if (!firstPacketSent) {
              firstPacketSent = true;
              logEvent("INFO", "ws_first_packet_sent", {
                connection_id: connectionId,
                request_id: requestId,
                session_id: start.sessionId,
                packet_type: safePacket.type,
                sequence: safePacket.sequence,
              });
            }
            connection.send(JSON.stringify(safePacket));
          },
        })
        .catch((error) => {
          if (closed || connection.readyState !== connection.OPEN) return;
          logEvent("ERROR", "ws_stream_failure", {
            connection_id: connectionId,
            request_id: requestId,
            session_id: start.sessionId,
            message: error instanceof Error ? error.message : "unknown",
          });
          const baseSequence = start.lastAckSequence ?? 0;
          connection.send(
            JSON.stringify({
              id: `ws_stream_err_${Date.now()}`,
              session_id: start.sessionId,
              sequence: baseSequence + 1,
              type: "VETO_SIGNAL",
              payload: {
                componentName: "LiveEmitStatus",
                props: {
                  level: "High",
                  correlation_id: requestId,
                  reason:
                    error instanceof Error ? error.message : "WebSocket live emit stream failed.",
                },
                timestamp: Date.now(),
              },
            }),
          );
          connection.close(1011, "stream_failure");
        });
    });

    connection.on("close", () => {
      closed = true;
      abortController?.abort();
      abortController = null;
      logEvent("INFO", "ws_connection_closed", {
        connection_id: connectionId,
        request_id: currentRequestId || "none",
        session_id: currentSessionId || "none",
      });
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port ?? Number(process.env.PORT || 8787), resolve);
  });

  const address = server.address() as AddressInfo | null;
  const port = address?.port || Number(process.env.PORT || 8787);
  logEvent("INFO", "ws_runtime_started", {
    port,
    path,
    deployed_at: deployedAt,
    version,
  });

  return {
    port,
    path,
    version,
    deployedAt,
    close: async () => {
      clearInterval(heartbeatTimer);
      for (const client of wss.clients) {
        try {
          client.terminate();
        } catch {
          // ignore
        }
      }
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("ws_server_close_timeout"));
        }, 5_000);
        server.close((err) => {
          clearTimeout(timeout);
          if (err) reject(err);
          else resolve();
        });
      });
      logEvent("INFO", "ws_runtime_closed", {
        port,
        path,
        version,
      });
    },
  };
}

#!/usr/bin/env node
import WebSocket from "ws";

const appBaseUrl = String(process.env.APP_BASE_URL || "").replace(/\/+$/, "");
const explicitWsUrl = String(process.env.WS_URL || "").trim();
const mode = String(process.env.LIVE_EMIT_SMOKE_MODE || "sports").trim();
const prompt = String(
  process.env.LIVE_EMIT_SMOKE_PROMPT ||
    "Emit one packet confirming live transport health for smoke validation.",
).trim();

if (!appBaseUrl) {
  console.error("FAIL: APP_BASE_URL is required (example: https://app.example.com)");
  process.exit(1);
}

function fail(message, extra) {
  if (extra) {
    console.error(`FAIL: ${message}`, extra);
  } else {
    console.error(`FAIL: ${message}`);
  }
  process.exit(1);
}

function pass(message, extra) {
  if (extra) {
    console.log(`PASS: ${message}`, extra);
  } else {
    console.log(`PASS: ${message}`);
  }
}

function toWsUrl(raw) {
  if (!raw) return "";
  if (raw.startsWith("ws://") || raw.startsWith("wss://")) return raw;
  if (raw.startsWith("http://")) return raw.replace(/^http:/, "ws:");
  if (raw.startsWith("https://")) return raw.replace(/^https:/, "wss:");
  return raw;
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

function connectWebSocket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("ws_connect_timeout")), 10000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForPacket(ws, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ws_packet_timeout")), timeoutMs);
    ws.once("message", (raw) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(raw.toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForClose(ws, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ws_close_timeout")), timeoutMs);
    ws.once("close", (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString("utf8") });
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function main() {
  const sessionResp = await requestJson(`${appBaseUrl}/api/live-emit/session?mode=${encodeURIComponent(mode)}`, {
    method: "GET",
    headers: { "Cache-Control": "no-store" },
  });
  if (!sessionResp.ok || !sessionResp.json?.session_id || !sessionResp.json?.session_token) {
    fail("session bootstrap failed", sessionResp);
  }
  pass("session bootstrap", { session_id: sessionResp.json.session_id });

  const sessionId = sessionResp.json.session_id;
  const sessionToken = sessionResp.json.session_token;
  const wsUrl = toWsUrl(explicitWsUrl || sessionResp.json.websocket_url || "");
  if (!wsUrl) fail("no websocket URL available (set WS_URL or LIVE_EMIT_WS_URL in app env)");

  const validateResp = await requestJson(`${appBaseUrl}/api/live-emit/session/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, session_token: sessionToken }),
  });
  if (!validateResp.ok || !validateResp.json?.valid) {
    fail("validate path failed", validateResp);
  }
  pass("validate path", { session_id: sessionId });

  const ws = await connectWebSocket(wsUrl);
  pass("ws handshake", { ws_url: wsUrl });
  ws.send(
    JSON.stringify({
      type: "START_STREAM",
      payload: {
        prompt,
        mode,
        sessionId,
        sessionToken,
      },
    }),
  );

  const firstPacket = await waitForPacket(ws);
  if (!firstPacket || typeof firstPacket !== "object" || !firstPacket.type) {
    fail("first packet missing/invalid", firstPacket);
  }
  pass("first packet", { type: firstPacket.type, sequence: firstPacket.sequence });
  ws.close(1000, "smoke_complete");

  const stopResp = await requestJson(`${appBaseUrl}/api/live-emit/session/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, session_token: sessionToken }),
  });
  if (!stopResp.ok || !stopResp.json?.stopped) {
    fail("session stop failed", stopResp);
  }
  pass("session stopped", { session_id: sessionId });

  const wsReject = await connectWebSocket(wsUrl);
  wsReject.send(
    JSON.stringify({
      type: "START_STREAM",
      payload: {
        prompt: "reject smoke",
        mode,
        sessionId,
        sessionToken,
      },
    }),
  );
  const rejectPacket = await waitForPacket(wsReject);
  const closed = await waitForClose(wsReject);
  if (rejectPacket?.type !== "VETO_SIGNAL") {
    fail("expired session did not return veto packet", rejectPacket);
  }
  if (closed.code !== 4401) {
    fail("expired session close code mismatch", closed);
  }
  pass("expired session rejected", { close_code: closed.code, type: rejectPacket.type });

  console.log("SUCCESS: live emit WS smoke passed");
}

main().catch((error) => fail(error instanceof Error ? error.message : "unknown_smoke_failure"));

import type { LiveEmitPacket } from "@/lib/live-emit/types";

const MODE_CONTEXT: Record<string, string> = {
  healthcare:
    "You are operating in healthcare staffing context. Prioritize compliance blockers, timelines, and credentialing risk.",
  sports:
    "You are operating in sports intelligence context. Prioritize lineup/injury/market-impact changes and volatility signals.",
  worldcup:
    "You are operating in World Cup context. Prioritize tactical shifts, lineup risk, travel load, and market movement.",
  code:
    "You are operating in software engineering context. Prioritize runtime failures, correctness, security, and performance risk.",
  ayaops:
    "You are operating in staffing operations context. Prioritize actions, ownership, due-times, and escalation risk.",
};

export function getLiveEmitSystemInstruction(mode: string): string {
  const modeLine = MODE_CONTEXT[mode] || MODE_CONTEXT.code;
  return [
    "You are a Live Emit State Orchestrator.",
    modeLine,
    "Output newline-delimited JSON packets only. Never output prose outside packet JSON.",
    "Every line MUST be a complete LiveEmitPacket object.",
    "Allowed packet types: COMPONENT_INIT, DELTA_UPDATE, VETO_SIGNAL, HEARTBEAT.",
    "Use DELTA_UPDATE for incremental state changes. Avoid full state rewrites unless component changes.",
    "Use VETO_SIGNAL when a critical contradiction/risk is detected.",
    "Keep payload.props concise and render-safe.",
  ].join(" ");
}

export function buildLiveEmitUserPrompt(prompt: string): string {
  return [
    "Emit UI packets for the following request.",
    "Return NDJSON lines only (one JSON object per line).",
    "Do not include session_id or sequence. The server assigns transport fields.",
    "JSON schema:",
    `{"id":"string","type":"COMPONENT_INIT|DELTA_UPDATE|VETO_SIGNAL|HEARTBEAT","payload":{"componentName?":"string","props?":{},"rawHtml?":"string","reasoningLog?":"string","timestamp":1234567890}}`,
    "Request:",
    prompt,
  ].join("\n");
}

export const LIVE_EMIT_PACKET_EXAMPLE: LiveEmitPacket = {
  id: "emit_init_1",
  session_id: "live_sess_123",
  sequence: 1,
  type: "COMPONENT_INIT",
  payload: {
    componentName: "VetoGauge",
    props: {
      level: "Medium",
      reason: "One high-impact uncertainty is still unresolved.",
    },
    timestamp: Date.now(),
  },
};

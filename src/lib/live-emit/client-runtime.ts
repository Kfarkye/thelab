import { coerceLiveEmitPacket, type LiveEmitPacket } from "./types";

export interface LiveEmitClientState {
  componentName: string | null;
  props: Record<string, unknown>;
  rawHtml: string | null;
  reasoningLog: string | null;
  lastTimestamp: number | null;
  vetoSignal: LiveEmitPacket | null;
  sessionId: string | null;
  lastSequence: number;
}

export const INITIAL_LIVE_EMIT_STATE: LiveEmitClientState = {
  componentName: null,
  props: {},
  rawHtml: null,
  reasoningLog: null,
  vetoSignal: null,
  lastTimestamp: null,
  sessionId: null,
  lastSequence: 0,
};

export function shouldAcceptPacket(packet: LiveEmitPacket, state: LiveEmitClientState): boolean {
  if (state.sessionId && packet.session_id !== state.sessionId) return false;
  if (packet.sequence <= state.lastSequence) return false;
  return true;
}

export function mergeLiveEmitPacket(state: LiveEmitClientState, packet: LiveEmitPacket): LiveEmitClientState {
  const payload = packet.payload;
  const base = {
    ...state,
    sessionId: packet.session_id,
    lastSequence: packet.sequence,
    lastTimestamp: payload.timestamp || Date.now(),
  };

  if (packet.type === "HEARTBEAT") return base;

  if (packet.type === "VETO_SIGNAL") {
    return {
      ...base,
      vetoSignal: packet,
      componentName: payload.componentName || state.componentName,
      props: {
        ...state.props,
        ...(payload.props || {}),
      },
      rawHtml: payload.rawHtml ?? state.rawHtml,
      reasoningLog: payload.reasoningLog ?? state.reasoningLog,
    };
  }

  if (packet.type === "COMPONENT_INIT") {
    return {
      ...base,
      componentName: payload.componentName || state.componentName,
      props: payload.props || {},
      rawHtml: payload.rawHtml ?? null,
      reasoningLog: payload.reasoningLog ?? null,
      vetoSignal: null,
    };
  }

  return {
    ...base,
    componentName: payload.componentName || state.componentName,
    props: {
      ...state.props,
      ...(payload.props || {}),
    },
    rawHtml: payload.rawHtml ?? state.rawHtml,
    reasoningLog: payload.reasoningLog ?? state.reasoningLog,
  };
}

export function parseSseEventPackets(raw: string): LiveEmitPacket[] {
  const packets: LiveEmitPacket[] = [];
  const events = raw.split("\n\n");
  for (const event of events) {
    const lines = event.split("\n");
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let packet: LiveEmitPacket | null = null;
      try {
        packet = coerceLiveEmitPacket(JSON.parse(payload));
      } catch {
        packet = null;
      }
      if (packet) packets.push(packet);
    }
  }
  return packets;
}

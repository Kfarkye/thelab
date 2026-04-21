export type LiveEmitPacketType =
  | "COMPONENT_INIT"
  | "DELTA_UPDATE"
  | "VETO_SIGNAL"
  | "HEARTBEAT";

export interface LiveEmitPacket {
  id: string;
  session_id: string;
  sequence: number;
  type: LiveEmitPacketType;
  payload: {
    componentName?: string;
    props?: Record<string, unknown>;
    rawHtml?: string;
    reasoningLog?: string;
    timestamp: number;
  };
}

export type ThinkingLevel = "LOW" | "MEDIUM" | "HIGH";

export interface LiveEmitStartRequest {
  prompt: string;
  mode?: "healthcare" | "sports" | "code" | "worldcup" | "ayaops";
  thinkingLevel?: ThinkingLevel;
  includeThoughts?: boolean;
  sessionId?: string;
  sessionToken?: string;
  lastAckSequence?: number;
}

export interface LiveEmitSessionConfig {
  provider: "vertex";
  model: string;
  websocket_url: string | null;
  sse_url: string;
  default_thinking_level: ThinkingLevel;
  allowed_thinking_levels: ThinkingLevel[];
  thinking_parameter: "thinking_level";
  include_thoughts_supported: boolean;
  system_instruction_sample: string;
  session_id: string;
  session_token: string;
  expires_at: string;
  max_runtime_ms: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function coerceLiveEmitPacket(value: unknown): LiveEmitPacket | null {
  const row = asRecord(value);
  if (!row) return null;

  const rawType = String(row.type || "").trim().toUpperCase();
  if (
    rawType !== "COMPONENT_INIT" &&
    rawType !== "DELTA_UPDATE" &&
    rawType !== "VETO_SIGNAL" &&
    rawType !== "HEARTBEAT"
  ) {
    return null;
  }

  const payloadRow = asRecord(row.payload) || {};
  const sequenceRaw = typeof row.sequence === "number" ? row.sequence : Number(row.sequence);
  const sequence = Number.isFinite(sequenceRaw) ? Math.trunc(sequenceRaw) : NaN;
  if (!Number.isFinite(sequence) || sequence < 0) return null;
  const sessionId = String(row.session_id || row.sessionId || "").trim();
  if (!sessionId) return null;
  const timestamp =
    typeof payloadRow.timestamp === "number" && Number.isFinite(payloadRow.timestamp)
      ? payloadRow.timestamp
      : Date.now();

  return {
    id: String(row.id || `emit_${timestamp}`),
    session_id: sessionId,
    sequence,
    type: rawType,
    payload: {
      componentName:
        typeof payloadRow.componentName === "string" ? payloadRow.componentName : undefined,
      props: asRecord(payloadRow.props) || undefined,
      rawHtml: typeof payloadRow.rawHtml === "string" ? payloadRow.rawHtml : undefined,
      reasoningLog:
        typeof payloadRow.reasoningLog === "string" ? payloadRow.reasoningLog : undefined,
      timestamp,
    },
  };
}

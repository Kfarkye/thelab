import { randomUUID } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { buildLiveEmitUserPrompt, getLiveEmitSystemInstruction } from "@/lib/live-emit/system-instruction";
import {
  type LiveEmitPacket,
  type LiveEmitStartRequest,
  type ThinkingLevel,
} from "@/lib/live-emit/types";
import { GOOGLE_CLOUD_PROJECT } from "@/lib/env";

const PROJECT_ID = GOOGLE_CLOUD_PROJECT;
const LOCATION = "global";
const MODEL = process.env.GEMINI_LIVE_EMIT_MODEL || "gemini-3.1-pro-preview";

const ai = new GoogleGenAI({
  vertexai: true,
  project: PROJECT_ID,
  location: LOCATION,
});

function extractTextFromChunk(chunk: unknown): string {
  const row = chunk as Record<string, unknown> | null;
  if (!row) return "";

  if (typeof row.text === "string") return row.text;
  if (typeof row.text === "function") {
    try {
      const value = row.text();
      if (typeof value === "string") return value;
    } catch {
      // ignore and fall back
    }
  }

  const candidates = Array.isArray(row.candidates) ? row.candidates : [];
  const firstCandidate = candidates[0] as Record<string, unknown> | undefined;
  const content = (firstCandidate?.content as Record<string, unknown> | undefined) || {};
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const chunks = parts
    .map((part) => {
      const partRow = part as Record<string, unknown>;
      const text = partRow?.text;
      return typeof text === "string" ? text : "";
    })
    .filter(Boolean);
  return chunks.join("");
}

type ParsedModelPacket = {
  id?: string;
  type: LiveEmitPacket["type"];
  payload: LiveEmitPacket["payload"];
};

function parseNdjsonLine(line: string): ParsedModelPacket | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed === "```" || trimmed.toLowerCase() === "```json") return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const type = String(parsed.type || "").trim().toUpperCase();
    if (
      type !== "COMPONENT_INIT" &&
      type !== "DELTA_UPDATE" &&
      type !== "VETO_SIGNAL" &&
      type !== "HEARTBEAT"
    ) {
      return null;
    }
    const payload =
      parsed.payload && typeof parsed.payload === "object" && !Array.isArray(parsed.payload)
        ? (parsed.payload as Record<string, unknown>)
        : {};
    const normalizedPayload: LiveEmitPacket["payload"] = {
      componentName: typeof payload.componentName === "string" ? payload.componentName : undefined,
      props:
        payload.props && typeof payload.props === "object" && !Array.isArray(payload.props)
          ? (payload.props as Record<string, unknown>)
          : undefined,
      rawHtml: typeof payload.rawHtml === "string" ? payload.rawHtml : undefined,
      reasoningLog: typeof payload.reasoningLog === "string" ? payload.reasoningLog : undefined,
      timestamp:
        typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)
          ? payload.timestamp
          : Date.now(),
    };
    return {
      id: typeof parsed.id === "string" ? parsed.id : undefined,
      type: type as LiveEmitPacket["type"],
      payload: normalizedPayload,
    };
  } catch {
    return null;
  }
}

function buildGeminiConfig(mode: string, thinkingLevel: ThinkingLevel, includeThoughts: boolean): Record<string, unknown> {
  const config: Record<string, unknown> = {
    systemInstruction: getLiveEmitSystemInstruction(mode),
    responseMimeType: "application/json",
    temperature: 0.2,
    // Gemini 3/3.1 control parameter: thinking_level (via thinkingConfig.thinkingLevel).
    // Do NOT mix with thinking_budget in the same request.
    thinkingConfig: { thinkingLevel },
    tools: [{ googleSearch: {} }],
  };
  if (includeThoughts) {
    config.includeThoughts = true;
  }
  return config;
}

export interface StreamOptions extends LiveEmitStartRequest {
  onPacket: (packet: LiveEmitPacket) => void;
  signal?: AbortSignal;
  sessionId: string;
  maxRuntimeMs?: number;
  lastAckSequence?: number;
}

export class GeminiStreamManager {
  readonly model: string;

  constructor(model = MODEL) {
    this.model = model;
  }

  async stream(options: StreamOptions): Promise<void> {
    const mode = options.mode || "code";
    const thinkingLevel: ThinkingLevel = options.thinkingLevel || "HIGH";
    const includeThoughts = Boolean(options.includeThoughts);
    const prompt = String(options.prompt || "").trim();
    const sessionId = String(options.sessionId || "").trim();
    const maxRuntimeMs =
      typeof options.maxRuntimeMs === "number" && Number.isFinite(options.maxRuntimeMs)
        ? options.maxRuntimeMs
        : 90_000;
    let sequence =
      typeof options.lastAckSequence === "number" && Number.isFinite(options.lastAckSequence)
        ? Math.max(0, Math.trunc(options.lastAckSequence))
        : 0;
    if (!prompt) throw new Error("prompt is required");
    if (!sessionId) throw new Error("sessionId is required");

    const emitPacket = (
      type: LiveEmitPacket["type"],
      payload: LiveEmitPacket["payload"],
      explicitId?: string,
    ) => {
      sequence += 1;
      options.onPacket({
        id: explicitId || randomUUID(),
        session_id: sessionId,
        sequence,
        type,
        payload,
      });
    };
    const startedAt = Date.now();

    const heartbeatId = setInterval(() => {
      emitPacket("HEARTBEAT", { timestamp: Date.now() }, `hb_${Date.now()}`);
    }, 15000);

    let emittedAny = false;
    let buffer = "";

    try {
      const responseStream = await ai.models.generateContentStream({
        model: this.model,
        contents: [{ role: "user", parts: [{ text: buildLiveEmitUserPrompt(prompt) }] }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        config: buildGeminiConfig(mode, thinkingLevel, includeThoughts) as any,
      });

      emitPacket("COMPONENT_INIT", {
        componentName: "LiveEmitStatus",
        props: {
          phase: "initializing",
          mode,
          model: this.model,
          thinkingLevel,
        },
        timestamp: Date.now(),
      });

      for await (const chunk of responseStream) {
        if (options.signal?.aborted) break;
        if (Date.now() - startedAt > maxRuntimeMs) {
          emitPacket("VETO_SIGNAL", {
            componentName: "LiveEmitStatus",
            props: {
              level: "High",
              reason: "Live emit runtime limit reached; stream closed safely.",
            },
            timestamp: Date.now(),
          });
          break;
        }
        const text = extractTextFromChunk(chunk);
        if (!text) continue;
        buffer += text;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const packet = parseNdjsonLine(line);
          if (!packet) continue;
          emittedAny = true;
          emitPacket(packet.type, packet.payload, packet.id);
        }
      }

      const tail = parseNdjsonLine(buffer);
      if (tail) {
        emittedAny = true;
        emitPacket(tail.type, tail.payload, tail.id);
      }

      if (!emittedAny) {
        emitPacket("DELTA_UPDATE", {
          componentName: "LiveEmitStatus",
          props: {
            phase: "completed",
            note: "No packetized deltas returned; fallback summary emitted.",
          },
          timestamp: Date.now(),
        });
      }
    } finally {
      clearInterval(heartbeatId);
      emitPacket("HEARTBEAT", { timestamp: Date.now() }, `hb_done_${Date.now()}`);
    }
  }
}

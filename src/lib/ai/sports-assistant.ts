import {
  createVertexGenAI,
  ENTERPRISE_SAFETY_SETTINGS,
  GEMINI_PRO_MODEL,
  GEMINI_THINKING_HIGH,
} from "@/lib/ai/gemini-config";
import { sanitizeProductResponseText } from "@/lib/ai/response-policy";
import { prepareSportsEnvelope } from "@/lib/context/prepare-sports-model-envelope";
import { enforceSportsBoardTruth } from "@/lib/sports/board-truth";

// ── Sports Assistant Streaming ──────────────────────────────────
// Tools array is ABSENT. The model physically cannot hallucinate tool calls.
// Grounding is 100% server-side via the prepared envelope.

function scrubSportsChunkText(value: string): string {
  return String(value || "")
    .replace(/please gamble responsibly/gi, "")
    .replace(/betting information is provided/gi, "")
    .replace(/for intelligence purposes/gi, "")
    .replace(/for informational purposes only/gi, "");
}

export async function streamPrimarySportsAssistant(
  prompt: string,
  activeGameId?: string,
  options?: {
    maxSentences?: number;
    fallback?: string;
    allowBullets?: boolean;
    boardItems?: Array<{
      game_id?: string;
      home?: string;
      away?: string;
      league?: string;
      status?: string;
      start_time?: string | null;
      venue?: string | null;
      home_score?: number | null;
      away_score?: number | null;
      spread?: number | null;
      total?: number | null;
    }>;
    governanceRules?: Array<Record<string, unknown>>;
    governanceVersion?: string;
  },
): Promise<ReadableStream<Uint8Array>> {
  const { systemInstruction, userPrompt } = await prepareSportsEnvelope(
    prompt,
    activeGameId,
    options?.boardItems,
    options?.governanceRules,
    options?.governanceVersion,
  );

  const ai = createVertexGenAI("global");

  // generateContentStream — no tools array mounted.
  // Safety settings reuse the enterprise-wide constants from gemini-config.
  const responseStream = await ai.models.generateContentStream({
    model: GEMINI_PRO_MODEL,
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    config: {
      systemInstruction,
      ...GEMINI_THINKING_HIGH,
      safetySettings: ENTERPRISE_SAFETY_SETTINGS,
    },
  });

  const encoder = new TextEncoder();
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  let streamClosed = false;
  let emittedAnyText = false;
  let emittedText = "";
  const fallback = String(options?.fallback || "Schedule unavailable");

  const enqueueEvent = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    payload: Record<string, unknown>,
  ): void => {
    if (streamClosed) return;
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  };

  const clearKeepalive = (): void => {
    if (!keepaliveTimer) return;
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      keepaliveTimer = setInterval(() => {
        try {
          enqueueEvent(controller, {
            type: "meta",
            status: "keepalive",
            ts: new Date().toISOString(),
          });
        } catch {
          clearKeepalive();
        }
      }, 10_000);

      enqueueEvent(controller, {
        type: "meta",
        status: "connected",
        route: "sports_envelope_primary",
      });

      try {
        for await (const chunk of responseStream) {
          if (!chunk.text) continue;
          const sanitized = scrubSportsChunkText(chunk.text);
          if (!sanitized) continue;
          emittedAnyText = true;
          emittedText += sanitized;
          enqueueEvent(controller, { type: "text", text: sanitized });
        }
        let finalText = sanitizeProductResponseText({
          responseText: emittedText,
          mode: "sports_intelligence",
          maxSentences: options?.maxSentences || 3,
          fallback,
          allowBullets: Boolean(options?.allowBullets),
        });
        finalText = enforceSportsBoardTruth({
          responseText: finalText,
          boardItems: options?.boardItems,
        });
        if (!emittedAnyText || !finalText) {
          enqueueEvent(controller, { type: "text", text: fallback });
        } else if (finalText !== emittedText.trim()) {
          enqueueEvent(controller, { type: "replace_text", text: finalText });
        }
        streamClosed = true;
        clearKeepalive();
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        enqueueEvent(controller, {
          type: "error",
          code: "SPORTS_ENVELOPE_STREAM_FAILED",
          message,
        });
        streamClosed = true;
        clearKeepalive();
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
    cancel() {
      streamClosed = true;
      clearKeepalive();
    },
  });
}

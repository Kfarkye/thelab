// ── Claude provider (Vertex AI) ─────────────────────────────────
// Handles responses from Claude via the Anthropic Vertex SDK.
// Uses ADC — no Anthropic API key needed.

import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { GOOGLE_CLOUD_PROJECT } from "@/lib/env";

const PROJECT_ID = GOOGLE_CLOUD_PROJECT;
const REGION = process.env.CLAUDE_REGION || "us-east5";

// Available Claude models on Vertex
export const CLAUDE_MODELS = {
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
} as const;

const client = new AnthropicVertex({
  projectId: PROJECT_ID,
  region: REGION,
});

export interface ClaudeCallOptions {
  model: keyof typeof CLAUDE_MODELS;
  systemPrompt: string;
  messages: { role: "user" | "assistant"; content: string }[];
}

// Calls Claude, returns SSE-formatted ReadableStream.
// Throws on any error (caller handles fallback).
export async function callClaude(options: ClaudeCallOptions): Promise<ReadableStream> {
  const { model, systemPrompt, messages } = options;
  const modelId = CLAUDE_MODELS[model];

  const response = await client.messages.create({
    model: modelId,
    max_tokens: 4096,
    system: systemPrompt,
    messages,
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => "text" in block ? block.text : "")
    .join("");

  return new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ type: "text", text })}\n\n`
        )
      );
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

// ── Auto-Improve API Route ──────────────────────────────────────
// POST /api/system/auto-improve
// Accepts a code improvement instruction, uses Gemini with function-calling
// to read repo files and propose changes via GitHub PR.

import { NextRequest } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { requireAuth } from "@/lib/middleware/auth";
import { requireEnv } from "@/lib/env";
import { AUTO_IMPROVE_TOOLS } from "@/lib/ai/verter-tools";
import {
  readRepoFileByPath,
  processCodeChange,
  setGitHubConfigOverride,
  type ProcessCodeChangeParams,
} from "@/lib/github/tools";

const GEMINI_MODEL = "gemini-3-flash-preview";
const MAX_TOOL_ROUNDS = 6;

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export async function POST(request: NextRequest) {
  const { response } = await requireAuth(request);
  if (response) return response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const typedBody = body as Record<string, unknown>;
  const instruction = readString(typedBody.instruction);
  if (!instruction) {
    return new Response(
      JSON.stringify({ error: "instruction is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Accept GitHub config from the request body (UI-provided credentials)
  const githubConfigRaw = toRecord(typedBody.githubConfig);
  const owner = readString(githubConfigRaw.owner);
  const repo = readString(githubConfigRaw.repo);
  const token = readString(githubConfigRaw.token);
  const baseBranch = readString(githubConfigRaw.baseBranch) || "main";

  if (owner && repo && token) {
    setGitHubConfigOverride({ owner, repo, token, baseBranch });
  }

  const targetFiles = Array.isArray(typedBody.files)
    ? (typedBody.files as unknown[]).map((f) => readString(f)).filter(Boolean)
    : [];

  try {
    const ai = new GoogleGenAI({
      vertexai: true,
      project: requireEnv("GOOGLE_CLOUD_PROJECT"),
      location: "global",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: any = [
      {
        functionDeclarations: [...AUTO_IMPROVE_TOOLS],
      },
    ];

    const systemPrompt = `You are a senior software engineer reviewing a Next.js + TypeScript codebase.
Your job is to:
1. Read the required source files using read_repo_file
2. Analyze the code against the user's improvement instruction
3. Focus, identify the exact root cause, and explicitly list your plan as text BEFORE executing any changes.
4. If a safe change is warranted, call process_code_change with full file contents and a PR message
5. Never propose destructive or risky changes. Only safe, deterministic fixes.
6. Always read a file before modifying it.`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let contents: any[] = [
      {
        role: "user",
        parts: [
          {
            text: targetFiles.length
              ? `${instruction}\n\nTarget files to examine:\n${targetFiles.map((f) => `- ${f}`).join("\n")}`
              : instruction,
          },
        ],
      },
    ];

    const model = GEMINI_MODEL;
    let round = 0;
    const toolResults: Array<{ tool: string; ok: boolean; latency_ms: number }> = [];

    while (round < MAX_TOOL_ROUNDS) {
      round++;

      const result = await ai.models.generateContent({
        model,
        contents,
        config: {
          tools,
          temperature: 0.2,
          systemInstruction: systemPrompt,
        },
      });

      const candidates = result.candidates;
      if (!candidates?.length) break;

      const parts = candidates[0].content?.parts || [];
      const functionCalls = parts.filter(
        (p: { functionCall?: unknown }) => p.functionCall,
      );

      const textParts = parts
        .filter((p: { text?: string }) => typeof p.text === "string")
        .map((p: { text?: string }) => String(p.text));

      if (functionCalls.length === 0) {
        // Model is done — return final text
        return new Response(
          JSON.stringify({
            status: "complete",
            response: textParts.join(""),
            rounds: round,
            toolResults,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      // Execute tool calls
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolResponses: any[] = [];

      for (const fc of functionCalls) {
        const call = fc.functionCall as { name: string; args: unknown };
        const name = call.name;
        const args = toRecord(call.args);
        const start = Date.now();

        try {
          if (name === "read_repo_file") {
            const path = readString(args.path);
            const branch = readString(args.branch) || undefined;
            const content = await readRepoFileByPath(path, branch);
            const toolResult = content !== null
              ? { result: { path, content, found: true } }
              : { result: { path, found: false, error: "File not found" } };

            toolResponses.push({
              functionResponse: { name, response: toolResult },
            });
            toolResults.push({ tool: name, ok: true, latency_ms: Date.now() - start });
          } else if (name === "process_code_change") {
            const filePatchesRaw = args.file_patches;
            const files = Array.isArray(filePatchesRaw)
              ? filePatchesRaw.map((fp: unknown) => {
                  const patch = toRecord(fp);
                  return {
                    path: readString(patch.path),
                    content: readString(patch.content),
                  };
                }).filter((f) => f.path && f.content)
              : [];

            const changeParams: ProcessCodeChangeParams = {
              commitMessage: readString(args.commit_message) || "Auto-improve change",
              files,
              branch: readString(args.branch) || undefined,
              prTitle: readString(args.pr_title) || undefined,
              reviewStatus: readString(args.review_status) || undefined,
            };

            const prResult = await processCodeChange(changeParams);
            toolResponses.push({
              functionResponse: {
                name,
                response: { result: prResult },
              },
            });
            toolResults.push({ tool: name, ok: true, latency_ms: Date.now() - start });
          } else {
            toolResponses.push({
              functionResponse: {
                name,
                response: { result: null, error: `Unknown tool: ${name}` },
              },
            });
            toolResults.push({ tool: name, ok: false, latency_ms: Date.now() - start });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[auto-improve] tool ${name} failed:`, msg);
          toolResponses.push({
            functionResponse: {
              name,
              response: { result: null, error: msg },
            },
          });
          toolResults.push({ tool: name, ok: false, latency_ms: Date.now() - start });
        }
      }

      // Feed tool responses back to the model
      contents = [
        ...contents,
        { role: "model", parts },
        { role: "user", parts: toolResponses },
      ];
    }

    return new Response(
      JSON.stringify({
        status: "max_rounds_reached",
        rounds: round,
        toolResults,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    // ARCHITECTURE RULE: No retries/timeouts, circuit breakers, or opaque provider fallbacks.
    // Deterministic failure is required; do not hide downstream availability outages.
    const errorMsg = error instanceof Error ? error.message : "Unknown error in auto-improve route";
    console.error(JSON.stringify({
      severity: "ERROR",
      module: "auto-improve",
      message: errorMsg,
      stack: error instanceof Error ? error.stack : undefined
    }));
    return new Response(
      JSON.stringify({ error: "Internal server error during code improvement phase" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

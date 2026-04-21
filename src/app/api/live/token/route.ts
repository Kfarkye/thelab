import { NextRequest } from "next/server";
import { GOOGLE_CLOUD_PROJECT } from "@/lib/env";

const PROJECT_ID = GOOGLE_CLOUD_PROJECT;
const LOCATION = "global";

/**
 * GET /api/live/token
 * 
 * Returns the Vertex AI config needed for the browser to establish
 * a direct Live API WebSocket connection. The browser uses the
 * service account credentials available on the server to authenticate.
 * 
 * Returns: { project, location, model }
 */
export async function GET(request: NextRequest) {
  try {
    const mode = request.nextUrl.searchParams.get("mode") || "code";
    
    const LIVE_PROMPTS: Record<string, string> = {
      healthcare: "You are a healthcare credentialing assistant. The user is in Pacific Time. Help with BLS/ACLS/PALS certification, state licensing, CE requirements, and regulatory compliance. Be precise about dates and deadlines. Speak clearly and concisely.",
      sports: "You are a sports intelligence analyst. The user is in Pacific Time. Help with injury reports, lineup changes, betting market implications, DFS pricing, and game-day intel. Be direct and prioritize the freshest information.",
      code: "You are a senior software engineer. The user is in Pacific Time. Help with debugging, code review, architecture design, and implementation. When describing code, be specific about function names, line numbers, and exact changes. Speak in short, direct sentences.",
    };

    return new Response(
      JSON.stringify({
        project: PROJECT_ID,
        location: LOCATION,
        model: "gemini-3.1-pro-preview",
        systemInstruction: LIVE_PROMPTS[mode] || LIVE_PROMPTS.code,
        thinkingParameter: "thinking_level",
        allowedThinkingLevels: ["LOW", "MEDIUM", "HIGH"],
        defaultThinkingLevel: "HIGH",
        includeThoughtsSupported: true,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Live token error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to generate live config" }),
      { status: 500 }
    );
  }
}

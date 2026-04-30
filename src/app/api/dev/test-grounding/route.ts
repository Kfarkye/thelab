import { NextRequest, NextResponse } from "next/server";

import { queryRepoKnowledge } from "@/lib/ai/repo-retrieval";
import { requireEnv } from "@/lib/env";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const authHeader = request.headers.get("authorization");
    const secret = requireEnv("WEBHOOK_SECRET");

    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json(
        { error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 },
      );
    }

    const prompt = "What package does the repo governance require for Gemini/Vertex work?";
    const response = await queryRepoKnowledge(prompt);
    const mentionsGenAi = response.text.includes("@google/genai");
    const deprecatedVertexPackage = ["@google-cloud", "vertexai"].join("/");
    const mentionsVertexAi = response.text.includes(deprecatedVertexPackage);
    const acceptancePassed =
      response.grounded === true &&
      response.citations.length > 0 &&
      mentionsGenAi &&
      !mentionsVertexAi;

    return NextResponse.json({
      acceptancePassed,
      prompt,
      response: response.text,
      grounded: response.grounded,
      citationCount: response.citations.length,
      citations: response.citations,
      checks: {
        mentionsGenAi,
        avoidsVertexAi: !mentionsVertexAi,
      },
    });
  } catch (error) {
    console.error(JSON.stringify({
      severity: "ERROR",
      operation: "test_repo_grounding",
      message: "Grounding test route failed",
      error: error instanceof Error ? error.message : String(error),
    }));

    return NextResponse.json(
      { error: "Internal Server Error", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}

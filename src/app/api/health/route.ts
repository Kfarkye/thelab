import { NextResponse } from "next/server";

import { requireEnv } from "@/lib/env";

export const runtime = "nodejs";

type HealthRuntime = "cloud-run" | "vercel" | "local";

function currentRuntime(): HealthRuntime {
  if (process.env.K_SERVICE) return "cloud-run";
  if (process.env.VERCEL) return "vercel";
  return "local";
}

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({
      status: "ok",
      gitCommit: process.env.NEXT_PUBLIC_GIT_COMMIT || "unknown",
      gitBranch: process.env.NEXT_PUBLIC_GIT_BRANCH || "unknown",
      buildFingerprint: process.env.BUILD_FINGERPRINT || "unknown",
      worktreeDirty: process.env.WORKTREE_DIRTY === "true",
      gitStatusHash: process.env.GIT_STATUS_HASH || "unknown",
      chatModel: process.env.GEMINI_CHAT_MODEL || "unset",
      toolsEnabled: process.env.CHAT_ENABLE_TOOLS === "true",
      googleProject: requireEnv("GOOGLE_CLOUD_PROJECT"),
      runtime: currentRuntime(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "degraded",
        error: error instanceof Error ? error.message : "Unknown health error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}

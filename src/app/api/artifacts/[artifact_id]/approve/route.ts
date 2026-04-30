import { Spanner } from "@google-cloud/spanner";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/spanner-pool";
import { requireAuth } from "@/lib/middleware/auth";
import { validateArtifactDestination } from "@/lib/artifacts/governance";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ artifact_id: string }>;
};

type SpannerRow = {
  toJSON: () => unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

function jsonError(code: string, status: number): Response {
  return NextResponse.json({ error: { code } }, { status });
}

export async function POST(req: NextRequest, context: RouteContext): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth.response) return auth.response;

  const { artifact_id: artifactId } = await context.params;
  if (!artifactId) return jsonError("ARTIFACT_ID_REQUIRED", 400);

  const actorId = auth.user.email || auth.user.uid;
  const db = getDb("recruitingdb");
  const [rows] = await db.run({
    sql: `
      SELECT artifact_id, actor_id, proposed_destination, generated_code, violations_json
      FROM ephemeral_artifacts
      WHERE artifact_id = @artifactId
        AND actor_id = @actorId
        AND status = 'pending'
      LIMIT 1
    `,
    params: { artifactId, actorId },
    types: {
      artifactId: { type: "string" },
      actorId: { type: "string" },
    },
  });

  if (rows.length === 0) return jsonError("ARTIFACT_NOT_FOUND", 404);

  const artifact = isRecord((rows[0] as SpannerRow).toJSON()) ? (rows[0] as SpannerRow).toJSON() as Record<string, unknown> : {};
  const proposedDestination = validateArtifactDestination(readString(artifact.proposed_destination));
  const violations = JSON.parse(readString(artifact.violations_json) || "[]") as unknown;
  if (Array.isArray(violations) && violations.length > 0) return jsonError("GOVERNANCE_BLOCKED", 409);

  await db.table("ephemeral_artifacts").update({
    artifact_id: artifactId,
    status: "approved",
    proposed_destination: proposedDestination,
    resolved_at: Spanner.COMMIT_TIMESTAMP,
  });

  return NextResponse.json({
    success: true,
    artifact_id: artifactId,
    proposed_destination: proposedDestination,
  });
}

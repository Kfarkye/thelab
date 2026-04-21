// ── Hub API Route ────────────────────────────────────────────────
// POST /api/hub
// The single endpoint backing the `access_hub` tool.
// Accepts: { path: "candidates/Fontaine" }
// Returns: Hub response with identity block + HATEOAS links.

import { NextResponse } from "next/server";
import { resolve } from "@/lib/resolver";

export async function POST(req: Request) {
  const start = Date.now();

  try {
    const body = await req.json();
    const path = typeof body?.path === "string" ? body.path : "";

    if (!path.trim()) {
      return NextResponse.json(
        {
          type: "error",
          status: "error",
          summary: "Missing 'path' parameter. Use: candidates/{name}, templates/{id}, facilities/{name}",
          data: null,
          links: {},
        },
        { status: 400 },
      );
    }

    const result = await resolve(path);
    const latency = Date.now() - start;

    console.log(
      `[hub] path="${path}" status=${result.status} type=${result.type} latency=${latency}ms`,
    );

    return NextResponse.json(result);
  } catch (err) {
    const latency = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[hub] FAILED latency=${latency}ms error=${message}`);

    return NextResponse.json(
      {
        type: "error",
        status: "error",
        summary: `Hub error: ${message}`,
        data: null,
        links: {},
      },
      { status: 500 },
    );
  }
}

// GET for browser agent / human access
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const path = searchParams.get("path") || "";

  if (!path.trim()) {
    return NextResponse.json({
      type: "hub",
      status: "ok",
      summary: "URL Hub is online. Use ?path=candidates/{name} or POST with { path: '...' }",
      endpoints: {
        candidates: "?path=candidates/{name_or_id}",
        templates: "?path=templates/{id_or_search}",
        facilities: "?path=facilities/{name} (coming soon)",
        jobs: "?path=jobs/{id} (coming soon)",
      },
    });
  }

  const result = await resolve(path);
  return NextResponse.json(result);
}

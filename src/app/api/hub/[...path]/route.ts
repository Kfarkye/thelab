import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/resolver";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const start = Date.now();

  try {
    const { path } = await params;
    const joinedPath = Array.isArray(path) ? path.join("/") : "";
    const queryString = request.nextUrl.searchParams.toString();
    const resolvedPath = queryString ? `${joinedPath}?${queryString}` : joinedPath;

    if (!resolvedPath.trim()) {
      return NextResponse.json(
        {
          type: "error",
          status: "error",
          summary: "Missing hub path. Use /api/hub/{entity}/{identifier}.",
          data: null,
          links: {},
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store, max-age=0, must-revalidate",
            "x-request-id": requestId,
          },
        },
      );
    }

    const result = await resolve(resolvedPath);
    const latency = Date.now() - start;

    console.log(
      `[hub-path] path="${resolvedPath}" status=${result.status} type=${result.type} latency=${latency}ms`,
    );

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store, max-age=0, must-revalidate",
        "x-request-id": requestId,
      },
    });
  } catch (err) {
    const latency = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);

    console.error(`[hub-path] FAILED latency=${latency}ms error=${message}`);

    return NextResponse.json(
      {
        type: "error",
        status: "error",
        summary: `Hub error: ${message}`,
        data: null,
        links: {},
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0, must-revalidate",
          "x-request-id": requestId,
        },
      },
    );
  }
}

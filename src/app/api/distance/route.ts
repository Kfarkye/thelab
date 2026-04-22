import { NextRequest, NextResponse } from "next/server";

const MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

interface DistanceResult {
  distance: string;   // e.g. "127 mi"
  duration: string;   // e.g. "2 hr 15 min"
  origin: string;
  destination: string;
  status: "ok" | "no_results" | "error";
  error?: string;
}

/**
 * POST /api/distance
 * Body: { origin: string, destination: string }
 *
 * Returns driving distance + duration between two addresses using
 * Google Maps Distance Matrix API.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!MAPS_API_KEY) {
    return NextResponse.json(
      { status: "error", error: "GOOGLE_MAPS_API_KEY not configured" } satisfies DistanceResult,
      { status: 500 },
    );
  }

  let origin: string;
  let destination: string;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    origin = String(body.origin || "").trim();
    destination = String(body.destination || "").trim();
    if (!origin || !destination) {
      return NextResponse.json(
        { status: "error", error: "origin and destination are required" } satisfies Partial<DistanceResult>,
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json(
      { status: "error", error: "Invalid JSON body" } satisfies Partial<DistanceResult>,
      { status: 400 },
    );
  }

  try {
    const params = new URLSearchParams({
      origins: origin,
      destinations: destination,
      units: "imperial",
      key: MAPS_API_KEY,
    });

    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });

    if (!res.ok) {
      return NextResponse.json(
        {
          status: "error",
          origin,
          destination,
          distance: "--",
          duration: "--",
          error: `Google Maps returned HTTP ${res.status}`,
        } satisfies DistanceResult,
        { status: 502 },
      );
    }

    const data = (await res.json()) as {
      status: string;
      rows?: Array<{
        elements?: Array<{
          status: string;
          distance?: { text: string; value: number };
          duration?: { text: string; value: number };
        }>;
      }>;
    };

    if (data.status !== "OK" || !data.rows?.[0]?.elements?.[0]) {
      return NextResponse.json({
        status: "no_results",
        origin,
        destination,
        distance: "--",
        duration: "--",
      } satisfies DistanceResult);
    }

    const element = data.rows[0].elements[0];

    if (element.status !== "OK") {
      return NextResponse.json({
        status: "no_results",
        origin,
        destination,
        distance: "--",
        duration: "--",
      } satisfies DistanceResult);
    }

    return NextResponse.json({
      status: "ok",
      origin,
      destination,
      distance: element.distance?.text || "--",
      duration: element.duration?.text || "--",
    } satisfies DistanceResult);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      {
        status: "error",
        origin,
        destination,
        distance: "--",
        duration: "--",
        error: message,
      } satisfies DistanceResult,
      { status: 500 },
    );
  }
}

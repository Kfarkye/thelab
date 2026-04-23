import { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/candidates/ingest/seo-crawler
 *
 * The autonomous driver for the Data Feed integration pipeline.
 * Simulates a Googlebot edge environment to sweep public semantic schemas,
 * extracting 7-digit job identifiers required by the internal SSRS proxy.
 */
export async function POST(request: NextRequest) {
  try {
    // Note: Configurable target based on the specific public structure Aya exposes natively
    // (e.g., XML Sitemaps or structured JSON API endpoints meant for public indexing).
    const publicSeoEndpoint = "https://www.ayahealthcare.com/travel-nursing/jobs/sitemap.xml"; 

    console.log(JSON.stringify({
      severity: "INFO",
      module: "seo-crawler",
      message: "Initiating unauthenticated public edge scan",
      target: publicSeoEndpoint
    }));

    // 1. Sweep the Public Perimeter (No auth required)
    const publicResponse = await fetch(publicSeoEndpoint, {
      method: "GET",
      headers: {
        "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
        "Accept": "text/xml,application/xml,application/json"
      }
    });

    if (!publicResponse.ok) {
      throw new Error(`Failed to sweep public SEO edge. HTTP ${publicResponse.status}`);
    }

    const payloadText = await publicResponse.text();

    // 2. Extract Job Identifiers Natively 
    // Uses structural RegEx targeting 7-digit clustered identifiers within the raw XML/JSON block.
    // Example target structure: <loc>https://.../job/3277638</loc>
    const idMatches = Array.from(payloadText.matchAll(/\/(\d{7})(?:[</"']|$)/g));
    const extractedJobIds = [...new Set(idMatches.map(m => m[1]))]; // Remove duplicates

    if (extractedJobIds.length === 0) {
      return Response.json({ status: "exhausted", message: "No semantic identifiers located in payload" }, { status: 404 });
    }

    console.log(JSON.stringify({
      severity: "INFO",
      module: "seo-crawler",
      message: "Harvested public identifier array",
      count: extractedJobIds.length
    }));

    // 3. Pipe Extracted Payload to Internal SSRS Ingest
    // We seamlessly POST the public 7-digit arrays into the authenticated private proxy.
    const protocol = request.headers.get("x-forwarded-proto") || "http";
    const host = request.headers.get("host") || "localhost:3000";
    const internalProxyUrl = `${protocol}://${host}/api/candidates/ingest/ssrs-clicks`;

    const proxyResponse = await fetch(internalProxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_ids: extractedJobIds.slice(0, 500) }) // Batch limit to prevent proxy timeouts
    });

    if (!proxyResponse.ok) {
      throw new Error(`Internal SSRS proxy rejected the array payload. HTTP ${proxyResponse.status}`);
    }

    const proxyResult = await proxyResponse.json();

    return Response.json({
      ok: true,
      result: {
        outcome: "autonomous_sweep_complete",
        public_identifiers_harvested: extractedJobIds.length,
        proxy_outcome: proxyResult
      }
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to execute SEO crawler sequence";
    console.error(JSON.stringify({
      severity: "ERROR",
      module: "seo-crawler",
      message,
      stack: error instanceof Error ? error.stack : undefined
    }));
    return Response.json({ error: message }, { status: 500 });
  }
}

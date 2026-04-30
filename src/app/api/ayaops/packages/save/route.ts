import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import { ingestMarginLedgerCapture } from "@/lib/ayaops/margin-ledger";
import {
  buildPackageIngestRow,
  normalizePackageParseResult,
  type PackageSourceType,
} from "@/lib/ayaops/package-intake";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth(request);
  if (response) return response;

  try {
    const body = await request.json();
    const normalized = normalizePackageParseResult({
      extracted_package: body.parsedPackage || body.extracted_package || body.package,
      missing_fields: body.missingFields || body.missing_fields || [],
      needs_review: true,
    });
    const pkg = normalized.extracted_package;
    if (!pkg.facility_name) {
      return NextResponse.json(
        { error: "facility_name is required before saving a package." },
        { status: 400 },
      );
    }
    if (!pkg.specialty && !pkg.profession && !pkg.title) {
      return NextResponse.json(
        { error: "specialty, profession, or title is required before saving a package." },
        { status: 400 },
      );
    }

    const sourceType = String(body.sourceType || body.source_type || "ai_parsed") as PackageSourceType;
    const result = await ingestMarginLedgerCapture({
      view_type: "pay_package_intake",
      source_kind: sourceType,
      source_url: typeof body.sourceImageUrl === "string" ? body.sourceImageUrl : null,
      screenshot_id:
        typeof body.imageRecordId === "string"
          ? body.imageRecordId
          : typeof body.image_record_id === "string"
            ? body.image_record_id
            : null,
      captured_at: new Date().toISOString(),
      captured_by: user.uid,
      notes: "Saved from pay package intake preview",
      raw_capture_json: {
        ...body,
        saved_from: "package_intake_preview",
      },
      rows: [buildPackageIngestRow(pkg)],
    });

    const rowsUpdated =
      Number(result.canonical_upserted || 0) + Number(result.canonical_updated || 0);
    return NextResponse.json({
      ok: true,
      action: "save_package",
      creates: "package",
      record_phase: "unattached",
      appears_in: "left_package_queue",
      rowsUpdated,
      result,
      package: normalized,
    });
  } catch (error) {
    console.error("Package save error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save package." },
      { status: 500 },
    );
  }
}

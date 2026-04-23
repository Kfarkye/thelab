import { NextRequest, NextResponse } from "next/server";
import { queryFeeLedger } from "@/lib/licensing/fee-ledger";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const state = url.searchParams.get("state") || undefined;
    const profession = url.searchParams.get("profession") || undefined;
    const fee_type = url.searchParams.get("fee_type") || undefined;
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 100;

    // Call the underlying ledger query
    const results = await queryFeeLedger({
      state,
      profession,
      fee_type,
      limit,
    });

    // Transform into a stable, public-facing snapshot
    const snapshot = {
      as_of: new Date().toISOString(),
      filters_applied: results.filters,
      fees: results.objects.map((obj) => ({
        id: obj.object_id,
        state: obj.state,
        profession: obj.profession,
        fee_type: obj.fee_type,
        amount_usd: parseFloat(obj.amount_usd),
        board_name: obj.board_name,
        last_verified_at: obj.effective_at,
        source_status: obj.source_status,
      })),
      metadata: {
        total_records: results.objects.length,
        data_source: "statelicensingreference.com via The Lab",
        is_live: true,
      },
    };

    return NextResponse.json(snapshot, {
      headers: {
        // Cache control for public consumption
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        "Access-Control-Allow-Origin": "*", // Allow public client access from SLA 
      },
    });
  } catch (error: unknown) {
    console.error("Public Snapshot error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { queryJobBoard } from "@/lib/ayaops/margin-ledger";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get("limit");
    const result = await queryJobBoard({
      limit: limit ? Number(limit) : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

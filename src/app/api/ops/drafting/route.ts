import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import {
  listDraftQueue,
  resolvePick,
  transitionDraftPick,
  type DraftMutationAction,
  type DraftQueueStatus,
} from "@/lib/sports/picks-ledger";

export const runtime = "nodejs";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 80;
  return Math.max(1, Math.min(300, Math.trunc(parsed)));
}

function parseStatus(value: string | null): DraftQueueStatus | "ALL" {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "PENDING" || normalized === "COMMITTED" || normalized === "REJECTED") {
    return normalized;
  }
  return "ALL";
}

function parseAction(value: unknown): DraftMutationAction | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "commit") return "commit";
  if (normalized === "reject") return "reject";
  return null;
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  const { user, response } = await requireAuth(request);
  if (response) return response;

  const status = parseStatus(request.nextUrl.searchParams.get("status"));
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

  try {
    const queue = await listDraftQueue({ status, limit });
    const items = queue.items.map((pick) => ({
      ...resolvePick(pick, "INTERNAL"),
      draft_status: pick.draft_status,
      draft_actor: pick.draft_actor,
      draft_reason: pick.draft_reason,
      draft_action_at: pick.draft_action_at,
    }));

    return NextResponse.json(
      {
        type: "ops_draft_queue",
        status: "resolved",
        summary: `${items.length} draft queue items loaded`,
        data: {
          viewer: {
            uid: user.uid,
            email: user.email || null,
          },
          filters: {
            status,
            limit,
          },
          counts: {
            total: queue.total,
            pending: queue.pending,
            committed: queue.committed,
            rejected: queue.rejected,
          },
          items,
        },
        links: {
          self: request.nextUrl.pathname + request.nextUrl.search,
          mutate: "/api/ops/drafting",
          by_pick: "/api/sports/picks/{pick_id}?role=INTERNAL",
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0, must-revalidate",
          "x-request-id": requestId,
        },
      },
    );
  } catch (error) {
    console.error("[ops-drafting] Failed to load queue", {
      status,
      limit,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: "Failed to load drafting queue." },
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

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  const { user, response } = await requireAuth(request);
  if (response) return response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const pickId = String(body.pick_id || body.pickId || body.id || "").trim();
  const action = parseAction(body.action);
  const reason = typeof body.reason === "string" ? body.reason.trim() : null;

  if (!pickId) {
    return NextResponse.json(
      { error: "pick_id is required." },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store, max-age=0, must-revalidate",
          "x-request-id": requestId,
        },
      },
    );
  }

  if (!action) {
    return NextResponse.json(
      { error: "action must be commit or reject." },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store, max-age=0, must-revalidate",
          "x-request-id": requestId,
        },
      },
    );
  }

  try {
    const actor = user.email || user.uid;
    const result = await transitionDraftPick({
      pick_id: pickId,
      action,
      actor,
      reason,
    });

    return NextResponse.json(
      {
        type: "ops_draft_mutation",
        status: "resolved",
        summary: `${result.pick.display}: ${result.mutation.previous_draft_status} to ${result.mutation.new_draft_status}`,
        data: {
          mutation: result.mutation,
          pick: {
            ...resolvePick(result.pick, "INTERNAL"),
            draft_status: result.mutation.new_draft_status,
            draft_actor: result.mutation.actor,
            draft_reason: result.mutation.reason,
          },
        },
        links: {
          self: "/api/ops/drafting",
          queue: "/api/ops/drafting?status=PENDING",
          pick: `/api/sports/picks/${encodeURIComponent(result.pick.pick_id)}?role=INTERNAL`,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0, must-revalidate",
          "x-request-id": requestId,
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to mutate drafting queue.";
    const statusCode = /not found/i.test(message) ? 404 : 500;

    console.error("[ops-drafting] Failed to mutate queue", {
      pickId,
      action,
      message,
    });

    return NextResponse.json(
      { error: message },
      {
        status: statusCode,
        headers: {
          "Cache-Control": "no-store, max-age=0, must-revalidate",
          "x-request-id": requestId,
        },
      },
    );
  }
}

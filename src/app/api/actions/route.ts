import { NextRequest, NextResponse } from 'next/server';
import { Spanner, Transaction } from '@google-cloud/spanner';
import { getDb } from '@/lib/spanner-pool';
import { requireAuth } from '@/lib/middleware/auth';

interface ActionRequest {
  entityId: string;
  action: string;
  payload: Record<string, unknown>;
  transactionId: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { user, response } = await requireAuth(req);
  if (response) return response as NextResponse;

  const { entityId, action, payload, transactionId }: ActionRequest = await req.json();

  if (!transactionId) {
    return NextResponse.json({ error: 'transactionId is required for audit trail' }, { status: 400 });
  }

  const db = getDb('aya-ops');

  try {
    await db.runTransactionAsync(async (tx: Transaction) => {
      tx.insert('AuditEvents', {
        EventId: transactionId,
        EntityId: entityId,
        Actor: user.email ?? user.uid,
        Action: action,
        Payload: JSON.stringify(payload),
        CreatedAt: Spanner.COMMIT_TIMESTAMP
      });
      // specific object writes...
    });

    return NextResponse.json({ status: 'success' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown write error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

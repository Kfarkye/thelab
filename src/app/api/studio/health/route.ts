import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { readOne } from '@/lib/portal-db';

export async function GET(request: NextRequest) {
  const requestId =
    request.headers.get('x-request-id') ?? randomUUID();

  const buildInfo = {
    service: 'studio',
    deploy_ts: process.env.DEPLOY_TS ?? 'unknown',
    git_sha: process.env.GIT_SHA ?? 'unknown',
    node_env: process.env.NODE_ENV ?? 'unknown',
  };

  try {
    const row = await readOne<{ ok: number }>('SELECT 1 AS ok');
    console.log('[studio:health]', { request_id: requestId, spanner_ok: !!row });
    return NextResponse.json({
      ok: true,
      spanner: !!row,
      request_id: requestId,
      ...buildInfo,
    });
  } catch (err) {
    console.error('[studio:health]', { request_id: requestId, err });
    return NextResponse.json(
      {
        ok: false,
        spanner: false,
        request_id: requestId,
        ...buildInfo,
      },
      { status: 503 }
    );
  }
}

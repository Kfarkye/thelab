import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRecruiter, safeError } from '@/lib/portal-auth';
import { listCandidatesForStudio } from '@/lib/portal-db';

export async function GET(request: NextRequest) {
  const auth = await requireRecruiter(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  const limit = Math.min(Math.max(parseInt(limitParam ?? '50', 10) || 50, 1), 200);

  try {
    const candidates = await listCandidatesForStudio(limit);
    return NextResponse.json({ candidates });
  } catch (err) {
    return safeError('Could not load candidates. Try again.', 500, err);
  }
}

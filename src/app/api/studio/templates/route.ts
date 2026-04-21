import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRecruiter, safeError } from '@/lib/portal-auth';
import { listTemplates } from '@/lib/portal-db';

export async function GET(request: NextRequest) {
  const auth = await requireRecruiter(request);
  if (!auth.ok) return auth.response;

  try {
    const templates = await listTemplates();
    return NextResponse.json({ templates });
  } catch (err) {
    return safeError('Could not load templates. Try again.', 500, err);
  }
}

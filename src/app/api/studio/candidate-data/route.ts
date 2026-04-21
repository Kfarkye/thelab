import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRecruiter, safeError } from '@/lib/portal-auth';
import { getCandidatePortalData } from '@/lib/portal-db';

export async function GET(request: NextRequest) {
  const auth = await requireRecruiter(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return safeError('Missing candidate id.', 400);

  try {
    const data = await getCandidatePortalData(id);
    if (!data) {
      return NextResponse.json(
        { error: 'Candidate not found.' },
        { status: 404 }
      );
    }
    return NextResponse.json({ data });
  } catch (err) {
    return safeError('Could not load candidate data. Try again.', 500, err);
  }
}

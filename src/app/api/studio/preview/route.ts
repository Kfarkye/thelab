import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRecruiter, safeError } from '@/lib/portal-auth';
import { getCandidatePortalData } from '@/lib/portal-db';
import { buildPage } from '@/lib/portal-template';

export async function POST(request: NextRequest) {
  const auth = await requireRecruiter(request);
  if (!auth.ok) return auth.response;

  let body: {
    template_html?: string;
    template_css?: string;
    candidate_id?: string;
    title?: string;
  };
  try {
    body = await request.json();
  } catch {
    return safeError('Invalid request.', 400);
  }

  if (typeof body.template_html !== 'string') {
    return safeError('Missing template HTML.', 400);
  }
  if (!body.candidate_id) {
    return safeError('Missing candidate id.', 400);
  }

  try {
    const data = await getCandidatePortalData(body.candidate_id);
    if (!data) {
      return NextResponse.json(
        { error: 'Candidate not found.' },
        { status: 404 }
      );
    }

    const html = buildPage({
      title: body.title,
      html: body.template_html,
      css: body.template_css ?? '',
      data: data as unknown as Record<string, unknown>,
      noindex: true,
    });

    return NextResponse.json({ html });
  } catch (err) {
    return safeError('Could not render preview.', 500, err);
  }
}

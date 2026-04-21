import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRecruiter, safeError } from '@/lib/portal-auth';
import { getTemplateById, saveTemplate } from '@/lib/portal-db';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const auth = await requireRecruiter(request);
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;

  try {
    const template = await getTemplateById(id);
    if (!template) {
      return NextResponse.json(
        { error: 'Template not found.' },
        { status: 404 }
      );
    }
    return NextResponse.json({ template });
  } catch (err) {
    return safeError('Could not load template. Try again.', 500, err);
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const auth = await requireRecruiter(request);
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const url = new URL(request.url);
  const publish = url.searchParams.get('publish') === 'true';

  let body: {
    template_html?: string;
    template_css?: string | null;
    schema_json?: unknown;
    change_note?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return safeError('Invalid request.', 400);
  }

  if (typeof body.template_html !== 'string') {
    return safeError('Missing template HTML.', 400);
  }
  if (body.template_html.length > 500_000) {
    return safeError('Template is too large. Trim it below 500 KB.', 400);
  }

  try {
    const result = await saveTemplate({
      template_id: id,
      template_html: body.template_html,
      template_css: body.template_css ?? null,
      schema_json: body.schema_json,
      change_note: body.change_note ?? null,
      publish,
      created_by: auth.uid,
    });
    return NextResponse.json({ saved: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    if (msg === 'template_not_found') {
      return NextResponse.json(
        { error: 'Template not found.' },
        { status: 404 }
      );
    }
    return safeError('Could not save. Try again.', 500, err);
  }
}

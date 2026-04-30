import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { requireAuth } from '@/lib/middleware/auth';
import { isSafeMutation } from '@/lib/spanner/guard';

const ApplyRequestSchema = z.object({
  patch: z.object({
    files: z.array(z.object({
      path: z.string().min(1),
      content: z.string(),
    })).min(1),
  }),
  overrideToken: z.string().optional(),
});

function resolveWorkspacePath(filePath: string): string {
  const root = process.cwd();
  const fullPath = path.resolve(root, filePath);
  const relativePath = path.relative(root, fullPath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('PATH_TRAVERSAL');
  }

  return fullPath;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { response } = await requireAuth(req);
  if (response) return response as NextResponse;

  const parsed = ApplyRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_FAILED', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { patch, overrideToken } = parsed.data;

  try {
    for (const file of patch.files) {
      if (!isSafeMutation(file.content, overrideToken)) {
        return NextResponse.json(
          { error: 'UNSAFE_MUTATION', message: 'Destructive DDL blocked. Provide a valid override token.' },
          { status: 403 },
        );
      }

      const fullPath = resolveWorkspacePath(file.path);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, file.content, 'utf8');
    }

    return NextResponse.json({ status: 'applied' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: 'APPLY_FAILED', message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface FilePatch {
  path: string;
  content: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  await requireAuth(req);
  const { patch }: { patch: { files: FilePatch[] } } = await req.json();

  const backups = new Map<string, string | null>();

  try {
    // 1. Snapshot and Apply
    for (const file of patch.files) {
      const fullPath = path.resolve(process.cwd(), file.path);
      backups.set(fullPath, fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : null);

      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, file.content, 'utf8');
    }

    // 2. Execute Test Suite (Rule: design for cold starts/atomic cleanup)
    execSync('npx vitest run --passWithNoTests', { stdio: 'pipe' });

    return NextResponse.json({ status: 'verified' });
  } catch (e: unknown) {
    const error = e as { stdout?: Buffer; message: string };
    return NextResponse.json({ 
      status: 'rejected', 
      reason: 'Regression: ' + (error.stdout?.toString() || error.message) 
    }, { status: 422 });
  } finally {
    // 3. Guaranteed Rollback
    for (const [fullPath, content] of backups.entries()) {
      if (content === null) {
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      } else {
        fs.writeFileSync(fullPath, content, 'utf8');
      }
    }
  }
}

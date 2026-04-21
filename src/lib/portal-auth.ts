/**
 * Auth Guard for Studio Routes
 *
 * All /api/studio/* handlers should call requireRecruiter(request)
 * before doing any work.
 *
 * Returns:
 *   { ok: true, uid, email }  on success
 *   NextResponse (401/403)     on failure — handler should return it directly
 *
 * Token source priority:
 *   1. Authorization: Bearer <id_token>   (from client fetch)
 *   2. Cookie: session=<id_token>          (SSR)
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { getApps, initializeApp, cert } from 'firebase-admin/app';

/* ─────────────────────────────────────────────────────────
 * Firebase Admin init — idempotent across hot reloads
 * ───────────────────────────────────────────────────────── */

function getAdminAuth() {
  if (getApps().length === 0) {
    // Application Default Credentials on Cloud Run,
    // or GOOGLE_APPLICATION_CREDENTIALS locally.
    initializeApp({
      projectId:
        process.env.FIREBASE_ADMIN_PROJECT_ID ??
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      credential: process.env.FIREBASE_ADMIN_SA_JSON
        ? cert(JSON.parse(process.env.FIREBASE_ADMIN_SA_JSON))
        : undefined,
    });
  }
  return getAuth();
}

/* ─────────────────────────────────────────────────────────
 * Recruiter allowlist — single source of truth.
 *
 * For v1, hardcode your uid here. Later, move to a
 * recruiter_accounts table in Spanner and query it.
 * ───────────────────────────────────────────────────────── */

function isRecruiter(uid: string, email: string | undefined): boolean {
  const allowedUids = (process.env.STUDIO_ALLOWED_UIDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowedEmails = (process.env.STUDIO_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (allowedUids.includes(uid)) return true;
  if (email && allowedEmails.includes(email.toLowerCase())) return true;
  return false;
}

/* ─────────────────────────────────────────────────────────
 * Main guard
 * ───────────────────────────────────────────────────────── */

export type AuthResult =
  | { ok: true; uid: string; email: string | undefined }
  | { ok: false; response: NextResponse };

export async function requireRecruiter(request: NextRequest): Promise<AuthResult> {
  // Extract ID token
  let token: string | null = null;
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else {
    const cookie = request.cookies.get('session')?.value;
    if (cookie) token = cookie;
  }

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Please sign in to continue.' },
        { status: 401 }
      ),
    };
  }

  // Verify with Firebase Admin
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    if (!isRecruiter(decoded.uid, decoded.email)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'This area is for recruiters only.' },
          { status: 403 }
        ),
      };
    }
    return { ok: true, uid: decoded.uid, email: decoded.email };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Your session has expired. Please sign in again.' },
        { status: 401 }
      ),
    };
  }
}

/* ─────────────────────────────────────────────────────────
 * Plain-English error helper — use for user-facing failures.
 * NEVER leak table names, SQL, or stack traces to the client.
 * ───────────────────────────────────────────────────────── */

export function safeError(
  userMessage: string,
  status = 500,
  logDetail?: unknown
): NextResponse {
  if (logDetail !== undefined) {
    console.error('[studio]', userMessage, logDetail);
  }
  return NextResponse.json({ error: userMessage }, { status });
}

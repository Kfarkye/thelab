// ── Universal Auth Gate ──────────────────────────────────────────
// Every /api/* route MUST call requireAuth() before doing any work.
// Returns either { user, response: null } or { user: null, response }.
//
// Token source priority:
//   1. Authorization: Bearer <id_token>
//   2. Cookie: session=<id_token>

import { getAuth } from "firebase-admin/auth";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { OAuth2Client } from "google-auth-library";
import { requireEnv } from "@/lib/env";

// ── Firebase Admin init — idempotent across hot reloads ──────────

function getAdminAuth() {
  if (getApps().length === 0) {
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

// ── Types ────────────────────────────────────────────────────────

export type AuthUser = {
  uid: string;
  email: string | undefined;
};

export type AuthResult =
  | { user: AuthUser; response: null }
  | { user: null; response: Response };

// ── Main Gate ────────────────────────────────────────────────────

/**
 * Verify Firebase ID token from request headers or cookies.
 * Returns the decoded user on success, or a 401 Response on failure.
 *
 * Usage in any route:
 * ```ts
 * const { user, response } = await requireAuth(request);
 * if (response) return response;
 * // user.uid is now verified
 * ```
 */
export async function requireAuth(request: Request): Promise<AuthResult> {
  // Extract token from Authorization header or session cookie
  let token: string | null = null;

  const authHeader =
    request.headers.get("Authorization") ||
    request.headers.get("authorization");

  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  } else {
    // Fallback: check cookie (for SSR requests)
    const cookieHeader = request.headers.get("cookie") || "";
    const sessionMatch = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
    if (sessionMatch) {
      token = sessionMatch[1];
    }
  }

  if (!token) {
    return {
      user: null,
      response: new Response(
        JSON.stringify({ error: "Missing Bearer token" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      ),
    };
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    if (!decoded) {
      throw new Error("Token verification yielded null");
    }

    return {
      user: { uid: decoded.uid, email: decoded.email },
      response: null,
    };
  } catch (err) {
    // Attempt fallback for Google Service Account OIDC tokens
    try {
      const oAuth2Client = new OAuth2Client();
      const expectedAudience = requireEnv("CRON_OIDC_AUDIENCE");
      
      const loginTicket = await oAuth2Client.verifyIdToken({
        idToken: token,
        audience: expectedAudience,
      });
      const payload = loginTicket.getPayload();
      
      // HARD GATE: Only accept legitimate GCP service account identities.
      if (
        payload && 
        payload.email && 
        payload.email.endsWith(".gserviceaccount.com")
      ) {
        return {
          user: { uid: payload.sub, email: payload.email },
          response: null,
        };
      }
    } catch (oidcErr) {
      // Ignore OIDC error and fall back to original logging
    }

    console.warn(
      JSON.stringify({
        severity: "WARNING",
        component: "auth_middleware",
        event: "token_rejected",
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      }),
    );

    return {
      user: null,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }
}

import { randomUUID } from "node:crypto";

type LiveEmitSession = {
  id: string;
  token: string;
  mode: string;
  createdAt: number;
  expiresAt: number;
  stoppedAt: number | null;
};

const DEFAULT_TTL_MS = Number(process.env.LIVE_EMIT_SESSION_TTL_MS || 15 * 60 * 1000);
const MAX_RUNTIME_MS = Number(process.env.LIVE_EMIT_MAX_RUNTIME_MS || 90 * 1000);
const sessions = new Map<string, LiveEmitSession>();

function cleanupExpiredSessions(now = Date.now()): void {
  for (const [id, session] of sessions.entries()) {
    if (session.stoppedAt || session.expiresAt <= now) {
      sessions.delete(id);
    }
  }
}

export function getMaxLiveEmitRuntimeMs(): number {
  return MAX_RUNTIME_MS;
}

export function createLiveEmitSession(mode: string): LiveEmitSession {
  cleanupExpiredSessions();
  const now = Date.now();
  const session: LiveEmitSession = {
    id: `live_${randomUUID()}`,
    token: randomUUID(),
    mode: mode || "code",
    createdAt: now,
    expiresAt: now + DEFAULT_TTL_MS,
    stoppedAt: null,
  };
  sessions.set(session.id, session);
  return session;
}

export function getLiveEmitSession(sessionId: string, sessionToken?: string): LiveEmitSession | null {
  cleanupExpiredSessions();
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (!sessionToken || session.token !== sessionToken) return null;
  if (session.stoppedAt) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

export function stopLiveEmitSession(sessionId: string, sessionToken?: string): boolean {
  cleanupExpiredSessions();
  const session = sessions.get(sessionId);
  if (!session) return false;
  if (!sessionToken || session.token !== sessionToken) return false;
  session.stoppedAt = Date.now();
  sessions.set(session.id, session);
  return true;
}

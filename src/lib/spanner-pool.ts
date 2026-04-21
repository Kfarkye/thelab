// ── Spanner Connection Pool Singleton ─────────────────────────────
// Replaces 13 independent `new Spanner()` calls with a single
// gRPC channel pool. Uses `globalThis` to survive Next.js Fast
// Refresh without leaking connections in development.
//
// NEVER call .close() on a handle returned by getDb().

import { Spanner } from "@google-cloud/spanner";
import { GOOGLE_CLOUD_PROJECT, SPANNER_INSTANCE } from "./env";

type SpannerPoolState = {
  client?: Spanner;
  dbCache?: Map<string, ReturnType<ReturnType<Spanner["instance"]>["database"]>>;
};

const g = globalThis as typeof globalThis & { __spannerPool?: SpannerPoolState };
g.__spannerPool ??= {};

/** Shared Spanner client — one gRPC channel pool per process. */
export const spannerClient: Spanner = (g.__spannerPool.client ??= new Spanner({
  projectId: GOOGLE_CLOUD_PROJECT,
}));

const dbCache = (g.__spannerPool.dbCache ??= new Map());

/**
 * Returns a shared, multiplexed database handle.
 * NEVER call .close() on the returned object.
 *
 * @param databaseId - One of: recruitingdb, sportsdb, worldcupdb, licensingdb, credentialdb
 * @param instanceId - Defaults to SPANNER_INSTANCE env var
 */
export function getDb(
  databaseId: string,
  instanceId: string = SPANNER_INSTANCE,
) {
  const cacheKey = `${instanceId}/${databaseId}`;

  if (!dbCache.has(cacheKey)) {
    const db = spannerClient.instance(instanceId).database(databaseId);
    dbCache.set(cacheKey, db);

    console.log(
      JSON.stringify({
        severity: "INFO",
        component: "spanner_pool",
        event: "db_handle_created",
        database: cacheKey,
        project: GOOGLE_CLOUD_PROJECT,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  return dbCache.get(cacheKey)!;
}

// ── Convenience Accessors ────────────────────────────────────────

/** recruitingdb — AyaOps candidates, assignments, notes, activities */
export function getRecruitingDb() {
  return getDb("recruitingdb");
}

/** sportsdb — Games, teams, odds, previews */
export function getSportsDb() {
  return getDb("sportsdb");
}

/** worldcupdb — WC fixtures, teams, previews */
export function getWorldcupDb() {
  return getDb("worldcupdb");
}

/** licensingdb — Licenses, fees, research ledger */
export function getLicensingDb() {
  return getDb("licensingdb");
}

/** credentialdb — User accounts, credentials */
export function getCredentialDb() {
  return getDb("credentialdb");
}

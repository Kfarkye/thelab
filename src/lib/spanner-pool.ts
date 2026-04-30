// ── Spanner Connection Pool Singleton ─────────────────────────────
// Replaces 13 independent `new Spanner()` calls with a single
// gRPC channel pool. Uses `globalThis` to survive Next.js Fast
// Refresh without leaking connections in development.
//
// NEVER call .close() on a handle returned by getDb().

import { createRequire } from "node:module";
import { requireEnv } from "./env";

type Database = {
  close?: () => Promise<void> | void;
  run: (...args: any[]) => Promise<any[]>;
  runTransactionAsync: (...args: any[]) => Promise<any>;
  [key: string]: any;
};

type Spanner = {
  instance: (instanceId: string) => {
    database: (databaseId: string) => Database;
  };
  close?: () => Promise<void> | void;
};

type SpannerPoolState = {
  client?: Spanner;
  dbCache?: Map<string, Database>;
};

const g = globalThis as typeof globalThis & { __spannerPool?: SpannerPoolState };
g.__spannerPool ??= {};

const dbCache = (g.__spannerPool.dbCache ??= new Map());
const nodeRequire = createRequire(import.meta.url);

function normalizeDbOverrideEnv(): void {
  const legacy = process.env.DB_OVER_RIDE;
  const primary = process.env.DB_OVERRIDE;

  if (legacy && !primary) {
    process.env.DB_OVERRIDE = legacy;
  }

  if (legacy) {
    delete process.env.DB_OVER_RIDE;
  }
}

normalizeDbOverrideEnv();

function getSpannerClient(): Spanner {
  if (!g.__spannerPool?.client) {
    const { Spanner: SpannerCtor } = nodeRequire("@google-cloud/spanner") as {
      Spanner: new (options: { projectId: string }) => Spanner;
    };
    g.__spannerPool ??= {};
    g.__spannerPool.client = new SpannerCtor({
      projectId: requireEnv("GOOGLE_CLOUD_PROJECT"),
    });
  }

  return g.__spannerPool.client;
}

/** Shared Spanner client, one gRPC channel pool per process. */
export const spannerClient: Spanner = new Proxy({} as Spanner, {
  get(_target, prop) {
    const client = getSpannerClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/**
 * Returns a shared, multiplexed database handle.
 * NEVER call .close() on the returned object.
 *
 * @param databaseId - One of: recruitingdb, sportsdb, worldcupdb, licensingdb, credentialdb
 * @param instanceId - Defaults to SPANNER_INSTANCE_ID env var
 */
export function getDb(
  databaseId: string,
  instanceId?: string,
): Database {
  normalizeDbOverrideEnv();

  const nodeEnv = process.env.NODE_ENV;
  const dbOverride = process.env.DB_OVERRIDE;

  if (dbOverride && nodeEnv === "production") {
    throw new Error("SECURITY_VIOLATION: DB_OVERRIDE prohibited in Production");
  }

  const effectiveDatabaseId = nodeEnv !== "production" && dbOverride ? dbOverride : databaseId;
  const effectiveInstanceId = instanceId || requireEnv("SPANNER_INSTANCE_ID");
  const cacheKey = `${effectiveInstanceId}/${effectiveDatabaseId}`;

  if (!dbCache.has(cacheKey)) {
    const db = getSpannerClient().instance(effectiveInstanceId).database(effectiveDatabaseId);
    dbCache.set(cacheKey, db);

    console.log(
      JSON.stringify({
        severity: "INFO",
        component: "spanner_pool",
        event: "db_handle_created",
        database: effectiveDatabaseId,
        instance: effectiveInstanceId,
        project: requireEnv("GOOGLE_CLOUD_PROJECT"),
        timestamp: new Date().toISOString(),
      }),
    );
  }

  return dbCache.get(cacheKey)!;
}

/**
 * Closes every tracked Spanner database handle and clears the lazy singleton.
 * Intended for tests and process teardown only.
 */
export async function closeAllDbs(): Promise<void> {
  const databases = Array.from(dbCache.values());
  await Promise.all(
    databases.map(async (db) => {
      const maybeClose = (db as Database & { close?: () => Promise<void> | void }).close;
      if (typeof maybeClose === "function") {
        await maybeClose.call(db);
      }
    }),
  );
  dbCache.clear();

  const client = g.__spannerPool?.client as (Spanner & { close?: () => Promise<void> | void }) | undefined;
  if (client && typeof client.close === "function") {
    await client.close();
  }

  if (g.__spannerPool) {
    delete g.__spannerPool.client;
  }
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

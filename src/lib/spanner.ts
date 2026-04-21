// ── Legacy Spanner singleton — delegates to spanner-pool.ts ─────
// This file exists for backward compatibility with code that imports
// from "@/lib/spanner". All new code should import from "@/lib/spanner-pool".

import { getCredentialDb, spannerClient } from "./spanner-pool";

export function getSpanner() {
  return spannerClient;
}

/** @deprecated — import getDb/getCredentialDb from "@/lib/spanner-pool" instead. */
export function getDb() {
  return getCredentialDb();
}

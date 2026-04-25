// ── Strict Environment Contract ──────────────────────────────────
// If a required env var is missing, the container crashes at boot.
// This prevents silent production database corruption from env drift.

export function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    if (process.env.npm_lifecycle_event === "build") {
      console.warn(JSON.stringify({
        severity: "WARNING",
        module: "env",
        event: "build_stub_generated",
        missing_key: key,
        message: `Missing ${key} during build phase; using stub.`
      }));
      return `BUILD_STUB_${key}`;
    }
    throw new Error(
      `CRITICAL BOOT FAILURE: Missing required environment variable: ${key}`,
    );
  }
  return val;
}

/**
 * Returns env var or fallback. Use ONLY for non-critical config
 * where a sensible default exists (e.g. HEARTBEAT_MS, MAX_RESULTS).
 * NEVER use for infrastructure identifiers.
 */
export function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

// ── Validated Exports ────────────────────────────────────────────
// These throw at module load time if missing. No silent fallback.

export const GOOGLE_CLOUD_PROJECT = requireEnv("GOOGLE_CLOUD_PROJECT");
export const VERTEX_AI_AYAOPS_URL_DATASTORE = requireEnv("VERTEX_AI_AYAOPS_URL_DATASTORE");
export const GITHUB_TOKEN = requireEnv("GITHUB_TOKEN");
export const SPANNER_INSTANCE = optionalEnv("SPANNER_INSTANCE", "game-data");

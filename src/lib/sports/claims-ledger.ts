import { getSportsDb } from "@/lib/spanner-pool";
import { buildGovernedClaim } from "@/lib/sports/builder";
import { resolveClaimSet } from "@/lib/sports/resolver";
import type {
  ClaimStatus,
  RawExtraction,
  SourcePolicy,
  SportsClaim,
} from "@/lib/sports/types";

type RowLike = { toJSON: () => Record<string, unknown> };
type TxLike = {
  run: (query: {
    sql: string;
    params?: Record<string, unknown>;
    types?: Record<string, unknown>;
  }) => Promise<[RowLike[]]>;
  runUpdate: (query: {
    sql: string;
    params?: Record<string, unknown>;
    types?: Record<string, unknown>;
  }) => Promise<number>;
};

export type GovernedClaimIngestItem = {
  source_policy_id: string;
  extraction: RawExtraction;
};

export type GovernedClaimIngestResult = {
  total: number;
  succeeded: number;
  failed: number;
  by_status: Record<string, number>;
  items: Array<{
    source_policy_id: string;
    claim_key: string;
    claim_id: string | null;
    status: "INGESTED" | "ERROR";
    final_claim_status: ClaimStatus | null;
    reason: string | null;
  }>;
};

const MAX_ITEMS_PER_REQUEST = 250;
const ACTIVE_CLAIM_STATUSES = ["ACTIVE", "VERIFIED", "CONFLICT"] as const;

function readString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const nested =
      record.value ??
      record.stringValue ??
      record.integerValue ??
      record.numberValue ??
      record.floatValue ??
      record.boolValue;
    if (nested !== undefined) return readString(nested);
  }
  return "";
}

function readNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function toIso(value: unknown): string {
  const raw = value instanceof Date ? value.toISOString() : readString(value);
  const parsed = new Date(raw || Date.now());
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function parseSourcePolicy(row: Record<string, unknown>): SourcePolicy {
  const allowedRaw =
    Array.isArray(row.allowed_claim_types)
      ? row.allowed_claim_types
      : [];

  return {
    source_policy_id: readString(row.source_policy_id),
    approved_domain: readString(row.approved_domain),
    source_name: readString(row.source_name),
    source_kind: readString(row.source_kind),
    priority: Number(readNumber(row.priority) ?? 0),
    allowed_claim_types: allowedRaw.map((v) => readString(v)).filter(Boolean),
    default_stale_seconds: Number(readNumber(row.default_stale_seconds) ?? 0),
    visibility_tier: (readString(row.visibility_tier).toUpperCase() || "PUBLIC") as SourcePolicy["visibility_tier"],
    status: (readString(row.status).toUpperCase() || "INACTIVE") as SourcePolicy["status"],
    schema_version: readString(row.schema_version) || undefined,
  };
}

function parseSportsClaim(row: Record<string, unknown>): SportsClaim {
  return {
    claim_id: readString(row.claim_id),
    claim_key: readString(row.claim_key),
    league: readString(row.league),
    entity_id: readString(row.entity_id),
    claim_type: readString(row.claim_type),
    source_policy_id: readString(row.source_policy_id),
    source_name: readString(row.source_name),
    source_priority: Number(readNumber(row.source_priority) ?? 0),
    source_url: readString(row.source_url),
    payload_hash: readString(row.payload_hash),
    status: (readString(row.status).toUpperCase() || "ACTIVE") as ClaimStatus,
    visibility_tier: (readString(row.visibility_tier).toUpperCase() || "PUBLIC") as SportsClaim["visibility_tier"],
    observed_at: toIso(row.observed_at),
    source_time_status: (readString(row.source_time_status).toUpperCase() || "INFERRED") as SportsClaim["source_time_status"],
    ingested_at: toIso(row.ingested_at),
    stale_at: toIso(row.stale_at),
    governance_commit: readString(row.governance_commit),
    public_display_statement: readString(row.public_display_statement),
    internal_statement: readString(row.internal_statement),
    structured_payload: readJsonObject(row.structured_payload) || {},
  };
}

async function loadPoliciesById(policyIds: string[]): Promise<Map<string, SourcePolicy>> {
  const db = getSportsDb();
  const [rows] = await db.run({
    sql: `SELECT
            source_policy_id,
            approved_domain,
            source_name,
            source_kind,
            priority,
            allowed_claim_types,
            default_stale_seconds,
            visibility_tier,
            status,
            schema_version
          FROM SourceRegistry
          WHERE source_policy_id IN UNNEST(@policyIds)`,
    params: { policyIds },
  });

  const policies = new Map<string, SourcePolicy>();
  for (const rowLike of rows) {
    const row = rowLike.toJSON();
    const policy = parseSourcePolicy(row);
    if (!policy.source_policy_id) continue;
    policies.set(policy.source_policy_id, policy);
  }
  return policies;
}

async function loadClaimsForKey(tx: TxLike, claimKey: string): Promise<SportsClaim[]> {
  const [rows] = await tx.run({
    sql: `SELECT
            claim_id,
            claim_key,
            league,
            entity_id,
            claim_type,
            source_policy_id,
            source_name,
            source_priority,
            source_url,
            payload_hash,
            status,
            visibility_tier,
            observed_at,
            source_time_status,
            ingested_at,
            stale_at,
            governance_commit,
            public_display_statement,
            internal_statement,
            structured_payload
          FROM SportsClaims
          WHERE claim_key = @claimKey
            AND status IN UNNEST(@statuses)`,
    params: {
      claimKey,
      statuses: [...ACTIVE_CLAIM_STATUSES],
    },
  });

  return rows.map((rowLike: RowLike) => parseSportsClaim(rowLike.toJSON()));
}

async function upsertClaim(
  tx: TxLike,
  claim: SportsClaim,
  finalStatus: ClaimStatus,
): Promise<void> {
  await tx.runUpdate({
    sql: `INSERT OR UPDATE INTO SportsClaims (
            claim_id,
            claim_key,
            league,
            entity_id,
            claim_type,
            source_policy_id,
            source_name,
            source_priority,
            source_url,
            payload_hash,
            status,
            visibility_tier,
            observed_at,
            source_time_status,
            ingested_at,
            stale_at,
            governance_commit,
            public_display_statement,
            internal_statement,
            structured_payload
          ) VALUES (
            @claim_id,
            @claim_key,
            @league,
            @entity_id,
            @claim_type,
            @source_policy_id,
            @source_name,
            @source_priority,
            @source_url,
            @payload_hash,
            @status,
            @visibility_tier,
            @observed_at,
            @source_time_status,
            PENDING_COMMIT_TIMESTAMP(),
            @stale_at,
            @governance_commit,
            @public_display_statement,
            @internal_statement,
            CAST(@structured_payload AS JSON)
          )`,
    params: {
      claim_id: claim.claim_id,
      claim_key: claim.claim_key,
      league: claim.league,
      entity_id: claim.entity_id,
      claim_type: claim.claim_type,
      source_policy_id: claim.source_policy_id,
      source_name: claim.source_name,
      source_priority: claim.source_priority,
      source_url: claim.source_url,
      payload_hash: claim.payload_hash,
      status: finalStatus,
      visibility_tier: claim.visibility_tier,
      observed_at: new Date(claim.observed_at),
      source_time_status: claim.source_time_status,
      stale_at: new Date(claim.stale_at),
      governance_commit: claim.governance_commit,
      public_display_statement: claim.public_display_statement,
      internal_statement: claim.internal_statement,
      structured_payload: JSON.stringify(claim.structured_payload || {}),
    },
  });
}

async function updateClaimStatus(
  tx: TxLike,
  claimId: string,
  status: ClaimStatus,
): Promise<void> {
  await tx.runUpdate({
    sql: `UPDATE SportsClaims
          SET status = @status,
              ingested_at = PENDING_COMMIT_TIMESTAMP()
          WHERE claim_id = @claimId`,
    params: {
      claimId,
      status,
    },
  });
}

export async function ingestGovernedClaims(
  rawItems: GovernedClaimIngestItem[],
): Promise<GovernedClaimIngestResult> {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error("items must be a non-empty array");
  }
  if (rawItems.length > MAX_ITEMS_PER_REQUEST) {
    throw new Error(`items exceeds max of ${MAX_ITEMS_PER_REQUEST}`);
  }

  const policyIds = Array.from(
    new Set(
      rawItems.map((item) => readString(item.source_policy_id)).filter(Boolean),
    ),
  );
  const policiesById = await loadPoliciesById(policyIds);
  const db = getSportsDb();

  const byStatus: Record<string, number> = {};
  const items: GovernedClaimIngestResult["items"] = [];
  let succeeded = 0;
  let failed = 0;

  for (const item of rawItems) {
    const sourcePolicyId = readString(item.source_policy_id);
    const claimKey = readString(item?.extraction?.claim_key);

    if (!sourcePolicyId || !item.extraction) {
      failed += 1;
      items.push({
        source_policy_id: sourcePolicyId,
        claim_key: claimKey,
        claim_id: null,
        status: "ERROR",
        final_claim_status: null,
        reason: "Invalid item: source_policy_id and extraction are required.",
      });
      continue;
    }

    const policy = policiesById.get(sourcePolicyId);
    if (!policy) {
      failed += 1;
      items.push({
        source_policy_id: sourcePolicyId,
        claim_key: claimKey,
        claim_id: null,
        status: "ERROR",
        final_claim_status: null,
        reason: `Unknown source policy: ${sourcePolicyId}`,
      });
      continue;
    }

    try {
      const governed = await buildGovernedClaim(item.extraction, policy);
      let finalClaimStatus: ClaimStatus = "ACTIVE";

      await db.runTransactionAsync(async (tx: any) => {
        const existingClaims = await loadClaimsForKey(tx as TxLike, governed.claim_key);
        const resolution = resolveClaimSet([...existingClaims, governed]);

        if (resolution.outcome === "CONFLICT") {
          finalClaimStatus = "CONFLICT";
          for (const conflict of resolution.conflicts) {
            if (conflict.claim_id === governed.claim_id) continue;
            if (conflict.status !== "CONFLICT") {
              await updateClaimStatus(tx as TxLike, conflict.claim_id, "CONFLICT");
            }
          }
        } else if (resolution.outcome === "EMPTY") {
          finalClaimStatus = "STALE";
        } else {
          const winnerId = resolution.winner?.claim_id || null;
          finalClaimStatus = winnerId === governed.claim_id ? "ACTIVE" : "SUPERSEDED";

          if (winnerId === governed.claim_id) {
            for (const superseded of resolution.superseded) {
              if (superseded.claim_id === governed.claim_id) continue;
              if (superseded.status !== "SUPERSEDED") {
                await updateClaimStatus(tx as TxLike, superseded.claim_id, "SUPERSEDED");
              }
            }
          }
        }

        await upsertClaim(tx as TxLike, governed, finalClaimStatus);
      });

      byStatus[finalClaimStatus] = (byStatus[finalClaimStatus] || 0) + 1;
      succeeded += 1;
      items.push({
        source_policy_id: sourcePolicyId,
        claim_key: governed.claim_key,
        claim_id: governed.claim_id,
        status: "INGESTED",
        final_claim_status: finalClaimStatus,
        reason: null,
      });
    } catch (error) {
      failed += 1;
      items.push({
        source_policy_id: sourcePolicyId,
        claim_key: claimKey,
        claim_id: null,
        status: "ERROR",
        final_claim_status: null,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    total: rawItems.length,
    succeeded,
    failed,
    by_status: byStatus,
    items,
  };
}

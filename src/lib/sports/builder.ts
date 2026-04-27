import { createHash } from 'crypto';
import { requireEnv } from '@/lib/env';
import { SportsClaim, SourcePolicy, RawExtraction } from './types';

const MAX_STALE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const MIN_STALE_SECONDS = 60; // 1 minute

function getCanonicalHash(obj: Record<string, unknown>): string {
  const deepSort = (val: unknown): unknown => {
    if (val === null || typeof val !== 'object') return val;
    if (Array.isArray(val)) return val.map(deepSort);
    const typedVal = val as Record<string, unknown>;
    return Object.keys(typedVal).sort().reduce((acc: Record<string, unknown>, key) => {
      acc[key] = deepSort(typedVal[key]);
      return acc;
    }, {});
  };
  return createHash('sha256').update(JSON.stringify(deepSort(obj))).digest('hex');
}

function sanitize(segment: string): string {
  return segment.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
}

function toCanonicalHost(input: string): string {
  return input.trim().toLowerCase().replace(/\.$/, "");
}

function parseObservedAt(rawObservedAt?: string): { observedAt: Date; sourceTimeStatus: "EXTRACTED" | "INFERRED" } {
  if (!rawObservedAt) {
    return { observedAt: new Date(), sourceTimeStatus: "INFERRED" };
  }

  const observedAt = new Date(rawObservedAt);
  if (Number.isNaN(observedAt.getTime())) {
    throw new Error(`Invalid source_observed_at: ${rawObservedAt}`);
  }
  // Reject materially future timestamps that can break stale ordering.
  if (observedAt.getTime() > Date.now() + 5 * 60 * 1000) {
    throw new Error(`source_observed_at is in the future: ${rawObservedAt}`);
  }
  return { observedAt, sourceTimeStatus: "EXTRACTED" };
}

function assertClaimShape(raw: RawExtraction): void {
  if (!raw.claim_key?.trim()) throw new Error("claim_key is required");
  if (!raw.league?.trim()) throw new Error("league is required");
  if (!raw.entity_id?.trim()) throw new Error("entity_id is required");
  if (!raw.claim_type?.trim()) throw new Error("claim_type is required");
  if (!raw.source_url?.trim()) throw new Error("source_url is required");
  if (!raw.public_display?.trim()) throw new Error("public_display is required");
  if (!raw.statement?.trim()) throw new Error("statement is required");
  if (!raw.structured_value || typeof raw.structured_value !== "object" || Array.isArray(raw.structured_value)) {
    throw new Error("structured_value must be a JSON object");
  }
}

function assertPolicyShape(policy: SourcePolicy): void {
  if (!policy.approved_domain?.trim()) {
    throw new Error(`Policy ${policy.source_policy_id} missing approved_domain`);
  }
  if (!Number.isFinite(policy.priority) || policy.priority < 0) {
    throw new Error(`Policy ${policy.source_policy_id} has invalid priority=${policy.priority}`);
  }
  if (policy.status !== "ACTIVE") {
    throw new Error(`Policy ${policy.source_policy_id} is not active`);
  }
  if (!Array.isArray(policy.allowed_claim_types) || policy.allowed_claim_types.length === 0) {
    throw new Error(`Policy ${policy.source_policy_id} has no allowed claim types`);
  }
  if (
    !Number.isFinite(policy.default_stale_seconds) ||
    policy.default_stale_seconds < MIN_STALE_SECONDS ||
    policy.default_stale_seconds > MAX_STALE_SECONDS
  ) {
    throw new Error(
      `Policy ${policy.source_policy_id} has invalid default_stale_seconds=${policy.default_stale_seconds}`,
    );
  }
}

function validateSourceDomain(sourceUrl: string, approvedDomain: string, sourcePolicyId: string): string {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error(`Invalid source_url: ${sourceUrl}`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`Non-https source_url rejected for ${sourcePolicyId}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`Credentialed source_url rejected for ${sourcePolicyId}`);
  }
  parsed.hash = "";

  const hostname = toCanonicalHost(parsed.hostname);
  const approved = toCanonicalHost(approvedDomain);
  const isApproved = hostname === approved || hostname.endsWith(`.${approved}`);
  if (!isApproved) throw new Error(`Domain ${hostname} not approved for policy ${sourcePolicyId}`);

  return parsed.toString();
}

export async function buildGovernedClaim(
  raw: RawExtraction,
  policy: SourcePolicy
): Promise<SportsClaim> {
  assertClaimShape(raw);
  assertPolicyShape(policy);

  const canonicalClaimType = raw.claim_type.trim().toUpperCase();
  const allowedClaimTypes = policy.allowed_claim_types.map((t) => t.trim().toUpperCase());
  if (!allowedClaimTypes.includes(canonicalClaimType)) {
    throw new Error(`Policy ${policy.source_policy_id} does not permit ${raw.claim_type}`);
  }

  const canonicalSourceUrl = validateSourceDomain(raw.source_url, policy.approved_domain, policy.source_policy_id);
  const { observedAt, sourceTimeStatus } = parseObservedAt(raw.source_observed_at);

  const payloadHash = getCanonicalHash(raw.structured_value);
  const staleAt = new Date(observedAt.getTime() + policy.default_stale_seconds * 1000);
  const safeLeague = sanitize(raw.league).slice(0, 24) || "UNKNOWN";
  const safeClaimType = sanitize(canonicalClaimType).slice(0, 40) || "UNKNOWN";
  const safeEntityId = sanitize(raw.entity_id).slice(0, 64) || "UNKNOWN";
  const claimId = `DRIP.CLAIM.${safeLeague}.${safeClaimType}.${safeEntityId}.${payloadHash.slice(0, 12)}`;

  return {
    claim_id: claimId,
    claim_key: raw.claim_key.trim(),
    league: raw.league.trim(),
    entity_id: raw.entity_id.trim(),
    claim_type: canonicalClaimType,
    source_policy_id: policy.source_policy_id,
    source_name: policy.source_name,
    source_priority: policy.priority,
    source_url: canonicalSourceUrl,
    payload_hash: payloadHash,
    status: "ACTIVE",
    visibility_tier: policy.visibility_tier,
    observed_at: observedAt.toISOString(),
    source_time_status: sourceTimeStatus,
    stale_at: staleAt.toISOString(),
    governance_commit: requireEnv('SOURCE_COMMIT_SHA'),
    public_display_statement: raw.public_display.trim(),
    internal_statement: raw.statement.trim(),
    structured_payload: raw.structured_value,
  };
}

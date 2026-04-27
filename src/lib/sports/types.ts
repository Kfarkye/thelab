export type LiveSituation = {
  current_play: string;
  batter_id: string;
  pitcher_id: string;
  inning: number;
  half: "TOP" | "BOTTOM";
  outs: number;
  balls: number;
  strikes: number;
  bases: {
    first: boolean;
    second: boolean;
    third: boolean;
  };
  last_updated: string;
};

export type SourceTimeStatus = "EXTRACTED" | "INFERRED";
export type ClaimVisibilityTier = "PUBLIC" | "PAID" | "INTERNAL";
export type ClaimStatus =
  | "ACTIVE"
  | "VERIFIED"
  | "SUPERSEDED"
  | "STALE"
  | "CONFLICT"
  | "RETRACTED"
  | "ARCHIVED";

export type SportsClaim = {
  claim_id: string;
  claim_key: string;
  league: string;
  entity_id: string;
  claim_type: string;
  source_policy_id: string;
  source_name: string;
  source_priority: number;
  source_url: string;
  payload_hash: string;
  status: ClaimStatus;
  visibility_tier: ClaimVisibilityTier;
  observed_at: string;
  source_time_status: SourceTimeStatus;
  ingested_at?: string;
  stale_at: string;
  governance_commit: string;
  public_display_statement: string;
  internal_statement: string;
  structured_payload: Record<string, unknown>;
};

export type SourcePolicy = {
  source_policy_id: string;
  approved_domain: string;
  source_name: string;
  source_kind: string;
  priority: number;
  allowed_claim_types: string[];
  default_stale_seconds: number;
  visibility_tier: ClaimVisibilityTier;
  status: "ACTIVE" | "INACTIVE";
  schema_version?: string;
};

export type RawExtraction = {
  claim_key: string;
  league: string;
  entity_id: string;
  claim_type: string;
  source_url: string;
  source_observed_at?: string;
  public_display: string;
  statement: string;
  structured_value: Record<string, unknown>;
};

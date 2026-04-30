export type PackagePhase = "unattached" | "candidate_attached" | "margin_created";

export interface PackageObject {
  package_id: string;
  record_phase: PackagePhase;
  facility: string | null;
  specialty: string | null;
  normalized_specialty: string | null;
  location: {
    city: string | null;
    state: string | null;
    zip: string | null;
    lat: number | null;
    lng: number | null;
  };
  pay_range: { min: number | null; max: number | null };
  weekly_gross: number | null;
  shift: string | null;
  start_date: string | null;
  duration_weeks: number | null;
  job_description: string | null;
  requirements: string[];
  flags: string[];
}

export interface CandidateObject {
  candidate_id: string;
  candidate_name: string;
  nova_url: string;
  specialty: string | null;
  normalized_specialty: string | null;
  home_city: string | null;
  home_state: string | null;
  home_lat: number | null;
  home_lng: number | null;
  license_states: string[];
  available_date: string | null;
  bucket: "already_mine" | "claimable" | "protected" | "excluded";
}

export interface MatchObject {
  match_id: string;
  match_score: number;
  match_bucket: "closest_qualified" | "qualified_nearby" | "qualified_travel" | "needs_review";
  distance_miles: number | null;
  reasons: string[];
  risk_flags: string[];
}

export interface CandidateMatchResult extends MatchObject {
  candidate: CandidateObject;
}

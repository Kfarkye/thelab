import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getRecruitingDb } from "@/lib/spanner-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = {
  params: Promise<{ candidateId: string }>;
};

type CandidateSnapshot = {
  source: "nova_candidate_profile";
  candidate_id: string;
  internal_candidate_uuid: string;
  profile_url: string | null;
  display_name: string;
  legal_name: string | null;
  verified_status: string | null;
  profile_status_tags: string[];
  specialty_title: string | null;
  specialty_experience: Array<{ specialty: string; years: string }>;
  employment_type: string | null;
  contact: {
    primary_phone: string | null;
    alternate_phone: string | null;
    email: string | null;
  };
  addresses: {
    home: string | null;
    current: string | null;
  };
  job_desires: {
    available_date: string | null;
    shift_preference: string | null;
    locations: string[];
  };
  team_info: {
    recruiter: string | null;
    team_leader: string | null;
  };
  quick_notes: {
    candidate_message: string | null;
  };
  assignment: {
    status: string | null;
    start_date: string | null;
    end_date: string | null;
    facility_name: string | null;
    facility_city: string | null;
    facility_state: string | null;
  } | null;
  latest_submittal: {
    status: string | null;
    submitted_at: string | null;
    interview_date: string | null;
    offer_date: string | null;
  } | null;
  source_url: string;
  generated_at: string;
};

function readString(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function toIsoString(value: unknown): string | null {
  const str = readString(value);
  if (!str) return null;
  const date = new Date(str);
  if (Number.isNaN(date.getTime())) return str;
  return date.toISOString();
}

async function loadCandidateSnapshot(candidateInput: string): Promise<CandidateSnapshot | null> {
  const db = getRecruitingDb();
  const [candidateRows] = await db.run({
    sql: `
      SELECT
        id,
        nova_id,
        first_name,
        last_name,
        email,
        phone,
        specialty,
        profession,
        home_state,
        compliance_risk_level,
        source
      FROM hc_candidates
      WHERE id = @candidateInput
         OR CAST(nova_id AS STRING) = @candidateInput
      LIMIT 1
    `,
    params: { candidateInput },
  });

  if (!candidateRows.length) return null;

  const candidate = (candidateRows[0] as any).toJSON();
  const candidateId = String(candidate.id);
  const novaId = readString(candidate.nova_id);
  const displayName = [readString(candidate.first_name), readString(candidate.last_name)]
    .filter(Boolean)
    .join(" ")
    .trim();

  const [assignmentRows] = await db.run({
    sql: `
      SELECT
        status,
        start_date,
        end_date,
        facility_name,
        facility_city,
        facility_state
      FROM (
        SELECT
          a.status,
          a.start_date,
          a.end_date,
          f.name AS facility_name,
          f.city AS facility_city,
          f.state AS facility_state
        FROM hc_assignments a
        LEFT JOIN hc_facilities f ON f.id = a.facility_id
        WHERE a.candidate_id = @candidateId
        ORDER BY
          CASE
            WHEN LOWER(a.status) IN ('active', 'pending_start', 'in_pipeline') THEN 0
            WHEN LOWER(a.status) IN ('completed', 'cancelled') THEN 1
            ELSE 2
          END,
          COALESCE(a.end_date, '9999-12-31') DESC,
          COALESCE(a.start_date, '0001-01-01') DESC
      )
      LIMIT 1
    `,
    params: { candidateId },
  });

  const [submittalRows] = await db.run({
    sql: `
      SELECT status, submitted_at, interview_date, offer_date
      FROM hc_submittals
      WHERE candidate_id = @candidateId
      ORDER BY submitted_at DESC, created_at DESC
      LIMIT 1
    `,
    params: { candidateId },
  });

  const [activityRows] = await db.run({
    sql: `
      SELECT
        MAX(created_at) AS last_outbound_activity_at
      FROM activities
      WHERE candidate_id = @candidateId
        AND direction = 'outbound'
    `,
    params: { candidateId },
  });

  const assignment = assignmentRows.length > 0 ? (assignmentRows[0] as any).toJSON() : null;
  const submittal = submittalRows.length > 0 ? (submittalRows[0] as any).toJSON() : null;
  const activity = activityRows.length > 0 ? (activityRows[0] as any).toJSON() : null;

  const hdrs = await headers();
  const host = readString(hdrs.get("x-forwarded-host")) || readString(hdrs.get("host"));
  const protocol = readString(hdrs.get("x-forwarded-proto")) || "https";
  const sourceUrl = host
    ? `${protocol}://${host}/c/${encodeURIComponent(candidateInput)}`
    : `/c/${encodeURIComponent(candidateInput)}`;

  const snapshot: CandidateSnapshot = {
    source: "nova_candidate_profile",
    candidate_id: novaId || candidateId,
    internal_candidate_uuid: candidateId,
    profile_url: novaId
      ? `https://nova.ayahealthcare.com/#/recruiting/candidates/${novaId}/new-profile/about`
      : null,
    display_name: displayName || "Unknown Candidate",
    legal_name: displayName ? displayName.toUpperCase() : null,
    verified_status: "Verified",
    profile_status_tags: [readString(assignment?.status) || "Unknown", "Live", "URL Grounded"],
    specialty_title: readString(candidate.specialty),
    specialty_experience: readString(candidate.specialty)
      ? [{ specialty: String(candidate.specialty), years: "Unknown" }]
      : [],
    employment_type: null,
    contact: {
      primary_phone: readString(candidate.phone),
      alternate_phone: readString(candidate.phone),
      email: readString(candidate.email),
    },
    addresses: {
      home: readString(candidate.home_state),
      current: readString(candidate.home_state),
    },
    job_desires: {
      available_date: null,
      shift_preference: null,
      locations: readString(candidate.home_state) ? [String(candidate.home_state)] : [],
    },
    team_info: {
      recruiter: null,
      team_leader: null,
    },
    quick_notes: {
      candidate_message: readString(activity?.last_outbound_activity_at)
        ? `Last outbound activity at ${toIsoString(activity?.last_outbound_activity_at)}`
        : null,
    },
    assignment: assignment
      ? {
          status: readString(assignment.status),
          start_date: toIsoString(assignment.start_date),
          end_date: toIsoString(assignment.end_date),
          facility_name: readString(assignment.facility_name),
          facility_city: readString(assignment.facility_city),
          facility_state: readString(assignment.facility_state),
        }
      : null,
    latest_submittal: submittal
      ? {
          status: readString(submittal.status),
          submitted_at: toIsoString(submittal.submitted_at),
          interview_date: toIsoString(submittal.interview_date),
          offer_date: toIsoString(submittal.offer_date),
        }
      : null,
    source_url: sourceUrl,
    generated_at: new Date().toISOString(),
  };

  return snapshot;
}

export default async function CandidateGroundingPage({ params }: Props) {
  const resolvedParams = await params;
  const candidateInput = String(resolvedParams.candidateId || "").trim();
  if (!candidateInput) notFound();

  const snapshot = await loadCandidateSnapshot(candidateInput);
  if (!snapshot) notFound();

  const prettyJson = JSON.stringify(snapshot, null, 2);

  return (
    <main style={{ margin: "0 auto", maxWidth: 960, padding: 24, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
      <h1 style={{ fontSize: 24, margin: "0 0 12px" }}>Candidate Grounding Source</h1>
      <p style={{ margin: "0 0 16px" }}>
        Canonical URL payload for AI grounding. Source URL: <a href={snapshot.source_url}>{snapshot.source_url}</a>
      </p>

      <script
        id="candidate-grounding-json"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: prettyJson }}
      />

      <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", border: "1px solid #ddd", borderRadius: 8, padding: 16, background: "#fafafa" }}>
        {prettyJson}
      </pre>

      <div className="sr-only" aria-hidden="true">
        <p>candidate_id: {snapshot.candidate_id}</p>
        <p>display_name: {snapshot.display_name}</p>
        <p>specialty_title: {snapshot.specialty_title || "unknown"}</p>
        <p>assignment_status: {snapshot.assignment?.status || "unknown"}</p>
        <p>profile_url: {snapshot.profile_url || "none"}</p>
      </div>
    </main>
  );
}

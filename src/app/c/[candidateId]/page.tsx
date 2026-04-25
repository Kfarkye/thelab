import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  loadCandidateSnapshotForIdentifier,
  resolveBaseUrlFromHeaders,
} from "@/lib/ayaops/candidate-grounding-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = {
  params: Promise<{ candidateId: string }>;
};

export default async function CandidateGroundingPage({ params }: Props) {
  const resolvedParams = await params;
  const candidateInput = String(resolvedParams.candidateId || "").trim();
  if (!candidateInput) notFound();

  const requestHeaders = await headers();
  const baseUrl = resolveBaseUrlFromHeaders(requestHeaders);
  const sourceUrl = baseUrl
    ? `${baseUrl}/c/${encodeURIComponent(candidateInput)}`
    : `/c/${encodeURIComponent(candidateInput)}`;
  const loaded = await loadCandidateSnapshotForIdentifier(candidateInput, sourceUrl);
  const snapshot = loaded.snapshot;
  if (!snapshot) notFound();

  const prettyJson = JSON.stringify(snapshot, null, 2);
  const novaUrl = snapshot.profile_url;
  const status = snapshot.assignment?.status || "Unknown";
  const facility = snapshot.assignment?.facility_name;
  const facilityLoc = [snapshot.assignment?.facility_city, snapshot.assignment?.facility_state].filter(Boolean).join(", ");
  const candidateGroundingLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    additionalType: "https://thelab.ai/schema/CandidateProfile",
    identifier: snapshot.candidate_id,
    name: snapshot.display_name,
    jobTitle: snapshot.specialty_title || undefined,
    email: snapshot.contact?.email || undefined,
    telephone: snapshot.contact?.primary_phone || undefined,
    url: sourceUrl,
    sameAs: novaUrl || undefined,
    workLocation: facility
      ? {
          "@type": "Place",
          name: facility,
          address: facilityLoc || undefined,
        }
      : undefined,
    candidate_snapshot: snapshot,
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');

        :root {
          --w-bg: #0c0c0b;
          --w-surface: #141413;
          --w-surface-raised: #1a1a18;
          --w-border: rgba(255,255,255,0.07);
          --w-border-hover: rgba(255,255,255,0.14);
          --w-text: #fafaf7;
          --w-text-muted: #86827a;
          --w-text-dim: #5a5752;
          --w-accent: #B7572E;
          --w-accent-hover: #cf6434;
          --w-accent-glow: rgba(183,87,46,0.12);
          --w-success: #2dd4a0;
          --w-success-bg: rgba(45,212,160,0.08);
          --w-radius-sm: 8px;
          --w-radius-md: 12px;
          --w-radius-lg: 16px;
          --w-radius-full: 100px;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
          background: var(--w-bg);
          color: var(--w-text);
          font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
          -webkit-font-smoothing: antialiased;
        }

        /* ── MD3-shaped buttons with Weissach palette ──────── */
        .w-btn-filled {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          height: 40px;
          padding: 0 24px;
          border-radius: var(--w-radius-full);
          background: var(--w-accent);
          color: #fff;
          font-family: inherit;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.02em;
          border: none;
          cursor: pointer;
          text-decoration: none;
          transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
          box-shadow: 0 2px 8px var(--w-accent-glow);
        }
        .w-btn-filled:hover {
          background: var(--w-accent-hover);
          box-shadow: 0 4px 20px rgba(183,87,46,0.25);
          transform: translateY(-1px);
          text-decoration: none;
        }

        .w-btn-tonal {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          height: 40px;
          padding: 0 24px;
          border-radius: var(--w-radius-full);
          background: var(--w-accent-glow);
          color: var(--w-accent-hover);
          font-family: inherit;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.02em;
          border: 1px solid rgba(183,87,46,0.15);
          cursor: pointer;
          text-decoration: none;
          transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .w-btn-tonal:hover {
          background: rgba(183,87,46,0.18);
          border-color: rgba(183,87,46,0.3);
          transform: translateY(-1px);
          text-decoration: none;
        }

        .w-btn-outlined {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          height: 40px;
          padding: 0 24px;
          border-radius: var(--w-radius-full);
          background: transparent;
          color: var(--w-text-muted);
          font-family: inherit;
          font-size: 13px;
          font-weight: 500;
          letter-spacing: 0.02em;
          border: 1px solid var(--w-border);
          cursor: pointer;
          text-decoration: none;
          transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .w-btn-outlined:hover {
          border-color: var(--w-border-hover);
          color: var(--w-text);
          background: rgba(255,255,255,0.03);
          transform: translateY(-1px);
          text-decoration: none;
        }

        /* ── Cards ─────────────────────────────────── */
        .w-card {
          background: var(--w-surface);
          border-radius: var(--w-radius-md);
          border: 1px solid var(--w-border);
          padding: 20px;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .w-card:hover {
          border-color: var(--w-border-hover);
          box-shadow: 0 4px 24px rgba(0,0,0,0.3);
        }

        .w-chip {
          display: inline-flex;
          align-items: center;
          height: 28px;
          padding: 0 12px;
          border-radius: 6px;
          border: 1px solid var(--w-border);
          background: var(--w-surface-raised);
          font-size: 11px;
          font-weight: 500;
          color: var(--w-text-muted);
          gap: 6px;
        }

        .w-label {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--w-text-dim);
          margin-bottom: 12px;
        }

        .w-field-label {
          font-size: 10px;
          color: var(--w-text-dim);
          margin-bottom: 2px;
        }

        .w-field-value {
          font-size: 14px;
          color: var(--w-text);
          line-height: 1.4;
        }

        .w-divider {
          height: 1px;
          background: var(--w-border);
          margin: 16px 0;
        }

        /* ── Header glow accent ────────────────────── */
        .w-header-card {
          background: var(--w-surface);
          border-radius: var(--w-radius-lg);
          border: 1px solid var(--w-border);
          padding: 28px;
          position: relative;
          overflow: hidden;
        }
        .w-header-card::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 2px;
          background: linear-gradient(90deg, var(--w-accent), transparent 60%);
          opacity: 0.7;
        }
      `}</style>

      <main 
        style={{ maxWidth: 740, margin: "0 auto", padding: "48px 20px" }}
        itemScope 
        itemType="https://schema.org/Person"
      >

        {/* ── Header ─────────────────────────────── */}
        <div className="w-header-card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--w-accent)", marginBottom: 6 }}>
                Candidate Profile
              </p>
              <h1 
                style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.2 }}
                itemProp="name"
                data-agent-field="display_name"
              >
                {snapshot.display_name}
              </h1>
              {snapshot.specialty_title && (
                <p 
                  style={{ fontSize: 14, color: "var(--w-text-muted)", marginTop: 6 }}
                  itemProp="jobTitle"
                  data-agent-field="specialty_title"
                >
                  {snapshot.specialty_title}
                </p>
              )}
              <p style={{ fontSize: 12, color: "var(--w-text-dim)", marginTop: 8 }} data-agent-field="candidate_id">
                ID {snapshot.candidate_id} · {snapshot.source}
              </p>
            </div>

            <div className="w-chip" style={{
              borderColor: status === "Active" ? "rgba(45,212,160,0.25)" : "var(--w-border)",
              color: status === "Active" ? "var(--w-success)" : "var(--w-text-muted)",
              background: status === "Active" ? "var(--w-success-bg)" : "var(--w-surface-raised)",
              flexShrink: 0,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: status === "Active" ? "var(--w-success)" : "var(--w-text-dim)",
              }} />
              {status}
            </div>
          </div>

          {/* Action buttons — clear labels for browser agent */}
          <div style={{ display: "flex", gap: 10, marginTop: 24, flexWrap: "wrap" }} role="group" aria-label="Candidate Actions">
            {novaUrl && (
              <a 
                id="open-nova-profile" 
                href={novaUrl} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="w-btn-filled"
                aria-label={`Open Nova profile for ${snapshot.display_name}`}
                data-agent-action="navigate-nova"
              >
                Open in Nova
              </a>
            )}
            {snapshot.rc_thread_url && (
              <a 
                id="open-ringcentral" 
                href={snapshot.rc_thread_url} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="w-btn-tonal"
                aria-label="View RingCentral messages"
                data-agent-action="navigate-ringcentral"
              >
                View RingCentral
              </a>
            )}
            {snapshot.outlook_thread_url && (
              <a 
                id="open-outlook" 
                href={snapshot.outlook_thread_url} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="w-btn-outlined"
                aria-label="View Outlook emails"
                data-agent-action="navigate-outlook"
              >
                View Outlook
              </a>
            )}
            <a 
              id="view-hub-data" 
              href={`/api/hub/candidates/${encodeURIComponent(snapshot.internal_candidate_uuid || candidateInput)}`} 
              className="w-btn-outlined"
              aria-label="View raw Hub data"
              data-agent-action="view-hub-json"
            >
              View Hub Data
            </a>
          </div>
        </div>

        {/* ── Info Cards Grid ────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>

          {/* Contact */}
          <div className="w-card" id="contact-info">
            <p className="w-label">Contact</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {snapshot.contact?.email && (
                <div>
                  <p className="w-field-label">Email</p>
                  <p className="w-field-value" itemProp="email" data-agent-field="email">{snapshot.contact.email}</p>
                </div>
              )}
              {snapshot.contact?.primary_phone && (
                <div>
                  <p className="w-field-label">Primary Phone</p>
                  <p className="w-field-value" itemProp="telephone" data-agent-field="primary_phone">{snapshot.contact.primary_phone}</p>
                </div>
              )}
              {snapshot.contact?.alternate_phone && snapshot.contact.alternate_phone !== snapshot.contact.primary_phone && (
                <div>
                  <p className="w-field-label">Alternate Phone</p>
                  <p className="w-field-value" data-agent-field="alternate_phone">{snapshot.contact.alternate_phone}</p>
                </div>
              )}
              {snapshot.addresses?.home && (
                <div itemProp="address" itemScope itemType="https://schema.org/PostalAddress">
                  <p className="w-field-label">Location</p>
                  <p className="w-field-value" data-agent-field="location_home">{snapshot.addresses.home}</p>
                </div>
              )}
            </div>
          </div>

          {/* Assignment */}
          <div className="w-card" id="assignment-info">
            <p className="w-label">{facility ? "Assignment" : "Preferences"}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {facility ? (
                <>
                  <div>
                    <p className="w-field-label">Facility</p>
                    <p className="w-field-value">{facility}</p>
                  </div>
                  {facilityLoc && (
                    <div>
                      <p className="w-field-label">Location</p>
                      <p className="w-field-value">{facilityLoc}</p>
                    </div>
                  )}
                  {snapshot.assignment?.start_date && (
                    <div>
                      <p className="w-field-label">Dates</p>
                      <p className="w-field-value">
                        {new Date(snapshot.assignment.start_date).toLocaleDateString()} to {snapshot.assignment.end_date ? new Date(snapshot.assignment.end_date).toLocaleDateString() : "Ongoing"}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {snapshot.job_desires?.locations && snapshot.job_desires.locations.length > 0 && (
                    <div>
                      <p className="w-field-label">Preferred Locations</p>
                      <p className="w-field-value">{snapshot.job_desires.locations.join(", ")}</p>
                    </div>
                  )}
                  {snapshot.job_desires?.shift_preference && (
                    <div>
                      <p className="w-field-label">Shift</p>
                      <p className="w-field-value">{snapshot.job_desires.shift_preference}</p>
                    </div>
                  )}
                  {!snapshot.job_desires?.shift_preference && (!snapshot.job_desires?.locations || snapshot.job_desires.locations.length === 0) && (
                    <p className="w-field-value" style={{ color: "var(--w-text-dim)" }}>No preferences set</p>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Team */}
          <div className="w-card" id="team-info">
            <p className="w-label">Recruiting Team</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {snapshot.team_info?.recruiter && (
                <div>
                  <p className="w-field-label">Recruiter</p>
                  <p className="w-field-value">{snapshot.team_info.recruiter}</p>
                </div>
              )}
              {snapshot.team_info?.team_leader && (
                <div>
                  <p className="w-field-label">Team Leader</p>
                  <p className="w-field-value">{snapshot.team_info.team_leader}</p>
                </div>
              )}
              {!snapshot.team_info?.recruiter && !snapshot.team_info?.team_leader && (
                <p className="w-field-value" style={{ color: "var(--w-text-dim)" }}>No team assigned</p>
              )}
            </div>
          </div>

          {/* Tags */}
          <div className="w-card" id="profile-tags">
            <p className="w-label">Profile Tags</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(snapshot.profile_status_tags || []).map((tag, i) => (
                <div key={i} className="w-chip">{tag}</div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Raw payload (collapsible) ──────────── */}
        <div className="w-card" style={{ marginBottom: 16 }}>
          <details>
            <summary className="w-label" style={{ cursor: "pointer", userSelect: "none", marginBottom: 0 }}>
              Raw Grounding Payload
            </summary>
            <div className="w-divider" />
            <pre style={{
              whiteSpace: "pre-wrap", wordBreak: "break-word",
              fontSize: 11, lineHeight: 1.6, color: "var(--w-text-dim)",
              background: "var(--w-surface-raised)", borderRadius: "var(--w-radius-sm)",
              padding: 16, border: "1px solid var(--w-border)",
            }}>
              {prettyJson}
            </pre>
          </details>
        </div>

        <p style={{ fontSize: 11, color: "var(--w-text-dim)", textAlign: "center", padding: "8px 0" }}>
          Generated {new Date(snapshot.generated_at).toLocaleString()} · Nova ID {snapshot.candidate_id} · The Lab
        </p>
      </main>

      <script
        id="candidate-grounding-ldjson"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(candidateGroundingLd) }}
      />
    </>
  );
}

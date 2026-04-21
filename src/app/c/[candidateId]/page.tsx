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

  return (
    <main style={{ margin: "0 auto", maxWidth: 960, padding: 24, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
      <h1 style={{ fontSize: 24, margin: "0 0 12px" }}>Candidate Grounding Source</h1>
      <p style={{ margin: "0 0 16px" }}>
        Canonical URL payload for AI grounding. Source URL: <a href={snapshot.source_url}>{snapshot.source_url}</a>
      </p>

      {snapshot.rc_thread_url && (
        <a 
          href={snapshot.rc_thread_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            marginBottom: 16,
            marginRight: 8,
            padding: "4px 10px",
            background: "#2b2b2b",
            color: "#fff",
            borderRadius: 12,
            fontSize: 12,
            textDecoration: "none",
            fontWeight: 500,
            border: "1px solid #444",
            boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
          }}
        >
          RingCentral SMS ↗
        </a>
      )}

      {snapshot.outlook_thread_url && (
        <a 
          href={snapshot.outlook_thread_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            marginBottom: 16,
            padding: "4px 10px",
            background: "#1e3a8a",
            color: "#fff",
            borderRadius: 12,
            fontSize: 12,
            textDecoration: "none",
            fontWeight: 500,
            border: "1px solid #1e40af",
            boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
          }}
        >
          Outlook ↗
        </a>
      )}

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
        <p>ring_central_thread_url: {snapshot.rc_thread_url || "none"}</p>
        <p>outlook_thread_url: {snapshot.outlook_thread_url || "none"}</p>
      </div>
    </main>
  );
}

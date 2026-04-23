import { notFound } from "next/navigation";
import { resolveTemplate } from "@/lib/resolver/template-resolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function TemplateViewPage({ params }: Props) {
  const resolvedParams = await params;
  const templateId = String(resolvedParams.id || "").trim();

  if (!templateId) return notFound();

  const resolution = await resolveTemplate(templateId);

  if (resolution.status === "not_found" || resolution.status === "ambiguous") {
    return notFound();
  }

  const data = resolution.data as Record<string, any>;
  const blueprint = data?.blueprint;
  const source = data?.source || "unknown";
  const version = data?.version || 1;

  return (
    <main style={{ minHeight: "100vh", background: "#0a0a0a", color: "#ededed", padding: 32, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <header style={{ borderBottom: "1px solid #333", paddingBottom: 24, marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" as const }}>
            <span style={{ padding: "4px 10px", fontSize: 11, fontFamily: "ui-monospace, monospace", background: "#1a1a1a", border: "1px solid #333", borderRadius: 6, color: "#888" }}>
              {data.category || "template"}
            </span>
            {data.internalOnly && (
              <span style={{ padding: "4px 10px", fontSize: 11, fontFamily: "ui-monospace, monospace", background: "#1c1107", border: "1px solid #3d2800", borderRadius: 6, color: "#f59e0b" }}>
                Internal Only
              </span>
            )}
            <span style={{ padding: "4px 10px", fontSize: 11, fontFamily: "ui-monospace, monospace", background: source === "spanner" ? "#0a1628" : "#1a1a1a", border: `1px solid ${source === "spanner" ? "#1e3a5f" : "#333"}`, borderRadius: 6, color: source === "spanner" ? "#60a5fa" : "#888" }}>
              {source === "spanner" ? `Spanner v${version}` : "Static Fallback"}
            </span>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 500, letterSpacing: "-0.02em", color: "#fff", margin: "12px 0 0" }}>{data.name}</h1>
          <p style={{ fontSize: 13, fontFamily: "ui-monospace, monospace", color: "#666", margin: "8px 0 0" }}>ID: {data.id}</p>
        </header>

        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: 12 }}>Required Fields</h2>
          <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 8 }}>
            {(data.requiredFields || []).map((field: string) => (
              <span key={field} style={{ padding: "4px 10px", fontSize: 12, fontFamily: "ui-monospace, monospace", background: "#111", border: "1px solid #222", borderRadius: 6, color: "#ccc" }}>
                {field}
              </span>
            ))}
          </div>
        </section>

        {blueprint && (
          <section>
            <h2 style={{ fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: 12 }}>Email Template Blueprint</h2>
            <div style={{ borderRadius: 12, border: "1px solid #333", background: "#111", overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #222", background: "#1a1a1a" }}>
                {blueprint.to && (
                  <p style={{ fontSize: 13, fontFamily: "ui-monospace, monospace", color: "#aaa", margin: "0 0 6px" }}>
                    <span style={{ color: "#666" }}>To: </span>{blueprint.to}
                  </p>
                )}
                {blueprint.cc && (
                  <p style={{ fontSize: 13, fontFamily: "ui-monospace, monospace", color: "#aaa", margin: "0 0 6px" }}>
                    <span style={{ color: "#666" }}>CC: </span>{blueprint.cc}
                  </p>
                )}
                <p style={{ fontSize: 13, fontFamily: "ui-monospace, monospace", color: "#aaa", margin: 0 }}>
                  <span style={{ color: "#666" }}>Subject: </span>{blueprint.subject}
                </p>
              </div>
              <div style={{ padding: 24 }}>
                <pre style={{ fontSize: 13, fontFamily: "ui-monospace, monospace", color: "#ccc", whiteSpace: "pre-wrap", lineHeight: 1.7, margin: 0 }}>
                  {blueprint.body}
                </pre>
              </div>
            </div>
          </section>
        )}

        <footer style={{ marginTop: 48, paddingTop: 16, borderTop: "1px solid #222" }}>
          <p style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", color: "#444" }}>
            Source: {source} • Message Type: {data.messageType}
          </p>
        </footer>
      </div>
    </main>
  );
}

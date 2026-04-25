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
    <main style={{
      minHeight: "100vh",
      background: "radial-gradient(ellipse at top, #16161a 0%, #050505 100%)",
      color: "#ededed",
      padding: "64px 32px",
      fontFamily: "var(--font-inter), -apple-system, sans-serif",
      display: "flex",
      justifyContent: "center"
    }}>
      <div style={{
        width: "100%",
        maxWidth: 720,
        background: "rgba(15, 15, 18, 0.4)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: 24,
        boxShadow: "0 24px 64px -12px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
        overflow: "hidden"
      }}>
        <header style={{
          padding: "32px 40px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
          background: "linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0) 100%)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" as const }}>
            <span style={{ 
              padding: "6px 12px", 
              fontSize: 11, 
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              background: "rgba(255, 255, 255, 0.05)", 
              border: "1px solid rgba(255, 255, 255, 0.1)", 
              borderRadius: 32, 
              color: "#a1a1aa" 
            }}>
              {data.category || "template"}
            </span>
            {data.internalOnly && (
              <span style={{ 
                padding: "6px 12px", 
                fontSize: 11, 
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                background: "rgba(245, 158, 11, 0.1)", 
                border: "1px solid rgba(245, 158, 11, 0.2)", 
                borderRadius: 32, 
                color: "#fbbf24" 
              }}>
                Internal Form
              </span>
            )}
            <span style={{ 
              padding: "6px 12px", 
              fontSize: 11, 
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              background: source === "spanner" ? "rgba(56, 189, 248, 0.1)" : "rgba(255, 255, 255, 0.05)", 
              border: `1px solid ${source === "spanner" ? "rgba(56, 189, 248, 0.2)" : "rgba(255, 255, 255, 0.1)"}`, 
              borderRadius: 32, 
              color: source === "spanner" ? "#38bdf8" : "#a1a1aa" 
            }}>
              {source === "spanner" ? `Spanner SSOT` : "Static"}
            </span>
          </div>
          <h1 style={{ 
            fontSize: 28, 
            fontWeight: 600, 
            letterSpacing: "-0.03em", 
            color: "#f8fafc", 
            margin: "0 0 8px",
            lineHeight: 1.2
          }}>
            {data.name}
          </h1>
          <p style={{ 
            fontSize: 13, 
            fontFamily: "ui-monospace, Consolas, monospace", 
            color: "#64748b", 
            margin: 0 
          }}>
            hub://templates/{data.id}
          </p>
        </header>

        <section style={{ padding: "32px 40px", borderBottom: "1px solid rgba(255, 255, 255, 0.04)" }}>
          <h2 style={{ 
            fontSize: 11, 
            fontWeight: 600, 
            color: "#64748b", 
            textTransform: "uppercase", 
            letterSpacing: "0.12em", 
            marginBottom: 16 
          }}>
            Variables & Schema
          </h2>
          <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 10 }}>
            {(data.requiredFields || []).map((field: string) => (
              <span key={field} style={{ 
                padding: "6px 14px", 
                fontSize: 13, 
                fontFamily: "ui-monospace, Consolas, monospace", 
                background: "rgba(0, 0, 0, 0.5)", 
                border: "1px solid rgba(255, 255, 255, 0.08)", 
                borderRadius: 8, 
                color: "#e2e8f0" 
              }}>
                <span style={{ color: "#64748b", marginRight: 4 }}>$</span>{field}
              </span>
            ))}
            {(!data.requiredFields || data.requiredFields.length === 0) && (
              <span style={{ color: "#475569", fontSize: 13, fontStyle: "italic" }}>No variables required</span>
            )}
          </div>
        </section>

        {blueprint && (
          <section style={{ padding: "32px 40px" }}>
            <h2 style={{ 
              fontSize: 11, 
              fontWeight: 600, 
              color: "#64748b", 
              textTransform: "uppercase", 
              letterSpacing: "0.12em", 
              marginBottom: 16 
            }}>
              Computed Blueprint
            </h2>
            <div style={{ 
              borderRadius: 16, 
              border: "1px solid rgba(255, 255, 255, 0.1)", 
              background: "#09090b", 
              overflow: "hidden" 
            }}>
              <div style={{ 
                padding: "16px 20px", 
                borderBottom: "1px solid rgba(255, 255, 255, 0.05)", 
                background: "rgba(255, 255, 255, 0.02)" 
              }}>
                {blueprint.to && (
                  <p style={{ fontSize: 14, color: "#cbd5e1", margin: "0 0 8px", display: "flex" }}>
                    <span style={{ color: "#64748b", width: 60, fontWeight: 500 }}>To</span>
                    <span style={{ fontFamily: "ui-monospace, Consolas, monospace" }}>{blueprint.to}</span>
                  </p>
                )}
                {blueprint.cc && (
                  <p style={{ fontSize: 14, color: "#cbd5e1", margin: "0 0 8px", display: "flex" }}>
                    <span style={{ color: "#64748b", width: 60, fontWeight: 500 }}>Cc</span>
                    <span style={{ fontFamily: "ui-monospace, Consolas, monospace" }}>{blueprint.cc}</span>
                  </p>
                )}
                <p style={{ fontSize: 14, color: "#cbd5e1", margin: 0, display: "flex" }}>
                  <span style={{ color: "#64748b", width: 60, fontWeight: 500 }}>Subj</span>
                  <span style={{ fontWeight: 500 }}>{blueprint.subject}</span>
                </p>
              </div>
              <div style={{ padding: "24px 20px" }}>
                <pre style={{ 
                  fontSize: 14, 
                  fontFamily: "ui-monospace, Consolas, monospace", 
                  color: "#cbd5e1", 
                  whiteSpace: "pre-wrap", 
                  lineHeight: 1.6, 
                  margin: 0 
                }}>
                  {blueprint.body}
                </pre>
              </div>
            </div>
          </section>
        )}

        <footer style={{ 
          margin: "0 40px 32px",
          paddingTop: 24, 
          borderTop: "1px solid rgba(255, 255, 255, 0.04)" 
        }}>
          <p style={{ fontSize: 11, fontWeight: 500, color: "#475569", margin: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            AyaOps • Engine v{version} • Format: {data.messageType}
          </p>
        </footer>
      </div>
    </main>
  );
}

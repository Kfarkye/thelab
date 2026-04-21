"use client";

import { useState, useCallback, useEffect } from "react";

// ── Types ───────────────────────────────────────────────────────
type ToolLog = { tool: string; ok: boolean; latency_ms: number };

type RunResult = {
  status: "complete" | "max_rounds_reached" | "error";
  response?: string;
  rounds?: number;
  toolResults?: ToolLog[];
  error?: string;
  prUrl?: string;
};

type GitHubConfig = {
  owner: string;
  repo: string;
  token: string;
  baseBranch: string;
};

const STORAGE_KEY = "auto-improve-github-config";

function loadConfig(): GitHubConfig {
  if (typeof window === "undefined") return { owner: "", repo: "", token: "", baseBranch: "main" };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { owner: "", repo: "", token: "", baseBranch: "main" };
}

function saveConfig(config: GitHubConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch { /* ignore */ }
}

// ── Page Component ──────────────────────────────────────────────
export default function AutoImprovePage() {
  const [config, setConfig] = useState<GitHubConfig>({ owner: "", repo: "", token: "", baseBranch: "main" });
  const [configSaved, setConfigSaved] = useState(false);
  const [showSetup, setShowSetup] = useState(true);
  const [instruction, setInstruction] = useState("");
  const [targetFiles, setTargetFiles] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  useEffect(() => {
    const loaded = loadConfig();
    setConfig(loaded);
    if (loaded.owner && loaded.repo && loaded.token) {
      setShowSetup(false);
      setConfigSaved(true);
    }
  }, []);

  const handleSaveConfig = useCallback(() => {
    saveConfig(config);
    setConfigSaved(true);
    setShowSetup(false);
  }, [config]);

  const handleRun = useCallback(async () => {
    if (!instruction.trim()) return;
    if (!config.owner || !config.repo || !config.token) {
      setShowSetup(true);
      return;
    }

    setRunning(true);
    setResult(null);

    try {
      const files = targetFiles
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);

      const res = await fetch("/api/system/auto-improve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: instruction.trim(),
          files: files.length > 0 ? files : undefined,
          githubConfig: {
            owner: config.owner,
            repo: config.repo,
            token: config.token,
            baseBranch: config.baseBranch || "main",
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setResult({ status: "error", error: data.error || `HTTP ${res.status}` });
      } else {
        // Extract PR URL from response text if present
        let prUrl: string | undefined;
        const prMatch = data.response?.match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/);
        if (prMatch) prUrl = prMatch[0];

        // Also check toolResults for process_code_change
        if (data.toolResults) {
          for (const tr of data.toolResults) {
            if (tr.tool === "process_code_change" && tr.ok) {
              // PR was created
            }
          }
        }

        setResult({
          status: data.status,
          response: data.response,
          rounds: data.rounds,
          toolResults: data.toolResults,
          prUrl,
        });
      }
    } catch (err) {
      setResult({
        status: "error",
        error: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      setRunning(false);
    }
  }, [instruction, targetFiles, config]);

  const isConfigured = config.owner && config.repo && config.token;

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0a0a0f 0%, #12121a 50%, #0d0d14 100%)",
      color: "#e4e4e7",
      fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
    }}>
      {/* Header */}
      <header style={{
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        padding: "16px 32px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        backdropFilter: "blur(12px)",
        background: "rgba(10,10,15,0.8)",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a href="/chat" style={{ color: "#71717a", textDecoration: "none", fontSize: 13 }}>← Back to Chat</a>
          <span style={{ color: "#27272a" }}>|</span>
          <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0, letterSpacing: "-0.02em" }}>
            Auto-Improve
          </h1>
          <span style={{
            fontSize: 10,
            padding: "2px 8px",
            borderRadius: 999,
            background: "rgba(59, 130, 246, 0.15)",
            color: "#60a5fa",
            fontWeight: 500,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}>BETA</span>
        </div>
        <button
          onClick={() => setShowSetup(!showSetup)}
          style={{
            background: isConfigured ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
            border: `1px solid ${isConfigured ? "rgba(34, 197, 94, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
            color: isConfigured ? "#4ade80" : "#f87171",
            padding: "6px 14px",
            borderRadius: 8,
            fontSize: 12,
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          {isConfigured ? "✓ GitHub Connected" : "⚠ Setup Required"}
        </button>
      </header>

      <div style={{ maxWidth: 780, margin: "0 auto", padding: "32px 24px" }}>
        {/* Setup Panel */}
        {showSetup && (
          <div style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12,
            padding: 24,
            marginBottom: 24,
          }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 4px 0", color: "#d4d4d8" }}>
              GitHub Repository Setup
            </h2>
            <p style={{ fontSize: 12, color: "#71717a", margin: "0 0 20px 0" }}>
              Connect your repository so Auto-Improve can read files and open PRs.
              Credentials are stored in your browser only.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, color: "#a1a1aa", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Owner</span>
                <input
                  value={config.owner}
                  onChange={(e) => setConfig({ ...config, owner: e.target.value })}
                  placeholder="Kfarkye"
                  style={inputStyle}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, color: "#a1a1aa", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Repository</span>
                <input
                  value={config.repo}
                  onChange={(e) => setConfig({ ...config, repo: e.target.value })}
                  placeholder="thelab"
                  style={inputStyle}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, color: "#a1a1aa", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Base Branch</span>
                <input
                  value={config.baseBranch}
                  onChange={(e) => setConfig({ ...config, baseBranch: e.target.value })}
                  placeholder="main"
                  style={inputStyle}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, color: "#a1a1aa", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Personal Access Token</span>
                <input
                  type="password"
                  value={config.token}
                  onChange={(e) => setConfig({ ...config, token: e.target.value })}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  style={inputStyle}
                />
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
              <span style={{ fontSize: 11, color: "#52525b" }}>
                Requires a token with <code style={{ background: "rgba(255,255,255,0.06)", padding: "1px 5px", borderRadius: 4 }}>repo</code> scope
              </span>
              <button
                onClick={handleSaveConfig}
                disabled={!config.owner || !config.repo || !config.token}
                style={{
                  background: config.owner && config.repo && config.token
                    ? "linear-gradient(135deg, #3b82f6, #2563eb)"
                    : "rgba(255,255,255,0.05)",
                  color: config.owner && config.repo && config.token ? "#fff" : "#52525b",
                  border: "none",
                  padding: "8px 20px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: config.owner && config.repo && config.token ? "pointer" : "not-allowed",
                }}
              >
                {configSaved ? "Update Connection" : "Connect Repository"}
              </button>
            </div>
          </div>
        )}

        {/* Instruction Input */}
        <div style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
          padding: 24,
          marginBottom: 24,
        }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 16px 0", color: "#d4d4d8" }}>
            Improvement Instruction
          </h2>

          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="e.g., Fix all TypeScript implicit any errors in src/lib/spanner/tools.ts"
            rows={4}
            style={{
              ...inputStyle,
              width: "100%",
              resize: "vertical",
              fontFamily: "'Inter', sans-serif",
              lineHeight: 1.5,
              boxSizing: "border-box",
            }}
          />

          <div style={{ marginTop: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "#71717a", fontWeight: 500 }}>
                Target files (optional, one per line)
              </span>
              <textarea
                value={targetFiles}
                onChange={(e) => setTargetFiles(e.target.value)}
                placeholder={"src/lib/spanner/tools.ts\nsrc/app/api/chat/route.ts"}
                rows={2}
                style={{
                  ...inputStyle,
                  width: "100%",
                  resize: "vertical",
                  fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
                  fontSize: 12,
                  boxSizing: "border-box",
                }}
              />
            </label>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button
              onClick={handleRun}
              disabled={running || !instruction.trim() || !isConfigured}
              style={{
                background: running
                  ? "rgba(255,255,255,0.05)"
                  : !instruction.trim() || !isConfigured
                    ? "rgba(255,255,255,0.05)"
                    : "linear-gradient(135deg, #10b981, #059669)",
                color: running || !instruction.trim() || !isConfigured ? "#52525b" : "#fff",
                border: "none",
                padding: "10px 28px",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: running || !instruction.trim() || !isConfigured ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
                transition: "all 0.2s ease",
              }}
            >
              {running ? (
                <>
                  <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⏳</span>
                  Running…
                </>
              ) : (
                <>🚀 Run Auto-Improve</>
              )}
            </button>
          </div>
        </div>

        {/* Results */}
        {result && (
          <div style={{
            background: "rgba(255,255,255,0.03)",
            border: `1px solid ${result.status === "error" ? "rgba(239, 68, 68, 0.3)" : result.status === "complete" ? "rgba(34, 197, 94, 0.2)" : "rgba(255,255,255,0.08)"}`,
            borderRadius: 12,
            padding: 24,
          }}>
            {/* Status Header */}
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 16,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18 }}>
                  {result.status === "complete" ? "✅" : result.status === "error" ? "❌" : "⚠️"}
                </span>
                <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: "#d4d4d8" }}>
                  {result.status === "complete" ? "Analysis Complete" : result.status === "error" ? "Error" : "Max Rounds Reached"}
                </h3>
              </div>
              {result.rounds && (
                <span style={{ fontSize: 11, color: "#71717a" }}>
                  {result.rounds} round{result.rounds > 1 ? "s" : ""}
                </span>
              )}
            </div>

            {/* PR Link */}
            {result.prUrl && (
              <a
                href={result.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 16px",
                  background: "rgba(34, 197, 94, 0.08)",
                  border: "1px solid rgba(34, 197, 94, 0.2)",
                  borderRadius: 8,
                  color: "#4ade80",
                  textDecoration: "none",
                  fontSize: 13,
                  fontWeight: 500,
                  marginBottom: 16,
                }}
              >
                🔗 Pull Request Created — Review & Merge
                <span style={{ fontSize: 11, color: "#71717a", marginLeft: "auto" }}>{result.prUrl}</span>
              </a>
            )}

            {/* Tool Execution Log */}
            {result.toolResults && result.toolResults.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <h4 style={{ fontSize: 11, fontWeight: 600, color: "#71717a", margin: "0 0 8px 0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Tool Execution Log
                </h4>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {result.toolResults.map((tr, i) => (
                    <div key={i} style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12,
                      padding: "4px 10px",
                      background: "rgba(255,255,255,0.02)",
                      borderRadius: 6,
                      border: "1px solid rgba(255,255,255,0.04)",
                    }}>
                      <span>{tr.ok ? "✅" : "❌"}</span>
                      <span style={{ color: "#a1a1aa", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
                        {tr.tool}
                      </span>
                      <span style={{ color: "#52525b", marginLeft: "auto", fontSize: 10 }}>
                        {tr.latency_ms}ms
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Response Text */}
            {result.response && (
              <div style={{
                background: "rgba(0,0,0,0.3)",
                borderRadius: 8,
                padding: 16,
                fontSize: 13,
                lineHeight: 1.7,
                color: "#d4d4d8",
                whiteSpace: "pre-wrap",
                fontFamily: "'Inter', sans-serif",
                maxHeight: 500,
                overflowY: "auto",
              }}>
                {result.response}
              </div>
            )}

            {/* Error */}
            {result.error && (
              <div style={{
                background: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                borderRadius: 8,
                padding: 12,
                fontSize: 13,
                color: "#f87171",
              }}>
                {result.error}
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// ── Shared input style ──────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
  padding: "8px 12px",
  color: "#e4e4e7",
  fontSize: 13,
  outline: "none",
};

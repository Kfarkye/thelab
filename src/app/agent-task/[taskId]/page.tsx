import Link from "next/link";
import { getAgentHandoffTask } from "@/lib/agent/handoff-store";

export const dynamic = "force-dynamic";

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value);
  }
}

async function readTaskId(paramsInput: Promise<{ taskId: string }>): Promise<string> {
  const params = await paramsInput;
  return decodeURIComponent(String(params.taskId || "").trim());
}

export default async function AgentTaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const taskId = await readTaskId(params);
  const task = await getAgentHandoffTask(taskId);

  if (!task) {
    return (
      <main style={{ maxWidth: 920, margin: "0 auto", padding: "32px 20px", fontFamily: "DM Sans, system-ui, sans-serif" }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 24 }}>Agent Task Not Found</h1>
        <p style={{ margin: "0 0 16px", color: "#6f6a62" }}>
          Task <code>{taskId || "(missing)"}</code> was not found.
        </p>
        <Link href="/chat" style={{ color: "#0e5aa7", textDecoration: "underline" }}>Return to chat</Link>
      </main>
    );
  }

  const launchPath = `/api/agent-task/${encodeURIComponent(task.taskId)}/launch`;
  const resultPath = `/api/agent-task/${encodeURIComponent(task.taskId)}`;

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "24px 20px 40px", fontFamily: "DM Sans, system-ui, sans-serif", color: "#1a1a17" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.2 }}>Browser Agent Handoff</h1>
          <p style={{ margin: "8px 0 0", color: "#6f6a62", fontSize: 14 }}>
            Task <code>{task.taskId}</code> · Status <strong>{task.status}</strong>
          </p>
        </div>
        <a
          href={launchPath}
          style={{
            textDecoration: "none",
            background: "#1a1a17",
            color: "#fff",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Open Target Surface
        </a>
      </div>

      <section style={{ marginTop: 18, border: "1px solid #e8e5df", borderRadius: 10, background: "#fffdfa", padding: 14 }}>
        <div style={{ fontSize: 12, color: "#7e7a73", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
          Task Goal
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.5 }}>{task.goal}</div>
      </section>

      <section style={{ marginTop: 14, border: "1px solid #e8e5df", borderRadius: 10, background: "#fff", padding: 14 }}>
        <div style={{ fontSize: 12, color: "#7e7a73", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
          Execution Instructions
        </div>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.55, fontSize: 14 }}>
          {task.instructions.map((instruction, index) => (
            <li key={`${task.taskId}-instruction-${index}`}>{instruction}</li>
          ))}
        </ol>
      </section>

      <section style={{ marginTop: 14, border: "1px solid #e8e5df", borderRadius: 10, background: "#fff", padding: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10, fontSize: 13 }}>
          <div>
            <div style={{ color: "#7e7a73", marginBottom: 4 }}>Target URL</div>
            <code style={{ wordBreak: "break-all" }}>{task.targetUrl}</code>
          </div>
          <div>
            <div style={{ color: "#7e7a73", marginBottom: 4 }}>Source Surface</div>
            <strong>{task.sourceSurface}</strong>
          </div>
          <div>
            <div style={{ color: "#7e7a73", marginBottom: 4 }}>Ledger ID</div>
            <code>{task.ledgerId}</code>
          </div>
          <div>
            <div style={{ color: "#7e7a73", marginBottom: 4 }}>Return Path</div>
            <code>{resultPath}</code>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 14, border: "1px solid #e8e5df", borderRadius: 10, background: "#fff", padding: 14 }}>
        <div style={{ fontSize: 12, color: "#7e7a73", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
          Expected Return Schema
        </div>
        <pre style={{ margin: 0, background: "#f8f6f2", border: "1px solid #ece8e0", borderRadius: 8, padding: 10, fontSize: 12, lineHeight: 1.45, overflowX: "auto" }}>
          <code>{pretty(task.expectedReturnSchema)}</code>
        </pre>
      </section>

      {task.context && Object.keys(task.context).length > 0 && (
        <section style={{ marginTop: 14, border: "1px solid #e8e5df", borderRadius: 10, background: "#fff", padding: 14 }}>
          <div style={{ fontSize: 12, color: "#7e7a73", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
            Context Packet
          </div>
          <pre style={{ margin: 0, background: "#f8f6f2", border: "1px solid #ece8e0", borderRadius: 8, padding: 10, fontSize: 12, lineHeight: 1.45, overflowX: "auto" }}>
            <code>{pretty(task.context)}</code>
          </pre>
        </section>
      )}
    </main>
  );
}

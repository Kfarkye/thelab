"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { SandboxTask } from "@/lib/types/sandbox";
import { DocumentPreview } from "@/components/sandbox/DocumentPreview";
import { DiffPreview } from "@/components/sandbox/DiffPreview";

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value);
  }
}

function ApiCallPreview({
  method,
  url,
  headers,
  body,
}: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}) {
  return (
    <div className="sb-api">
      <div className="sb-api-head">
        <span className="sb-api-method">{method}</span>
        <span className="sb-api-url" title={url}>{url}</span>
      </div>
      <div className="sb-api-block">
        <div className="sb-api-label">Headers</div>
        <pre><code>{prettyJson(headers)}</code></pre>
      </div>
      <div className="sb-api-block">
        <div className="sb-api-label">Body</div>
        <pre><code>{prettyJson(body)}</code></pre>
      </div>
    </div>
  );
}

function EmailDraftPreview({
  templateId,
  toEmail,
  cc,
  subject,
  body,
  candidateId,
  jobId,
  noteContent,
}: {
  templateId: string;
  toEmail: string;
  cc: string[];
  subject: string;
  body: string;
  candidateId?: string;
  jobId?: string;
  noteContent?: string;
}) {
  return (
    <div className="sb-email">
      <div className="sb-email-meta">
        <div><strong>Template:</strong> {templateId}</div>
        <div><strong>To:</strong> {toEmail}</div>
        <div><strong>CC:</strong> {cc.length > 0 ? cc.join(", ") : "None"}</div>
        {candidateId && <div><strong>Candidate:</strong> {candidateId}</div>}
        {jobId && <div><strong>Job:</strong> {jobId}</div>}
      </div>
      <div className="sb-email-subject"><strong>Subject:</strong> {subject}</div>
      <div className="sb-email-body">
        <pre><code>{body}</code></pre>
      </div>
      {noteContent && (
        <div className="sb-email-note">
          <div className="sb-api-label">Note On Approve</div>
          <pre><code>{noteContent}</code></pre>
        </div>
      )}
    </div>
  );
}

function AgentHandoffPreview({
  targetUrl,
  sourceSurface,
  goal,
  instructions,
  expectedReturnSchema,
  context,
}: {
  targetUrl: string;
  sourceSurface: string;
  goal: string;
  instructions: string[];
  expectedReturnSchema: Record<string, unknown>;
  context?: Record<string, unknown> | null;
}) {
  return (
    <div className="sb-api">
      <div className="sb-api-head">
        <span className="sb-api-method">HANDOFF</span>
        <span className="sb-api-url" title={targetUrl}>{targetUrl}</span>
      </div>
      <div className="sb-api-block">
        <div className="sb-api-label">Goal</div>
        <pre><code>{goal}</code></pre>
      </div>
      <div className="sb-api-block">
        <div className="sb-api-label">Source Surface</div>
        <pre><code>{sourceSurface}</code></pre>
      </div>
      <div className="sb-api-block">
        <div className="sb-api-label">Instructions</div>
        <pre><code>{prettyJson(instructions)}</code></pre>
      </div>
      <div className="sb-api-block">
        <div className="sb-api-label">Expected Return Schema</div>
        <pre><code>{prettyJson(expectedReturnSchema)}</code></pre>
      </div>
      {context && Object.keys(context).length > 0 && (
        <div className="sb-api-block">
          <div className="sb-api-label">Context</div>
          <pre><code>{prettyJson(context)}</code></pre>
        </div>
      )}
    </div>
  );
}

export function SandboxPanel({
  tasks,
  activeTaskId,
  onSelectTask,
  onApprove,
  onReject,
  onClose,
  isCommitting,
}: {
  tasks: SandboxTask[];
  activeTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onApprove: (taskId: string, mode?: "default" | "send_now") => void;
  onReject: (taskId: string, feedback: string) => void;
  onClose: () => void;
  isCommitting: boolean;
}) {
  const [feedback, setFeedback] = useState("");

  const activeIndex = useMemo(() => {
    if (!tasks.length) return -1;
    if (!activeTaskId) return tasks.length - 1;
    const index = tasks.findIndex((task) => task.taskId === activeTaskId);
    return index >= 0 ? index : tasks.length - 1;
  }, [tasks, activeTaskId]);

  const activeTask = activeIndex >= 0 ? tasks[activeIndex] : null;
  const canGoPrev = activeIndex > 0;
  const canGoNext = activeIndex >= 0 && activeIndex < tasks.length - 1;

  if (!activeTask) {
    return (
      <aside className="rp-shell sb-shell">
        <div className="rp-header">
          <h2 className="rp-title">Sandbox</h2>
          <button className="rp-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="sb-empty">No sandbox tasks yet.</div>
      </aside>
    );
  }

  return (
    <aside className="rp-shell sb-shell">
      <div className="rp-header sb-header">
        <h2 className="rp-title">Sandbox</h2>
        <button className="rp-close" onClick={onClose}><X size={14} /></button>
      </div>

      <div className="sb-nav">
        <button
          type="button"
          className="sb-nav-btn"
          disabled={!canGoPrev}
          onClick={() => canGoPrev && onSelectTask(tasks[activeIndex - 1].taskId)}
          aria-label="Previous sandbox task"
        >
          <ChevronLeft size={12} />
        </button>
        <span className="sb-nav-label">Task {activeIndex + 1} of {tasks.length}</span>
        <button
          type="button"
          className="sb-nav-btn"
          disabled={!canGoNext}
          onClick={() => canGoNext && onSelectTask(tasks[activeIndex + 1].taskId)}
          aria-label="Next sandbox task"
        >
          <ChevronRight size={12} />
        </button>
        <span className={`sb-status sb-status-${activeTask.status}`}>{activeTask.status}</span>
      </div>

      <div className="sb-meta">
        <div className="sb-title">{activeTask.title}</div>
        <div className="sb-submeta">{activeTask.outputType} · {activeTask.mode}</div>
      </div>

      <div className="sb-content">
        {activeTask.preview.type === "document" && (
          <DocumentPreview
            markdown={activeTask.preview.markdown}
            renderedHtml={activeTask.preview.renderedHtml}
          />
        )}

        {activeTask.preview.type === "db_write" && (
          <DiffPreview
            before={activeTask.preview.before}
            after={activeTask.preview.after}
          />
        )}

        {activeTask.preview.type === "api_call" && (
          <ApiCallPreview
            method={activeTask.preview.method}
            url={activeTask.preview.url}
            headers={activeTask.preview.headers}
            body={activeTask.preview.body}
          />
        )}

        {activeTask.preview.type === "email_draft" && (
          <EmailDraftPreview
            templateId={activeTask.preview.templateId}
            toEmail={activeTask.preview.toEmail}
            cc={activeTask.preview.cc}
            subject={activeTask.preview.subject}
            body={activeTask.preview.body}
            candidateId={activeTask.preview.candidateId}
            jobId={activeTask.preview.jobId}
            noteContent={activeTask.preview.noteContent}
          />
        )}

        {activeTask.preview.type === "agent_handoff" && (
          <AgentHandoffPreview
            targetUrl={activeTask.preview.targetUrl}
            sourceSurface={activeTask.preview.sourceSurface}
            goal={activeTask.preview.goal}
            instructions={activeTask.preview.instructions}
            expectedReturnSchema={activeTask.preview.expectedReturnSchema}
            context={activeTask.preview.context}
          />
        )}
      </div>

      <div className="sb-actions">
        {activeTask.status === "pending_review" && (
          <>
            <textarea
              className="sb-feedback"
              placeholder="Optional rejection feedback"
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
            />
            <div className="sb-action-row">
              <button
                type="button"
                className="sb-btn sb-btn-secondary"
                onClick={() => {
                  onReject(activeTask.taskId, feedback.trim());
                  setFeedback("");
                }}
                disabled={isCommitting}
              >
                Reject
              </button>
              {activeTask.preview.type === "email_draft" ? (
                <>
                  <button
                    type="button"
                    className="sb-btn sb-btn-primary"
                    onClick={() => onApprove(activeTask.taskId, "default")}
                    disabled={isCommitting}
                  >
                    {isCommitting ? "Executing..." : "Save Draft"}
                  </button>
                  {activeTask.preview.allowSendNow !== false && (
                    <button
                      type="button"
                      className="sb-btn sb-btn-primary"
                      onClick={() => onApprove(activeTask.taskId, "send_now")}
                      disabled={isCommitting}
                    >
                      {isCommitting ? "Executing..." : "Send Now"}
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className="sb-btn sb-btn-primary"
                  onClick={() => onApprove(activeTask.taskId)}
                  disabled={isCommitting}
                >
                  {isCommitting ? "Executing..." : "Ship It"}
                </button>
              )}
            </div>
          </>
        )}

        {activeTask.status === "rejected" && (
          <div className="sb-outcome sb-outcome-rejected">
            Rejected{activeTask.feedback ? `: ${activeTask.feedback}` : "."}
          </div>
        )}

        {activeTask.status === "executed" && (
          <div className="sb-outcome sb-outcome-executed">Executed successfully.</div>
        )}

        {activeTask.status === "failed" && (
          <div className="sb-outcome sb-outcome-failed">Failed: {activeTask.error || "Unknown error"}</div>
        )}
      </div>
    </aside>
  );
}

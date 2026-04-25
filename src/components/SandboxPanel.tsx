"use client";

import { useEffect, useMemo, useState } from "react";
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

function encodeOutlookParam(value: string): string {
  return encodeURIComponent(value);
}

function buildOutlookDeepLink(toEmail: string, cc: string[], subject: string, body: string): string {
  const params: Array<[string, string]> = [];
  if (toEmail) params.push(["to", toEmail]);
  if (cc.length > 0) params.push(["cc", cc.join(",")]);
  if (subject) params.push(["subject", subject]);
  if (body) params.push(["body", body]);
  const query = params
    .map(([key, value]) => `${key}=${encodeOutlookParam(value)}`)
    .join("&");
  return query
    ? `https://outlook.office.com/mail/deeplink/compose?${query}`
    : "https://outlook.office.com/mail/deeplink/compose";
}

function parseCcList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
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
  onDraftChange,
}: {
  templateId: string;
  toEmail: string;
  cc: string[];
  subject: string;
  body: string;
  candidateId?: string;
  jobId?: string;
  noteContent?: string;
  onDraftChange?: (draft: { toEmail: string; cc: string[]; subject: string; body: string }) => void;
}) {
  const [editableTo, setEditableTo] = useState(toEmail);
  const [editableCc, setEditableCc] = useState(cc.join(", "));
  const [editableSubject, setEditableSubject] = useState(subject);
  const [editableBody, setEditableBody] = useState(body);

  useEffect(() => {
    setEditableTo(toEmail);
    setEditableCc(cc.join(", "));
    setEditableSubject(subject);
    setEditableBody(body);
  }, [toEmail, cc, subject, body]);

  const normalizedCc = parseCcList(editableCc);
  const outlookUrl = buildOutlookDeepLink(editableTo.trim(), normalizedCc, editableSubject, editableBody);

  const emitDraftChange = ({
    nextTo = editableTo,
    nextCc = editableCc,
    nextSubject = editableSubject,
    nextBody = editableBody,
  }: {
    nextTo?: string;
    nextCc?: string;
    nextSubject?: string;
    nextBody?: string;
  }) => {
    if (!onDraftChange) return;
    onDraftChange({
      toEmail: nextTo.trim(),
      cc: parseCcList(nextCc),
      subject: nextSubject,
      body: nextBody,
    });
  };

  return (
    <div className="sb-email">
      <div className="sb-email-meta">
        <div><strong>Template:</strong> {templateId}</div>
        <label className="sb-email-field">
          <span className="sb-email-field-label">To</span>
          <input
            className="sb-email-input"
            type="email"
            autoComplete="email"
            value={editableTo}
            onChange={(event) => {
              const next = event.target.value;
              setEditableTo(next);
              emitDraftChange({ nextTo: next });
            }}
            placeholder="candidate@email.com"
          />
        </label>
        <label className="sb-email-field">
          <span className="sb-email-field-label">CC</span>
          <input
            className="sb-email-input"
            type="text"
            value={editableCc}
            onChange={(event) => {
              const next = event.target.value;
              setEditableCc(next);
              emitDraftChange({ nextCc: next });
            }}
            placeholder="a@example.com, b@example.com"
          />
        </label>
        {candidateId && <div><strong>Candidate:</strong> {candidateId}</div>}
        {jobId && <div><strong>Job:</strong> {jobId}</div>}
      </div>
      <label className="sb-email-field sb-email-field-subject">
        <span className="sb-email-field-label">Subject</span>
        <input
          className="sb-email-input"
          type="text"
          value={editableSubject}
          onChange={(event) => {
            const next = event.target.value;
            setEditableSubject(next);
            emitDraftChange({ nextSubject: next });
          }}
          placeholder="Email subject"
        />
      </label>
      <div className="sb-email-body">
        <textarea
          className="sb-email-textarea"
          value={editableBody}
          onChange={(event) => {
            const next = event.target.value;
            setEditableBody(next);
            emitDraftChange({ nextBody: next });
          }}
        />
      </div>
      <a
        href={outlookUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="sb-btn sb-btn-outlook"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          marginTop: "8px",
          background: "#0078d4",
          color: "#fff",
          border: "none",
          borderRadius: "6px",
          padding: "7px 14px",
          fontSize: "12px",
          fontWeight: 600,
          textDecoration: "none",
          cursor: "pointer",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M22 6L12 13L2 6V4L12 11L22 4V6Z" fill="currentColor"/>
          <path d="M2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        </svg>
        Open in Outlook
      </a>
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
  onEditEmailDraft,
  onClose,
  isCommitting,
}: {
  tasks: SandboxTask[];
  activeTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onApprove: (taskId: string, mode?: "default" | "send_now") => void;
  onReject: (taskId: string, feedback: string) => void;
  onEditEmailDraft?: (
    taskId: string,
    draft: { toEmail: string; cc: string[]; subject: string; body: string },
  ) => void;
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
            onDraftChange={(draft) => onEditEmailDraft?.(activeTask.taskId, draft)}
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
                  <a
                    href={buildOutlookDeepLink(
                      activeTask.preview.toEmail,
                      activeTask.preview.cc,
                      activeTask.preview.subject,
                      activeTask.preview.body,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="sb-btn"
                    style={{ background: "#0078d4", color: "#fff", textDecoration: "none", textAlign: "center" }}
                  >
                    Open in Outlook
                  </a>
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

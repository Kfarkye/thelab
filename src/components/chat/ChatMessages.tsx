import React, { SetStateAction } from "react";
import { Copy, Check, ChevronDown, Mail, ExternalLink } from "lucide-react";
import { ChatState, ChatAction, Message, ModeConfig, WriteResultMeta, ConsoleMode } from "@/lib/types/chat";
import {
  buildUserDisplayContent, buildAssistantDisplayContent, formatMessageTimestamp,
  formatMarkdown, writePayloadForDisplay, CLEAN_COPY_MODES
} from "@/lib/chat-utils";

interface ChatMessagesProps {
  state: ChatState;
  dispatch: React.Dispatch<ChatAction>;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  visibleMessages: Message[];
  approvingSnapshotMessageId: string | null;
  ingestingCandidateMessageId: string | null;
  expandedWritePayloads: Set<string>;
  setExpandedWritePayloads: React.Dispatch<SetStateAction<Set<string>>>;
  setSourcesMsg: (msg: Message) => void;
  setRightPanelMode: (mode: any) => void;
  handleApproveHealthcareSnapshot: (msg: Message) => Promise<void>;
  handleAddCandidateToSystem: (msg: Message) => Promise<void>;
  onRetryAssistantMessage: (messageId: string) => void;
  copyToClipboard: (text: string, id: string, mode: ConsoleMode, options?: { primaryOnly?: boolean }) => Promise<void>;
  modeConfig: ModeConfig;
}

type CopyDraftFn = (
  text: string,
  msgId: string,
  mode: ConsoleMode,
  options?: { primaryOnly?: boolean },
) => Promise<void>;

type WriteAuditTone = "success" | "warning" | "error" | "neutral";

type WriteAuditMeta = {
  text: string;
  tone: WriteAuditTone;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function formatTokenLabel(value: string | null): string | null {
  if (!value) return null;
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function extractCandidateNameFromMessage(messageText: string): string | null {
  const text = String(messageText || "").trim();
  if (!text) return null;
  const patterns = [
    /updated\s+(.+?)\s+status\s*:/i,
    /updated\s+(.+?)\s+to\s+[a-z_ -]+\s+status/i,
    /could not update\s+(.+?)\s+to\s+[a-z_ -]+/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const candidate = String(match[1] || "").trim().replace(/[.:]+$/, "");
    if (candidate) return candidate;
  }
  return null;
}

function extractSnapshotCandidateName(messageText: string): string | null {
  const text = String(messageText || "");
  if (!text) return null;

  const patterns = [
    /Candidate Profile:\s*\*?\*?\s*([^\n*]+)/i,
    /Candidate:\s*\*?\*?\s*([^\n*]+)/i,
    /^\s*\*?\*?Name[:\s]+\*?\*?\s*([^\n*]+)/im,
    /details for\s+\*?\*?([\w][\w\s.'`-]+[\w])\*?\*?/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const normalized = String(match[1] || "")
      .replace(/[*_]/g, "")
      .replace(/\s*[•|].*$/, "")
      .trim();
    if (normalized) return normalized;
  }

  const lines = text
    .split("\n")
    .map((line) => line.replace(/[*_]/g, "").trim())
    .filter(Boolean)
    .slice(0, 12);

  for (const line of lines) {
    if (
      /^(record loaded|profile metadata|specialty|status|recent|email|address|emergency contact|last submitted|last profile update|initial docs uploaded progress|recruiter|team leader)/i.test(
        line,
      )
    ) {
      continue;
    }
    const candidate = line.replace(/\s*[•|].*$/, "").trim();
    if (/^[A-Z][A-Za-z.'`-]+(?:\s+[A-Z][A-Za-z.'`-]+){1,3}$/.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

function hasExtractedCandidateSnapshot(messageText: string): boolean {
  const text = String(messageText || "");
  if (!text) return false;

  let signals = 0;
  if (extractSnapshotCandidateName(text)) signals += 1;
  if (/(candidate profile|profile metadata)/i.test(text)) signals += 1;
  if (/(email|primary phone|phone|home address|address|location)\s*:/i.test(text)) signals += 1;
  if (/(profession|specialty)\s*:/i.test(text)) signals += 1;
  if (/(aya id|nova id|employment type|experience)\s*:/i.test(text)) signals += 1;

  return signals >= 3;
}

function normalizeDraftTypography(value: string): string {
  if (!value) return "";
  return value
    .split("\n")
    .map((line) =>
      line
        .replace(/[–—]/g, " to ")
        .replace(/\s+to\s+/g, " to ")
        .replace(/[ \t]{2,}/g, " ")
        .trimEnd(),
    )
    .join("\n");
}

function buildWriteAuditMeta(writeResult: WriteResultMeta | undefined, messageText: string): WriteAuditMeta | null {
  if (!writeResult) return null;

  const payload = asRecord(writeResult.payload);
  const action = (readString(writeResult.action) || readString(payload?.action) || "").toLowerCase();
  const candidateName = readString(payload?.candidate_name) || extractCandidateNameFromMessage(messageText);

  if (writeResult.outcome === "failed") {
    const errorLabel = readString(payload?.error);
    if (action === "update_candidate_status") {
      return {
        text: `${candidateName ? `${candidateName}: ` : ""}Candidate status update failed${errorLabel ? ` (${errorLabel})` : ""}`,
        tone: "error",
      };
    }
    return {
      text: `Write failed${errorLabel ? `: ${errorLabel}` : ""}`,
      tone: "error",
    };
  }

  if (action === "update_candidate_status") {
    const changedFields = asRecord(payload?.changed_fields);
    const statusField = asRecord(changedFields?.status);
    const fromStatusRaw = readString(statusField?.from);
    const toStatusRaw = readString(statusField?.to);
    const fromStatus = formatTokenLabel(fromStatusRaw);
    const toStatus = formatTokenLabel(toStatusRaw);
    const namePrefix = candidateName ? `${candidateName}: ` : "";

    if (writeResult.outcome === "no_change") {
      return {
        text: `${namePrefix}Status unchanged${toStatus ? `: ${toStatus}` : ""}.`,
        tone: "neutral",
      };
    }

    if (fromStatus && toStatus) {
      return {
        text: `${namePrefix}Status: ${fromStatus} to ${toStatus}.`,
        tone: "success",
      };
    }

    if (toStatus) {
      return {
        text: `${namePrefix}Status: ${toStatus}.`,
        tone: "success",
      };
    }

    return {
      text: `${namePrefix}Status updated.`,
      tone: "success",
    };
  }

  if (action === "update_candidate_profession") {
    const changedFields = asRecord(payload?.changed_fields);
    const professionField = asRecord(changedFields?.profession);
    const specialtyField = asRecord(changedFields?.specialty);
    const professionTo = formatTokenLabel(readString(professionField?.to));
    const specialtyTo = formatTokenLabel(readString(specialtyField?.to));
    const updates: string[] = [];
    if (professionTo) updates.push(`Profession: ${professionTo}`);
    if (specialtyTo) updates.push(`Specialty: ${specialtyTo}`);
    const changeText = updates.length > 0 ? updates.join(" · ") : "Profile fields updated";
    return {
      text: `${candidateName ? `${candidateName}: ` : ""}${changeText}.`,
      tone: writeResult.outcome === "no_change" ? "neutral" : "success",
    };
  }

  const actionLabel = formatTokenLabel(action) || "Record Write";
  if (writeResult.outcome === "no_change") {
    return {
      text: `${actionLabel}: no record change.`,
      tone: "neutral",
    };
  }

  const rowsUpdated = typeof writeResult.rowsUpdated === "number" ? writeResult.rowsUpdated : null;
  return {
    text:
      rowsUpdated !== null
        ? `${actionLabel}: ${rowsUpdated} row${rowsUpdated === 1 ? "" : "s"} updated.`
        : `${actionLabel}: updated.`,
    tone: "success",
  };
}

function maybeDecodeTransportText(value: string): string {
  const input = String(value || "");
  if (!input) return "";
  const hasPercentEncoded = /%[0-9A-F]{2}/i.test(input);
  const plusCount = (input.match(/\+/g) || []).length;
  if (!hasPercentEncoded && plusCount < 3) return input;
  const normalized = input.replace(/\+/g, " ");
  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}

function parseEmailDraft(text: string): { to: string | null; subject: string | null; body: string } {
  const normalizedText = maybeDecodeTransportText(text);
  const lines = normalizedText.split("\n");
  let to: string | null = null;
  let subject: string | null = null;
  let bodyStart = 0;

  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    const line = lines[i].trim();
    if (!to) {
      const toMatch = line.match(/^(?:To|Recipient):\s*(.+)$/i);
      if (toMatch) { to = toMatch[1].trim(); bodyStart = i + 1; continue; }
    }
    if (!subject) {
      const subMatch = line.match(/^Subject:\s*(.+)$/i);
      if (subMatch) { subject = subMatch[1].trim(); bodyStart = i + 1; continue; }
    }
    if (to || subject) {
      if (line === "" || line === "---") { bodyStart = i + 1; continue; }
      break;
    }
  }

  // Also try to extract subject from the surrounding markdown
  if (!subject) {
    const subjectLineMatch = normalizedText.match(/Subject:\s*(.+)/i);
    if (subjectLineMatch) {
      subject = subjectLineMatch[1].replace(/\*\*/g, "").trim();
    }
  }

  const body = lines.slice(bodyStart).join("\n").trim();
  return { to, subject, body };
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function extractEmailCandidates(text: string): string[] {
  if (!text) return [];
  const matches = text.match(EMAIL_PATTERN) || [];
  const deduped: string[] = [];
  for (const raw of matches) {
    const normalized = raw.replace(/[),.;:]+$/g, "").trim();
    if (!normalized) continue;
    if (!deduped.some((entry) => entry.toLowerCase() === normalized.toLowerCase())) {
      deduped.push(normalized);
    }
  }
  return deduped;
}

function pickLikelyDraftRecipient(parsedTo: string | null, sourceText: string, body: string): string | null {
  const explicit = String(parsedTo || "").trim();
  if (explicit) {
    const explicitEmails = extractEmailCandidates(explicit);
    if (explicitEmails.length > 0) return explicitEmails[0];
  }

  const lines = `${sourceText}\n${body}`.split("\n");
  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line) continue;
    if (!/(^to:|^recipient:|candidate email|^email:)/i.test(line)) continue;
    const lineEmails = extractEmailCandidates(line);
    if (lineEmails.length > 0) return lineEmails[0];
  }

  const all = extractEmailCandidates(`${sourceText}\n${body}`);
  if (all.length === 0) return null;
  const nonAya = all.find((email) => !/@ayahealthcare\.com$/i.test(email));
  return nonAya || all[0];
}

function buildDraftClipboardText(to: string, subject: string, body: string): string {
  const lines: string[] = [];
  const cleanTo = to.trim();
  const cleanSubject = normalizeDraftTypography(subject.trim());
  const cleanBody = normalizeDraftTypography(body.trim());
  if (cleanTo) lines.push(`To: ${cleanTo}`);
  if (cleanSubject) lines.push(`Subject: ${cleanSubject}`);
  if (cleanTo || cleanSubject) lines.push("");
  lines.push(cleanBody);
  return lines.join("\n").trim();
}

function cleanBodyForEmail(raw: string): string {
  const normalized = maybeDecodeTransportText(raw);
  return normalizeDraftTypography(
    normalized
    // Strip bold markers
    .replace(/\*\*(.+?)\*\*/g, "$1")
    // Strip italic markers
    .replace(/\*(.+?)\*/g, "$1")
    // Convert markdown bullets to plain bullets
    .replace(/^[-*]\s+/gm, "• ")
    // Strip heading markers
    .replace(/^#{1,6}\s+/gm, "")
    // Strip inline code backticks
    .replace(/`([^`]+)`/g, "$1")
    // Strip markdown links, keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Collapse 3+ blank lines to 2
    .replace(/\n{3,}/g, "\n\n")
    .trim(),
  );
}

function encodeOutlookParam(value: string): string {
  return encodeURIComponent(value);
}

function buildOutlookComposeUrl(to: string | null, subject: string | null, body: string): string {
  const cleanSubject = subject ? normalizeDraftTypography(subject.replace(/\*\*/g, "")) : null;
  const cleanBody = cleanBodyForEmail(body);
  const params: Array<[string, string]> = [];
  if (to) params.push(["to", to]);
  if (cleanSubject) params.push(["subject", cleanSubject]);
  if (cleanBody) params.push(["body", cleanBody]);
  const query = params
    .map(([key, value]) => `${key}=${encodeOutlookParam(value)}`)
    .join("&");
  return query
    ? `https://outlook.office.com/mail/deeplink/compose?${query}`
    : "https://outlook.office.com/mail/deeplink/compose";
}

function DraftEmailCard({
  msg,
  mode,
  copiedId,
  copyToClipboard,
  fallbackBody,
}: {
  msg: Message;
  mode: ConsoleMode;
  copiedId: string | null;
  copyToClipboard: CopyDraftFn;
  fallbackBody: string;
}) {
  const parsed = parseEmailDraft(fallbackBody);
  const baseBody = normalizeDraftTypography(parsed.body || fallbackBody);
  const normalizedSubject = normalizeDraftTypography(parsed.subject || "");
  const detectedRecipient = pickLikelyDraftRecipient(parsed.to, msg.text, baseBody);
  const [isEditing, setIsEditing] = React.useState<boolean>(!detectedRecipient);
  const [editableTo, setEditableTo] = React.useState<string>(detectedRecipient || "");
  const [editableSubject, setEditableSubject] = React.useState<string>(normalizedSubject);
  const [editableBody, setEditableBody] = React.useState<string>(baseBody);

  React.useEffect(() => {
    setEditableTo(detectedRecipient || "");
    setEditableSubject(normalizedSubject);
    setEditableBody(baseBody);
    setIsEditing(!detectedRecipient);
  }, [msg.id, detectedRecipient, normalizedSubject, baseBody]);

  const outlookUrl = buildOutlookComposeUrl(
    editableTo.trim() || null,
    editableSubject.trim() || null,
    editableBody,
  );
  const clipboardDraft = buildDraftClipboardText(editableTo, editableSubject, editableBody);

  return (
    <div className="c-draft-card">
      {(editableSubject || editableTo) && (
        <div className="c-draft-header">
          <div className="c-draft-header-icon">
            <Mail size={16} />
          </div>
          <div className="c-draft-header-meta">
            {editableSubject && (
              <div className="c-draft-subject">{editableSubject}</div>
            )}
            {editableTo && (
              <div className="c-draft-to">To: {editableTo}</div>
            )}
          </div>
        </div>
      )}

      {isEditing ? (
        <div className="c-draft-fields">
          <label className="c-draft-field">
            <span className="c-draft-field-label">To</span>
            <input
              className="c-draft-input"
              type="email"
              autoComplete="email"
              placeholder="candidate@email.com"
              value={editableTo}
              onChange={(event) => setEditableTo(event.target.value)}
            />
          </label>
          <label className="c-draft-field">
            <span className="c-draft-field-label">Subject</span>
            <input
              className="c-draft-input"
              type="text"
              placeholder="Email subject"
              value={editableSubject}
              onChange={(event) => setEditableSubject(event.target.value)}
            />
          </label>
          <label className="c-draft-field">
            <span className="c-draft-field-label">Body</span>
            <textarea
              className="c-draft-textarea"
              placeholder="Draft body"
              value={editableBody}
              onChange={(event) => setEditableBody(event.target.value)}
            />
          </label>
        </div>
      ) : (
        <pre className="c-draft-text">{editableBody}</pre>
      )}

      <div className="c-draft-actions">
        <button
          className="c-action-btn c-draft-copy-btn"
          onClick={() => setIsEditing((current) => !current)}
        >
          {isEditing ? "Done editing" : "Inline edit"}
        </button>
        <a
          href={outlookUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="c-action-btn c-action-btn-outlook c-draft-copy-btn"
        >
          <ExternalLink size={13} />
          Open in Outlook
        </a>
        <button
          className="c-action-btn c-draft-copy-btn"
          onClick={() =>
            copyToClipboard(clipboardDraft, msg.id, mode, {
              primaryOnly: false,
            })
          }
        >
          {copiedId === msg.id ? <Check size={13} /> : <Copy size={13} />}
          {copiedId === msg.id ? "Copied" : "Copy draft"}
        </button>
      </div>
    </div>
  );
}

export function ChatMessages({
  state,
  dispatch,
  inputRef,
  messagesEndRef,
  visibleMessages,
  approvingSnapshotMessageId,
  ingestingCandidateMessageId,
  expandedWritePayloads,
  setExpandedWritePayloads,
  setSourcesMsg,
  setRightPanelMode,
  handleApproveHealthcareSnapshot,
  handleAddCandidateToSystem,
  onRetryAssistantMessage,
  copyToClipboard,
  modeConfig,
}: ChatMessagesProps) {
  const imagePromptMessageIds = new Set(
    visibleMessages
      .filter((message) => message.role === "user" && Boolean(message.imageUrl))
      .map((message) => message.id),
  );

  return (
        <div className="c-scroll">
          <div className="c-messages">
            {visibleMessages.length === 0 && (
              <div className="c-empty">
                <h2 className="c-empty-heading">What do you want to know?</h2>
                <div className="c-starters">
                  {modeConfig.suggestions.map((s) => (
                    <button
                      key={s}
                      className="c-starter"
                      onClick={() => { dispatch({ type: "SET_INPUT", payload: s }); inputRef.current?.focus(); }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {visibleMessages.map((msg) => (
              <div
                key={msg.id}
                className={`c-row ${msg.role === "user" ? "c-row-user" : "c-row-assistant"}`}
              >
                {msg.role === "user" ? (
                  (() => {
                    const userDisplay = buildUserDisplayContent(msg.text);
                    return (
                      <div className="c-user">
                        {msg.imageUrl && (
                          <div className="c-user-img">
                            <img src={msg.imageUrl} alt="Attached" />
                          </div>
                        )}
                        <div className="c-user-text">{userDisplay.previewText}</div>
                        <div className="c-msg-time">{formatMessageTimestamp(msg.timestamp)}</div>
                      </div>
                    );
                  })()
                ) : (
                  (() => {
                    const assistantDisplay = buildAssistantDisplayContent(msg.text, state.mode);
                    const shouldRenderDraftCard =
                      CLEAN_COPY_MODES.has(state.mode) &&
                      Boolean(assistantDisplay.primaryCopyBlock);
                    const isRetryableFailure =
                      !msg.isStreaming &&
                      msg.isRetryableError === true &&
                      msg.writeResult?.outcome === "failed";
                    const hasRecoveredFromFailure =
                      !msg.isStreaming &&
                      !isRetryableFailure &&
                      Boolean(msg.lastFailureText);
                    const failedAt = msg.lastFailureAt ? new Date(msg.lastFailureAt) : null;
                    const failedAtLabel =
                      failedAt && !Number.isNaN(failedAt.getTime())
                        ? formatMessageTimestamp(failedAt)
                        : null;
                    const writeAuditMeta = buildWriteAuditMeta(msg.writeResult, msg.text);
                    const replyMarkdown = shouldRenderDraftCard
                      ? assistantDisplay.visibleMarkdownWithoutPrimaryCopyBlock
                      : assistantDisplay.visibleMarkdown;
                    const hasReplyMarkdown = Boolean(replyMarkdown.trim());
                    const shouldRenderReplyBody = msg.text && hasReplyMarkdown && !isRetryableFailure;
                    const showLoadedMarker =
                      !msg.isStreaming &&
                      !isRetryableFailure &&
                      Boolean(msg.text?.trim()) &&
                      !hasRecoveredFromFailure;
                    return (
                      <div className={`c-reply ${isRetryableFailure ? "c-reply-failed" : ""}`}>
                        {hasRecoveredFromFailure && (
                          <div className="c-retry-history c-retry-history-muted">
                            <span className="c-retry-history-label">
                              Failed attempt{failedAtLabel ? ` (${failedAtLabel})` : ""}
                            </span>
                            <span className="c-retry-history-text">{msg.lastFailureText}</span>
                          </div>
                        )}
                        {isRetryableFailure && (
                          <div className="c-retry-history c-retry-history-error">
                            <span className="c-retry-history-label">
                              Attempt failed{failedAtLabel ? ` (${failedAtLabel})` : ""}
                            </span>
                            {msg.lastFailureText && <span className="c-retry-history-text">{msg.lastFailureText}</span>}
                          </div>
                        )}
                        {showLoadedMarker && (
                          <div className="c-loaded" aria-label="Record loaded">
                            <span className="c-loaded-dot" />
                            <span>Record loaded</span>
                          </div>
                        )}
                        {msg.toolStatuses && msg.toolStatuses.length > 0 && (
                          <div className="aya-message-tools">
                            {msg.toolStatuses.map((st, i) => {
                              const indicator = st.status === "running" ? "[...]" : st.status === "ok" ? "[v]" : "[x]";
                              return (
                              <div key={`${st.tool}-${i}`} className={`aya-tool-chip aya-tool-${st.status}`} style={{ animationDelay: `${i * 80}ms` }} title={st.label}>
                                <span className={`aya-tool-dot aya-tool-dot-${st.status}`} aria-hidden="true" />
                                <span className="aya-tool-label">{indicator}</span>
                              </div>
                            )})}
                          </div>
                        )}
                        {shouldRenderReplyBody ? (
                          <div
                            className="c-body"
                            dangerouslySetInnerHTML={{ __html: formatMarkdown(replyMarkdown) }}
                          />
                        ) : msg.isStreaming ? (
                          <div className="c-thinking">
                            <span className="c-thinking-dot" />
                            <span className="c-thinking-dot" />
                            <span className="c-thinking-dot" />
                          </div>
                        ) : (isRetryableFailure || shouldRenderDraftCard) ? null : (
                          <div className="c-empty-reply">
                            No response returned. Please retry.
                          </div>
                        )}

                        {!msg.isStreaming && shouldRenderDraftCard && assistantDisplay.primaryCopyBlock && (() => {
                          return (
                            <DraftEmailCard
                              msg={msg}
                              mode={state.mode}
                              copiedId={state.copiedId}
                              copyToClipboard={copyToClipboard}
                              fallbackBody={assistantDisplay.primaryCopyBlock}
                            />
                          );
                        })()}

                        {/* Code execution blocks */}
                        {msg.codeBlocks && msg.codeBlocks.length > 0 && (
                          <div className="c-exec-blocks">
                            {msg.codeBlocks.map((block, i) => (
                              <div key={i} className="c-exec">
                                <div className="c-exec-header">
                                  <span className="c-exec-lang">{block.language?.toLowerCase() || "python"}</span>
                                  <span className="c-exec-label">{block.outcome ? "ran" : "running..."}</span>
                                </div>
                                <pre className="c-exec-code"><code>{block.code}</code></pre>
                                {block.output && (
                                  <div className={`c-exec-output ${block.outcome === "OUTCOME_OK" ? "" : "c-exec-error"}`}>
                                    <div className="c-exec-output-label">{block.outcome === "OUTCOME_OK" ? "Output" : "Error"}</div>
                                    <pre>{block.output}</pre>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {msg.isStreaming && msg.text && <span className="c-cursor" />}

                        {!msg.isStreaming && msg.text && (
                          <>
                            {writeAuditMeta && !isRetryableFailure && (
                              <div className={`c-write-audit c-write-audit-${writeAuditMeta.tone}`}>
                                <span className="c-write-audit-dot" />
                                <span className="c-write-audit-text">{writeAuditMeta.text}</span>
                              </div>
                            )}
                            <div className="c-actions">
                              {isRetryableFailure && (
                                <button
                                  className="c-action-btn c-action-btn-primary c-action-btn-retry"
                                  onClick={() => onRetryAssistantMessage(msg.id)}
                                  disabled={state.loading}
                                >
                                  Retry
                                </button>
                              )}
                              {state.mode === "healthcare" && (
                                <button
                                  className="c-action-btn c-action-btn-primary"
                                  onClick={() => handleApproveHealthcareSnapshot(msg)}
                                  disabled={
                                    Boolean(approvingSnapshotMessageId) ||
                                    (msg.writeResult?.action === "approve_research_snapshot" &&
                                      msg.writeResult.outcome !== "failed")
                                  }
                                >
                                  {approvingSnapshotMessageId === msg.id
                                    ? "Saving..."
                                    : msg.writeResult?.action === "approve_research_snapshot" &&
                                      msg.writeResult.outcome !== "failed"
                                      ? "Approved"
                                      : "Approve snapshot"}
                                </button>
                              )}
                              {(state.mode === "ayaops" || state.mode === "facility" || state.mode === "margins") &&
                                hasExtractedCandidateSnapshot(msg.text) &&
                                Boolean(msg.requestUserMessageId && imagePromptMessageIds.has(msg.requestUserMessageId)) &&
                                msg.writeResult?.action !== "candidate_ingest" && (
                                <button
                                  className="c-action-btn c-action-btn-primary"
                                  onClick={() => handleAddCandidateToSystem(msg)}
                                  disabled={Boolean(ingestingCandidateMessageId)}
                                >
                                  {ingestingCandidateMessageId === msg.id
                                    ? "Adding..."
                                    : "Add Snapshot"}
                                </button>
                              )}
                              {msg.writeResult?.action === "candidate_ingest" &&
                                msg.writeResult.outcome !== "failed" && (
                                <span className="c-action-btn" style={{ opacity: 0.7, cursor: "default" }}>
                                  Added
                                </span>
                              )}
                              {!shouldRenderDraftCard && !isRetryableFailure && (
                                <button
                                  className={`c-action-btn ${CLEAN_COPY_MODES.has(state.mode) && assistantDisplay.primaryCopyBlock ? "c-action-btn-primary" : ""}`}
                                  onClick={() =>
                                    copyToClipboard(msg.text, msg.id, state.mode, {
                                      primaryOnly: CLEAN_COPY_MODES.has(state.mode) && Boolean(assistantDisplay.primaryCopyBlock),
                                    })
                                  }
                                >
                                  {state.copiedId === msg.id ? <Check size={13} /> : <Copy size={13} />}
                                  {state.copiedId === msg.id
                                    ? "Copied"
                                    : CLEAN_COPY_MODES.has(state.mode) && assistantDisplay.primaryCopyBlock
                                      ? "Copy draft"
                                      : "Copy"}
                                </button>
                              )}
                              {((msg.citations && msg.citations.length > 0) ||
                                (msg.queries && msg.queries.length > 0)) && (
                                  <button
                                    className="c-action-btn c-sources-btn"
                                    onClick={() => {
                                      setSourcesMsg(msg);
                                      setRightPanelMode("sources");
                                    }}
                                  >
                                    <ChevronDown size={13} />
                                    {msg.citations && msg.citations.length > 0
                                      ? `${msg.citations.length} source${msg.citations.length > 1 ? "s" : ""}`
                                      : `${msg.queries?.length || 0} quer${(msg.queries?.length || 0) === 1 ? "y" : "ies"}`}
                                  </button>
                                )}
                              {msg.writeResult && state.mode === "code" && (
                                <button
                                  type="button"
                                  className="c-write-toggle"
                                  onClick={() => {
                                    setExpandedWritePayloads((current) => {
                                      const next = new Set(current);
                                      if (next.has(msg.id)) next.delete(msg.id);
                                      else next.add(msg.id);
                                      return next;
                                    });
                                  }}
                                >
                                  {expandedWritePayloads.has(msg.id) ? "Hide details" : "Details"}
                                </button>
                              )}
                              <span className="c-msg-time">{formatMessageTimestamp(msg.timestamp)}</span>
                            </div>
                          </>
                        )}
                        {!msg.isStreaming && state.mode === "code" && msg.writeResult && expandedWritePayloads.has(msg.id) && (
                          <pre className="c-write-payload">
                            {JSON.stringify(writePayloadForDisplay(msg.writeResult), null, 2)}
                          </pre>
                        )}
                      </div>
                    );
                  })()
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>
  );
}

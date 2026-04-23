import React, { SetStateAction } from "react";
import { Loader2, CheckCircle, AlertCircle, Copy, Check, ChevronDown } from "lucide-react";
import { ChatState, ChatAction, Message, ModeConfig, WriteResultMeta, ConsoleMode } from "@/lib/types/chat";
import {
  buildUserDisplayContent, buildAssistantDisplayContent, formatMessageTimestamp,
  formatMarkdown, writeOutcomeLabel, writePayloadForDisplay, CLEAN_COPY_MODES
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
  copyToClipboard: (text: string, id: string, mode: ConsoleMode, options?: { primaryOnly?: boolean }) => Promise<void>;
  modeConfig: ModeConfig;
}

export function ChatMessages({ state, dispatch, inputRef, messagesEndRef, visibleMessages, approvingSnapshotMessageId, ingestingCandidateMessageId, expandedWritePayloads, setExpandedWritePayloads, setSourcesMsg, setRightPanelMode, handleApproveHealthcareSnapshot, handleAddCandidateToSystem, copyToClipboard, modeConfig }: ChatMessagesProps) {
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
              <div key={msg.id} className="c-row">
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
                    const replyMarkdown = shouldRenderDraftCard
                      ? assistantDisplay.visibleMarkdownWithoutPrimaryCopyBlock
                      : assistantDisplay.visibleMarkdown;
                    const hasReplyMarkdown = Boolean(replyMarkdown.trim());
                    return (
                      <div className="c-reply">
                        {msg.toolStatuses && msg.toolStatuses.length > 0 && (
                          <div className="aya-message-tools">
                            {msg.toolStatuses.map((st, i) => (
                              <div key={`${st.tool}-${i}`} className={`aya-tool-chip aya-tool-${st.status}`} style={{ animationDelay: `${i * 80}ms` }}>
                                <span className="aya-tool-icon">
                                  {st.status === "running" ? <Loader2 /> : st.status === "ok" ? <CheckCircle /> : <AlertCircle />}
                                </span>
                                <span className="aya-tool-label">{st.label}</span>
                                {st.latencyMs != null && st.latencyMs > 0 && <span className="aya-tool-latency">{st.latencyMs}ms</span>}
                              </div>
                            ))}
                          </div>
                        )}
                        {msg.text && hasReplyMarkdown ? (
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
                        ) : shouldRenderDraftCard ? null : (
                          <div className="c-empty-reply">
                            No response returned. Please retry.
                          </div>
                        )}

                        {!msg.isStreaming && shouldRenderDraftCard && assistantDisplay.primaryCopyBlock && (
                          <div className="c-draft-card">
                            <pre className="c-draft-text">{assistantDisplay.primaryCopyBlock}</pre>
                            <div className="c-draft-actions">
                              <button
                                className="c-action-btn c-action-btn-primary c-draft-copy-btn"
                                onClick={() =>
                                  copyToClipboard(msg.text, msg.id, state.mode, {
                                    primaryOnly: true,
                                  })
                                }
                              >
                                {state.copiedId === msg.id ? <Check size={13} /> : <Copy size={13} />}
                                {state.copiedId === msg.id ? "Copied" : "Copy draft"}
                              </button>
                            </div>
                          </div>
                        )}

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
                          <div className="c-actions">
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
                              /Candidate Profile[:\s]/i.test(msg.text) &&
                              msg.writeResult?.action !== "candidate_ingest" && (
                              <button
                                className="c-action-btn c-action-btn-primary"
                                onClick={() => handleAddCandidateToSystem(msg)}
                                disabled={Boolean(ingestingCandidateMessageId)}
                              >
                                {ingestingCandidateMessageId === msg.id
                                  ? "Adding..."
                                  : "Add to System"}
                              </button>
                            )}
                            {msg.writeResult?.action === "candidate_ingest" &&
                              msg.writeResult.outcome !== "failed" && (
                              <span className="c-action-btn" style={{ opacity: 0.7, cursor: "default" }}>
                                Added
                              </span>
                            )}
                            {!shouldRenderDraftCard && (
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
                            {msg.writeResult && (
                              <span
                                className={`c-write-badge c-write-${msg.writeResult.outcome}`}
                                title={msg.writeResult.outcome === "failed" ? "Action failed" : "Saved to record"}
                              >
                                {writeOutcomeLabel(msg.writeResult.outcome)}
                              </span>
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

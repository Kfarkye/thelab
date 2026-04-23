import React, { SetStateAction } from "react";
import { X, Paperclip, Send } from "lucide-react";
import { ChatState, ChatAction, ModeConfig, ImageIntent, SavedImage, ModelOverride } from "@/lib/types/chat";
import { CapabilityDropdown } from "@/app/chat/page"; // Actually, fix later if needed

interface ChatInputProps {
  pendingSavedImage: SavedImage | null;
  setPendingSavedImage: React.Dispatch<SetStateAction<SavedImage | null>>;
  state: ChatState;
  dispatch: React.Dispatch<ChatAction>;
  IMAGE_INTENTS: { value: ImageIntent; icon: React.ReactNode; label: string }[];
  handleSubmit: (e: React.FormEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileSelect: (file: File) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handlePaste: (e: React.ClipboardEvent) => void;
  modeConfig: ModeConfig;
  modelOverride: ModelOverride;
  setModelOverride: (val: ModelOverride) => void;
  uploadingImage: boolean;
  CapabilityDropdown: any;
}

export function ChatInput({ pendingSavedImage, setPendingSavedImage, state, dispatch, IMAGE_INTENTS, handleSubmit, handleDrop, fileInputRef, handleFileSelect, inputRef, handleKeyDown, handlePaste, modeConfig, modelOverride, setModelOverride, uploadingImage, CapabilityDropdown }: ChatInputProps) {
  return (
        <div className="c-dock">
          {pendingSavedImage && (
            <div className="c-img-preview">
              <div style={{ position: "relative" }}>
                <img src={pendingSavedImage.previewUrl} alt="Saved source preview" />
                <button className="c-img-dismiss" onClick={() => setPendingSavedImage(null)}>
                  <X size={12} />
                </button>
              </div>
              {(state.mode === "ayaops" || state.mode === "facility" || state.mode === "margins") && (
                <div className="c-intent-picker">
                  {IMAGE_INTENTS.map((intent) => (
                    <button
                      key={intent.value}
                      type="button"
                      className={`c-intent-chip ${state.imageIntent === intent.value ? "c-intent-active" : ""}`}
                      onClick={() => dispatch({ type: "SET_IMAGE_INTENT", payload: state.imageIntent === intent.value ? null : intent.value })}
                    >
                      <span className="c-intent-icon">{intent.icon}</span>
                      {intent.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {state.pendingImage && (
            <div className="c-img-preview">
              <div style={{ position: "relative" }}>
                <img src={state.pendingImage} alt="Preview" />
                <button className="c-img-dismiss" onClick={() => dispatch({ type: "SET_PENDING_IMAGE", payload: null })}>
                  <X size={12} />
                </button>
              </div>
              {(state.mode === "ayaops" || state.mode === "facility" || state.mode === "margins") && (
                <div className="c-intent-picker">
                  {IMAGE_INTENTS.map((intent) => (
                    <button
                      key={intent.value}
                      type="button"
                      className={`c-intent-chip ${state.imageIntent === intent.value ? "c-intent-active" : ""}`}
                      onClick={() => dispatch({ type: "SET_IMAGE_INTENT", payload: state.imageIntent === intent.value ? null : intent.value })}
                    >
                      <span className="c-intent-icon">{intent.icon}</span>
                      {intent.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <form
            className="c-input-form"
            onSubmit={handleSubmit}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              style={{ display: "none" }}
              onChange={(e) => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]); e.target.value = ""; }}
            />
            <button type="button" className="c-attach-btn" onClick={() => fileInputRef.current?.click()}>
              <Paperclip size={16} />
            </button>
            <textarea
              ref={inputRef}
              value={state.input}
              onChange={(e) => {
                dispatch({ type: "SET_INPUT", payload: e.target.value });
                // Auto-expand
                const el = e.target;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 160) + "px";
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={modeConfig.placeholder}
              className="c-textarea"
              rows={1}
              disabled={state.loading}
            />
            <div className="c-capability-wrap">
              <span className="c-capability-label">Mode</span>
              <CapabilityDropdown
                value={modelOverride}
                onChange={setModelOverride}
                disabled={state.loading || uploadingImage}
                mode={state.mode}
              />
            </div>
            <button
              type="submit"
              className={`c-send-btn ${state.loading ? "c-send-loading" : ""} ${(state.input.trim() || state.pendingImage || pendingSavedImage) && !state.loading ? "c-send-ready" : ""}`}
              disabled={state.loading || uploadingImage || (!state.input.trim() && !state.pendingImage && !pendingSavedImage)}
            >
              {state.loading ? (
                <span className="c-send-spinner" />
              ) : (
                <Send size={16} />
              )}
            </button>
          </form>
        </div>
  );
}

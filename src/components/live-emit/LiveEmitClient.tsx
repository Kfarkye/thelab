"use client";

import { useMemo, useState } from "react";
import { LivePreview } from "@/components/live-emit/LivePreview";
import { useLiveEmit } from "@/hooks/useLiveEmit";
import type { ThinkingLevel } from "@/lib/live-emit/types";
import styles from "./live-emit-client.module.css";

type AppMode = "healthcare" | "sports" | "worldcup" | "code" | "ayaops";

export function LiveEmitClient() {
  const { sessionConfig, connectionState, error, packets, latestPacket, liveState, start, disconnect } = useLiveEmit();
  const [mode, setMode] = useState<AppMode>("sports");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("HIGH");
  const [includeThoughts, setIncludeThoughts] = useState(false);
  const [prompt, setPrompt] = useState(
    "Create a live xG risk panel for Mexico vs South Africa, include one veto signal if tactical pressure shifts.",
  );

  const canStart = prompt.trim().length > 0 && connectionState !== "connecting" && connectionState !== "streaming";
  const packetPreview = useMemo(() => packets.slice(-12).reverse(), [packets]);

  return (
    <main className={styles.root}>
      <div className={styles.wrap}>
        <section className={styles.panel}>
          <h1 className={styles.title}>Live Emit Orchestrator</h1>
          <p className={styles.meta}>
            Vertex-backed packet streaming with <code>thinking_level</code> control and deploy-safe blob preview.
          </p>

          <label className={styles.field}>
            <span className={styles.label}>Mode</span>
            <select className={styles.select} value={mode} onChange={(e) => setMode(e.target.value as AppMode)}>
              <option value="sports">sports</option>
              <option value="worldcup">worldcup</option>
              <option value="healthcare">healthcare</option>
              <option value="ayaops">ayaops</option>
              <option value="code">code</option>
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Thinking Level</span>
            <select
              className={styles.select}
              value={thinkingLevel}
              onChange={(e) => setThinkingLevel(e.target.value as ThinkingLevel)}
            >
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Prompt</span>
            <textarea className={styles.textarea} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </label>

          <label className={styles.toggleRow}>
            <input
              type="checkbox"
              checked={includeThoughts}
              onChange={(e) => setIncludeThoughts(e.target.checked)}
            />
            Include thoughts summaries (if model returns them)
          </label>

          <div className={styles.btnRow}>
            <button
              className={styles.btnPrimary}
              disabled={!canStart}
              onClick={() => start({ prompt, mode, thinkingLevel, includeThoughts })}
            >
              {connectionState === "streaming" ? "Streaming…" : "Start Live Emit"}
            </button>
            <button className={styles.btnSecondary} onClick={disconnect}>
              Stop
            </button>
          </div>

          <div className={styles.status}>
            State: <strong>{connectionState}</strong>
            {sessionConfig ? (
              <>
                {" "}
                · Model: <strong>{sessionConfig.model}</strong>
              </>
            ) : null}
          </div>
          {error ? <div className={styles.error}>{error}</div> : null}

          <div className={styles.packetList}>
            {packetPreview.map((packet) => (
              <div className={styles.packetItem} key={packet.id}>
                <span>{packet.type}</span>
                <span>{new Date(packet.payload.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.panel}>
          <LivePreview
            componentName={liveState.componentName}
            props={liveState.props}
            rawHtml={liveState.rawHtml}
            reasoningLog={liveState.reasoningLog}
            latestPacket={latestPacket}
          />
        </section>
      </div>
    </main>
  );
}


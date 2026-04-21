"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LiveEmitPacket } from "@/lib/live-emit/types";

function sanitizeHtml(input: string): string {
  return String(input || "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+=(['"]).*?\1/gi, "")
    .replace(/\sjavascript:/gi, "");
}

function formatCurrency(value: unknown): string {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return "$0";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    amount,
  );
}

function VetoGauge({ props }: { props: Record<string, unknown> }) {
  const level = String(props.level || "Low");
  const reason = String(props.reason || "No blocking risk detected.");
  const score = Number(props.score ?? (level.toLowerCase() === "high" ? 88 : level.toLowerCase() === "medium" ? 58 : 24));
  const pct = Math.max(0, Math.min(100, Number.isFinite(score) ? score : 0));
  return (
    <div className="le-card le-veto">
      <div className="le-kicker">Veto Signal</div>
      <div className="le-veto-head">
        <div className="le-veto-level">{level}</div>
        <div className="le-veto-score">{pct}%</div>
      </div>
      <div className="le-veto-bar">
        <motion.div
          className="le-veto-fill"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ type: "spring", stiffness: 150, damping: 20 }}
        />
      </div>
      <p className="le-text">{reason}</p>
    </div>
  );
}

function MatchSnapshot({ props }: { props: Record<string, unknown> }) {
  const title = String(props.title || "Live Snapshot");
  const primary = String(props.primary || props.summary || "No primary signal yet.");
  const secondary = String(props.secondary || "");
  const marketEdge = Number(props.marketEdge || 0);
  const estValue = Number(props.estimatedValue || 0);
  return (
    <div className="le-card">
      <div className="le-kicker">{title}</div>
      <p className="le-text le-primary">{primary}</p>
      {secondary ? <p className="le-text">{secondary}</p> : null}
      <div className="le-metrics">
        <div>
          <div className="le-metric-label">Market Edge</div>
          <div className="le-metric-value">{marketEdge > 0 ? "+" : ""}{marketEdge.toFixed(2)}</div>
        </div>
        <div>
          <div className="le-metric-label">Est. Value</div>
          <div className="le-metric-value">{formatCurrency(estValue)}</div>
        </div>
      </div>
    </div>
  );
}

export function LivePreview({
  componentName,
  props,
  rawHtml,
  reasoningLog,
  latestPacket,
}: {
  componentName: string | null;
  props: Record<string, unknown>;
  rawHtml: string | null;
  reasoningLog: string | null;
  latestPacket: LiveEmitPacket | null;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const sanitizedHtml = useMemo(() => (rawHtml ? sanitizeHtml(rawHtml) : ""), [rawHtml]);

  useEffect(() => {
    if (!sanitizedHtml) {
      setBlobUrl(null);
      return;
    }
    const htmlDoc = `<!doctype html><html><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head><body>${sanitizedHtml}</body></html>`;
    const blob = new Blob([htmlDoc], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [sanitizedHtml]);

  return (
    <div className="le-preview">
      <AnimatePresence mode="wait">
        {componentName === "VetoGauge" ? (
          <motion.div key="veto" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <VetoGauge props={props} />
          </motion.div>
        ) : (
          <motion.div key="snapshot" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <MatchSnapshot props={props} />
          </motion.div>
        )}
      </AnimatePresence>

      {sanitizedHtml ? (
        <div className="le-card">
          <div className="le-kicker">Rendered HTML</div>
          <iframe
            title="Live emit isolated preview"
            className="le-html-frame"
            sandbox=""
            srcDoc={`<!doctype html><html><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><style>body{margin:0;padding:12px;font-family:DM Sans,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;color:#1f1d1a;line-height:1.5}</style></head><body>${sanitizedHtml}</body></html>`}
          />
          {blobUrl ? (
            <a href={blobUrl} target="_blank" rel="noopener noreferrer" className="le-link">
              Open Blob Preview
            </a>
          ) : null}
        </div>
      ) : null}

      {reasoningLog ? (
        <div className="le-card le-debug">
          <div className="le-kicker">Reasoning Summary</div>
          <p className="le-text">{reasoningLog}</p>
        </div>
      ) : null}

      {latestPacket ? (
        <div className="le-foot">
          Last packet: <strong>{latestPacket.type}</strong> · {new Date(latestPacket.payload.timestamp).toLocaleTimeString()}
        </div>
      ) : null}
    </div>
  );
}

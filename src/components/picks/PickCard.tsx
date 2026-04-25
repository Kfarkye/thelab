"use client";

import { useState } from "react";

export type PickCardData = {
  id: string;
  display: string;
  priority: string | null;
  kicker: string | null;
  rationale: string | null;
  event_status: string | null;
  grading_status: string | null;
  result?: number | null;
  live?: {
    current_score?: string | null;
    pace_summary?: string | null;
    progress?: string | null;
  } | null;
  is_live_stale?: boolean;
  ticker?: string | null;
  public_url?: string | null;
};

function formatUnits(result: number | null | undefined): string | null {
  if (typeof result !== "number" || !Number.isFinite(result)) return null;
  const rounded = Math.round(result * 100) / 100;
  const serialized = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/\.?0+$/, "");
  return `${rounded > 0 ? "+" : ""}${serialized}U`;
}

function resolveResultBadge(pick: PickCardData): { text: string; tone: "is-win" | "is-loss" | "is-push" | "is-void" } | null {
  const gradingStatus = String(pick.grading_status || "").toUpperCase();
  const units = formatUnits(pick.result);

  if (gradingStatus === "PENDING" || !gradingStatus) return null;
  if (gradingStatus === "WON") {
    return { text: units || "WON", tone: "is-win" };
  }
  if (gradingStatus === "LOST") {
    return { text: units || "LOST", tone: "is-loss" };
  }
  if (gradingStatus === "PUSH") {
    return { text: "PUSH", tone: "is-push" };
  }
  if (gradingStatus === "VOID") {
    return { text: "VOID", tone: "is-void" };
  }

  if (units) {
    return {
      text: units,
      tone: Number(pick.result || 0) > 0 ? "is-win" : Number(pick.result || 0) < 0 ? "is-loss" : "is-push",
    };
  }
  return null;
}

export function PickCard({
  pick,
  onAddToBook,
}: {
  pick: PickCardData;
  onAddToBook?: (pick: PickCardData) => void;
}) {
  const [copied, setCopied] = useState(false);
  const resultBadge = resolveResultBadge(pick);

  const handleCopyTicker = async () => {
    const ticker = String(pick.ticker || "").trim();
    if (!ticker) return;
    try {
      await navigator.clipboard.writeText(ticker);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <article className="pick-card" data-pick-id={pick.id}>
      <div className="pick-card-head">
        {pick.kicker ? <span className="pick-card-kicker">{pick.kicker}</span> : <span className="pick-card-kicker-empty" />}
        <span className="pick-card-priority">{pick.priority || "STANDARD"}</span>
      </div>

      <div className="pick-card-title-row">
        <h3 className="pick-card-title">{pick.display}</h3>
        {resultBadge && (
          <span className={`pick-card-result ${resultBadge.tone}`}>
            {resultBadge.text}
          </span>
        )}
      </div>

      {String(pick.event_status || "").toUpperCase() === "LIVE" && (
        <div className={`pick-card-live ${pick.is_live_stale ? "is-stale" : "is-fresh"}`}>
          <span>
            {pick.is_live_stale
              ? "Signal lost"
              : `Live: ${pick.live?.current_score || "Awaiting score"}`}
          </span>
          {!pick.is_live_stale && <span className="pick-card-live-dot">●</span>}
        </div>
      )}

      <p className="pick-card-rationale">"{pick.rationale || "No rationale provided."}"</p>

      <div className="pick-card-actions">
        <button
          type="button"
          className="pick-card-btn-primary"
          onClick={() => onAddToBook?.(pick)}
        >
          Add to Book
        </button>
        <button
          type="button"
          className="pick-card-btn-secondary"
          onClick={handleCopyTicker}
        >
          {copied ? "Copied" : "Copy Ticker"}
        </button>
      </div>
    </article>
  );
}

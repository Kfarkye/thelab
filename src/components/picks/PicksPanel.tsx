"use client";

import { useMemo, useState } from "react";
import type { PanelItem } from "@/lib/types/chat";
import { PickCard, type PickCardData } from "./PickCard";
import { TrackRecordStrip, type TrackRecordData } from "./TrackRecordStrip";

function mapPick(input: PanelItem): PickCardData {
  const anyRow = input as unknown as Record<string, unknown>;
  return {
    id: String(anyRow.id || input.id || ""),
    display: String(anyRow.display || input.label || "Pick"),
    priority: String(anyRow.priority || "STANDARD"),
    kicker: typeof anyRow.kicker === "string" && anyRow.kicker.trim().length > 0
      ? anyRow.kicker.trim()
      : null,
    rationale: String(anyRow.rationale || ""),
    event_status: String(anyRow.event_status || input.status || ""),
    grading_status: String(anyRow.grading_status || "PENDING"),
    result: typeof anyRow.result === "number" ? (anyRow.result as number) : null,
    live: (anyRow.live as PickCardData["live"]) || null,
    is_live_stale: Boolean(anyRow.is_live_stale),
    ticker: String(anyRow.ticker || ""),
    public_url: typeof anyRow.public_url === "string" ? anyRow.public_url : null,
  };
}

export function PicksPanel({
  picks,
  games,
  track,
  onPrompt,
}: {
  picks: PanelItem[];
  games: PanelItem[];
  track: TrackRecordData | null;
  onPrompt?: (text: string) => void;
}) {
  const [tab, setTab] = useState<"picks" | "games">("picks");
  const pickCards = useMemo(() => picks.map(mapPick), [picks]);

  return (
    <section className="picks-shell" aria-label="Picks shell">
      <div className="picks-shell-tabs" role="tablist" aria-label="Sports shell tabs">
        <button
          type="button"
          className={`picks-shell-tab ${tab === "picks" ? "is-active" : ""}`}
          onClick={() => setTab("picks")}
          role="tab"
          aria-selected={tab === "picks"}
        >
          Picks ({pickCards.length})
        </button>
        <button
          type="button"
          className={`picks-shell-tab ${tab === "games" ? "is-active" : ""}`}
          onClick={() => setTab("games")}
          role="tab"
          aria-selected={tab === "games"}
        >
          Games ({games.length})
        </button>
      </div>

      {tab === "picks" && (
        <>
          <div className="picks-shell-head">
            <span className="picks-shell-head-title">Picks Ledger</span>
            <button
              type="button"
              className="picks-shell-head-link"
              onClick={() => onPrompt?.("Audit all receipts for the last 30 days.")}
            >
              Audit all receipts
            </button>
          </div>
          {track && <TrackRecordStrip stats={track} onAudit={() => onPrompt?.("Show me the last 30 days of graded pick receipts.")} />}
          {pickCards.length === 0 ? (
            <div className="picks-shell-empty">No picks loaded yet.</div>
          ) : (
            <div className="picks-shell-grid">
              {pickCards.map((pick) => (
                <PickCard
                  key={pick.id}
                  pick={pick}
                  onAddToBook={(row) => {
                    onPrompt?.(`Add ${row.display} to my book.`);
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}

      {tab === "games" && (
        <div className="picks-shell-games">
          {games.length === 0 ? (
            <div className="picks-shell-empty">No games loaded yet.</div>
          ) : (
            games.slice(0, 20).map((game) => {
              const title = game.away && game.home ? `${game.away} at ${game.home}` : game.label;
              return (
                <a
                  key={game.id}
                  className="picks-shell-game-row"
                  href={game.publicUrl || game.apiUrl || game.hubUrl || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="picks-shell-game-title">{title}</span>
                  <span className="picks-shell-game-meta">{game.league || "Sports"}</span>
                </a>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}

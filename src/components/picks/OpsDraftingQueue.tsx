"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type QueueFilter = "ALL" | "PENDING" | "COMMITTED" | "REJECTED";

type QueueCounts = {
  total: number;
  pending: number;
  committed: number;
  rejected: number;
};

type QueueItem = {
  id?: string;
  pick_id?: string;
  display?: string;
  kicker?: string | null;
  rationale?: string | null;
  priority_band?: string | null;
  priority?: string | null;
  event_status?: string | null;
  grading_status?: string | null;
  market_type?: string | null;
  side?: string | null;
  line?: number | null;
  draft_status?: "PENDING" | "COMMITTED" | "REJECTED";
  draft_reason?: string | null;
  draft_actor?: string | null;
  draft_action_at?: string | null;
  public_url?: string | null;
  api_url?: string | null;
};

type QueuePayload = {
  counts: QueueCounts;
  items: QueueItem[];
};

function toTitleCase(value: string | null | undefined): string {
  const token = String(value || "").trim();
  if (!token) return "Unknown";
  return token
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDraftTime(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function OpsDraftingQueue() {
  const [filter, setFilter] = useState<QueueFilter>("PENDING");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<QueuePayload>({
    counts: { total: 0, pending: 0, committed: 0, rejected: 0 },
    items: [],
  });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        status: filter,
        limit: "120",
      });

      const response = await fetch(`/api/ops/drafting?${params.toString()}`, {
        method: "GET",
        headers: {
          "Cache-Control": "no-store",
        },
      });

      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        throw new Error(String(failure.error || `Failed to load queue (${response.status})`));
      }

      const json = (await response.json()) as { data?: QueuePayload };
      setPayload(
        json.data || {
          counts: { total: 0, pending: 0, committed: 0, rejected: 0 },
          items: [],
        },
      );
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load drafting queue.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue, refreshToken]);

  const rows = useMemo(() => payload.items || [], [payload.items]);

  async function runMutation(item: QueueItem, action: "commit" | "reject") {
    const pickId = String(item.pick_id || item.id || "").trim();
    if (!pickId) return;

    let reason: string | null = null;
    if (action === "reject") {
      const prompted = window.prompt("Optional rejection reason", item.draft_reason || "") || "";
      reason = prompted.trim() || null;
    }

    const actionKey = `${pickId}:${action}`;
    setBusyKey(actionKey);
    setError(null);

    try {
      const response = await fetch("/api/ops/drafting", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pick_id: pickId,
          action,
          reason,
        }),
      });

      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        throw new Error(String(failure.error || `Mutation failed (${response.status})`));
      }

      setRefreshToken((value) => value + 1);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Mutation failed.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="ops-draft-shell" aria-label="Operator drafting queue">
      <header className="ops-draft-head">
        <div>
          <p className="ops-draft-kicker">Operator Surface</p>
          <h1 className="ops-draft-title">Drafting Queue</h1>
        </div>
        <div className="ops-draft-head-actions">
          <button
            type="button"
            className="ops-draft-btn ops-draft-btn-secondary"
            onClick={() => setRefreshToken((value) => value + 1)}
          >
            Refresh
          </button>
          <a className="ops-draft-btn ops-draft-btn-secondary" href="/api/ops/drafting?status=PENDING" target="_blank" rel="noopener noreferrer">
            Queue API
          </a>
        </div>
      </header>

      <div className="ops-draft-counts" role="status" aria-live="polite">
        <div className="ops-draft-count-card">
          <span>Total</span>
          <strong>{payload.counts.total}</strong>
        </div>
        <div className="ops-draft-count-card is-pending">
          <span>Pending</span>
          <strong>{payload.counts.pending}</strong>
        </div>
        <div className="ops-draft-count-card is-committed">
          <span>Committed</span>
          <strong>{payload.counts.committed}</strong>
        </div>
        <div className="ops-draft-count-card is-rejected">
          <span>Rejected</span>
          <strong>{payload.counts.rejected}</strong>
        </div>
      </div>

      <div className="ops-draft-filters" role="tablist" aria-label="Draft queue filters">
        {(["PENDING", "COMMITTED", "REJECTED", "ALL"] as QueueFilter[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            className={`ops-draft-filter ${filter === value ? "is-active" : ""}`}
            onClick={() => setFilter(value)}
          >
            {toTitleCase(value)}
          </button>
        ))}
      </div>

      {loading ? <div className="ops-draft-empty">Loading queue...</div> : null}
      {!loading && error ? <div className="ops-draft-error">{error}</div> : null}

      {!loading && !error && rows.length === 0 ? (
        <div className="ops-draft-empty">No draft picks in this view.</div>
      ) : null}

      {!loading && !error && rows.length > 0 ? (
        <div className="ops-draft-list">
          {rows.map((item) => {
            const pickId = String(item.pick_id || item.id || "").trim();
            const status = String(item.draft_status || "PENDING").toUpperCase();
            const isPending = status === "PENDING";

            return (
              <article key={pickId} className="ops-draft-card" data-pick-id={pickId}>
                <div className="ops-draft-card-head">
                  <span className="ops-draft-chip">{item.kicker || "Draft"}</span>
                  <span className={`ops-draft-chip ops-draft-chip-status status-${status.toLowerCase()}`}>
                    {toTitleCase(status)}
                  </span>
                </div>

                <h2 className="ops-draft-card-title">{item.display || "Untitled pick"}</h2>

                <p className="ops-draft-card-meta">
                  {toTitleCase(item.market_type)} | {toTitleCase(item.side)} {typeof item.line === "number" ? item.line : ""}
                </p>

                <p className="ops-draft-card-rationale">{item.rationale || "No rationale provided."}</p>

                <div className="ops-draft-card-foot">
                  <div className="ops-draft-audit">
                    {item.draft_actor ? <span>{item.draft_actor}</span> : <span>Unassigned</span>}
                    {item.draft_action_at ? <span>{formatDraftTime(item.draft_action_at)}</span> : null}
                    {item.draft_reason ? <span>Reason: {item.draft_reason}</span> : null}
                  </div>

                  <div className="ops-draft-card-actions">
                    {isPending ? (
                      <>
                        <button
                          type="button"
                          className="ops-draft-btn ops-draft-btn-primary"
                          disabled={busyKey === `${pickId}:commit`}
                          onClick={() => void runMutation(item, "commit")}
                        >
                          {busyKey === `${pickId}:commit` ? "Committing" : "Commit to Ledger"}
                        </button>
                        <button
                          type="button"
                          className="ops-draft-btn ops-draft-btn-danger"
                          disabled={busyKey === `${pickId}:reject`}
                          onClick={() => void runMutation(item, "reject")}
                        >
                          {busyKey === `${pickId}:reject` ? "Rejecting" : "Reject"}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="ops-draft-btn ops-draft-btn-secondary"
                        onClick={() => setFilter("PENDING")}
                      >
                        View Pending Queue
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

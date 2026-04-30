import React, { useRef, useState, useMemo, useCallback, useEffect } from "react";
import { Send, Copy, Check, Plus, ChevronDown, ChevronRight, X, Paperclip, Mic, Search, MoreHorizontal, PanelLeft, Loader2, CheckCircle, AlertCircle, Zap, ShieldCheck, MapPin, ExternalLink, FileText, Phone, MessageSquare, Mail, Calculator } from "lucide-react";
import { ConsoleMode, SummaryData, PanelItem } from "@/lib/types/chat";
import {
  formatShortDate, readStringSafe, formatAssignmentWindow,
  formatTournamentStage, formatSubmissionDifficulty, readNumberSafe, formatRelativeTime,
  parseTimeToMinutes, formatShiftCadence, formatShiftWindow, formatMarginDelta, marginDeltaPoints,
  buildLicensingReferenceUrl, inferHealthcareContextFromLabel
} from "@/lib/chat-utils";
import { MODES } from "@/lib/chat-modes";
import { isLivePayloadStale, normalizeMLBStatusCode } from "@/lib/sports/status";

type IntakePackage = {
  facility_name: string | null;
  profession: string | null;
  specialty: string | null;
  title: string | null;
  city: string | null;
  state: string | null;
  start_date: string | null;
  end_date: string | null;
  shift_label: string | null;
  shift_start: string | null;
  shift_end: string | null;
  weekly_hours: number | null;
  schedule: string | null;
  weekly_gross: number | null;
  taxable_hourly_rate: number | null;
  weekly_stipends: number | null;
  meals_stipend: number | null;
  housing_stipend: number | null;
  job_description: string | null;
  requirements: string[];
  notes: string[];
};

type IntakeParseResult = {
  extracted_package: IntakePackage;
  missing_fields: string[];
  needs_review: boolean;
};

export // --- Left Panel ---
  function LeftPanel({
    mode,
    summary,
    error,
    loading,
    filter,
    selectedItemId,
    onFilterChange,
    onItemClick,
    onModeSwitch,
    onRetry,
    onRefreshData,
    marginSubTab,
    onMarginSubTabChange,
    getAuthToken,
    chatLoading,
    mobileOpen,
    onMobileClose,
  }: {
    mode: ConsoleMode;
    summary: SummaryData | null;
    error: string | null;
    loading: boolean;
    filter: string;
    selectedItemId: string | null;
    onFilterChange: (v: string) => void;
    onItemClick: (item: PanelItem) => void;
    onModeSwitch: (m: ConsoleMode) => void;
    onRetry: () => void;
    onRefreshData: () => void;
    marginSubTab: "jobs" | "margins";
    onMarginSubTabChange: (tab: "jobs" | "margins") => void;
    getAuthToken?: () => Promise<string | null>;
    chatLoading: boolean;
    mobileOpen: boolean;
    onMobileClose: () => void;
  }) {
  const pulse = summary?.pulse;
  const items = summary?.items || [];
  const supportedLeagues = summary?.supportedLeagues || [];
  const itemsScrollRef = useRef<HTMLDivElement>(null);
  const hasScrolledToday = useRef(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [dotsOpen, setDotsOpen] = useState(false);
  const dotsRef = useRef<HTMLDivElement>(null);
  const [statusFilter, setStatusFilter] = useState<string>("prestart");
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [professionFilter, setProfessionFilter] = useState<string | null>(null);
  const [attachJobId, setAttachJobId] = useState<string | null>(null);
  const [attachName, setAttachName] = useState("");
  const [attachLoading, setAttachLoading] = useState(false);
  const [copiedHcUrl, setCopiedHcUrl] = useState<string | null>(null);
  const packageFileRef = useRef<HTMLInputElement>(null);
  const [intakeText, setIntakeText] = useState("");
  const [intakeUrl, setIntakeUrl] = useState("");
  const [intakeImageDataUrl, setIntakeImageDataUrl] = useState<string | null>(null);
  const [intakeImageName, setIntakeImageName] = useState<string | null>(null);
  const [intakeParsed, setIntakeParsed] = useState<IntakeParseResult | null>(null);
  const [intakeLoading, setIntakeLoading] = useState(false);
  const [intakeSaving, setIntakeSaving] = useState(false);
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [intakeSaved, setIntakeSaved] = useState(false);
  const topProfessions = summary?.topProfessions || [];

  const updateIntakePackage = useCallback((patch: Partial<IntakePackage>) => {
    setIntakeParsed((current) => current
      ? {
        ...current,
        extracted_package: {
          ...current.extracted_package,
          ...patch,
        },
        needs_review: true,
      }
      : current);
  }, []);

  const handlePackageImageSelect = useCallback((file: File | null) => {
    setIntakeSaved(false);
    setIntakeError(null);
    if (!file) {
      setIntakeImageDataUrl(null);
      setIntakeImageName(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setIntakeError("Upload a screenshot image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setIntakeImageDataUrl(typeof reader.result === "string" ? reader.result : null);
      setIntakeImageName(file.name);
    };
    reader.onerror = () => setIntakeError("Could not read screenshot.");
    reader.readAsDataURL(file);
  }, []);

  const handleParsePackage = useCallback(async () => {
    if (!intakeText.trim() && !intakeImageDataUrl && !intakeUrl.trim()) {
      setIntakeError("Paste package text, add a URL, or upload a screenshot first.");
      return;
    }
    setIntakeLoading(true);
    setIntakeError(null);
    setIntakeSaved(false);
    try {
      const token = getAuthToken ? await getAuthToken() : null;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch("/api/ayaops/packages/parse", {
        method: "POST",
        headers,
        body: JSON.stringify({
          sourceType: intakeImageDataUrl ? "image_upload" : intakeUrl.trim() ? "manual" : "pasted_text",
          text: intakeText,
          sourceUrl: intakeUrl,
          imageDataUrl: intakeImageDataUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIntakeError(data.error || "Package parse failed.");
        return;
      }
      setIntakeParsed(data.result as IntakeParseResult);
    } catch {
      setIntakeError("Network error while parsing package.");
    } finally {
      setIntakeLoading(false);
    }
  }, [getAuthToken, intakeImageDataUrl, intakeText, intakeUrl]);

  const handleSavePackage = useCallback(async () => {
    if (!intakeParsed) return;
    setIntakeSaving(true);
    setIntakeError(null);
    try {
      const token = getAuthToken ? await getAuthToken() : null;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch("/api/ayaops/packages/save", {
        method: "POST",
        headers,
        body: JSON.stringify({
          sourceType: intakeImageDataUrl ? "image_upload" : intakeUrl.trim() ? "manual" : "pasted_text",
          sourceRawText: intakeText,
          sourceImageUrl: intakeUrl,
          parsedPackage: intakeParsed.extracted_package,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIntakeError(data.error || "Package save failed.");
        return;
      }
      setIntakeSaved(true);
      onRefreshData();
    } catch {
      setIntakeError("Network error while saving package.");
    } finally {
      setIntakeSaving(false);
    }
  }, [getAuthToken, intakeImageDataUrl, intakeParsed, intakeText, intakeUrl, onRefreshData]);

  const normalizedFilter = filter.trim().toLowerCase();
  const filtered = normalizedFilter
    ? items.filter((item) => {
      const searchable = [
        item.label,
        item.description,
        item.candidateName,
        item.profession,
        item.specialty,
        item.facilityName,
        item.facilityCity,
        item.facilityState,
        item.state,
        item.jobId,
        item.payPackageId,
        item.marginId,
        item.marginObjectId,
        item.objectType,
      ];
      return searchable.some((value) => String(value || "").toLowerCase().includes(normalizedFilter));
    })
    : items;

  // Auto-scroll to today's date in Sports + World Cup modes
  useEffect(() => {
    if ((mode !== "sports" && mode !== "worldcup") || loading || filtered.length === 0 || hasScrolledToday.current) return;
    const container = itemsScrollRef.current;
    if (!container) return;

    // Get today in YYYY-MM-DD (local time)
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Find today's day separator, or the nearest future day
    const allDaySeps = container.querySelectorAll<HTMLElement>('[data-date]');
    let target: HTMLElement | null = null;
    for (const el of allDaySeps) {
      const d = el.getAttribute('data-date') || '';
      if (d >= todayStr) { target = el; break; }
    }
    // Fallback: last available day if all are in the past
    if (!target && allDaySeps.length > 0) {
      target = allDaySeps[allDaySeps.length - 1];
    }

    if (target) {
      requestAnimationFrame(() => {
        target!.scrollIntoView({ block: 'start', behavior: 'instant' });
      });
      hasScrolledToday.current = true;
    }
  }, [mode, loading, filtered]);

  // Reset scroll anchor when mode changes
  useEffect(() => {
    hasScrolledToday.current = false;
  }, [mode]);

  useEffect(() => {
    if (!dotsOpen) return;
    const close = (event: MouseEvent) => {
      if (dotsRef.current && !dotsRef.current.contains(event.target as Node)) {
        setDotsOpen(false);
      }
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [dotsOpen]);

  const pulseLabels: Record<string, { keys: string[]; labels: string[] }> = {
    healthcare: { keys: ["states", "professions", "total"], labels: ["States", "Professions", "Licenses"] },
    sports: { keys: ["games", "slates", "previews"], labels: ["Games", "Slates", "Previews"] },
    code: { keys: ["tools", "capabilities"], labels: ["Tools", "Features"] },
    worldcup: { keys: ["matches", "groups", "previews"], labels: ["Matches", "Groups", "Previews"] },
    ayaops: { keys: ["candidates", "facilities", "active", "submittals"], labels: ["Travelers", "Facilities", "Active", "In Pipeline"] },
    facility: { keys: ["facilities", "active", "pipeline", "tracked"], labels: ["Facilities", "Active", "Pipeline", "Tracked"] },
    margins: marginSubTab === "jobs"
      ? { keys: ["total_pay_packages", "specialties", "facilities"], labels: ["Packages", "Specialties", "Facilities"] }
      : { keys: ["avg_margin_pct"], labels: ["Avg Margin"] },
    agent: { keys: ["tasks", "passed", "failed"], labels: ["Tasks", "Passed", "Failed"] },
    clicks: { keys: ["recent_clicks", "matched", "tracked"], labels: ["Last 24h", "Matched", "Listed"] },
  };

  const cfg = pulseLabels[mode] || pulseLabels.healthcare;
  const formatPulseValue = (key: string, value: number) => {
    if (mode === "margins" && key === "avg_margin_pct") return `${value.toFixed(2)}%`;
    return Number.isFinite(value) ? value.toLocaleString("en-US") : "0";
  };

  const formatStage = (stage?: string | null) => {
    const map: Record<string, string> = {
      r32: "Round of 32",
      qf: "Quarterfinal",
      sf: "Semifinal",
      final: "Final",
      r16: "Round of 16",
      third_place: "Third Place",
    };
    return map[stage || ""] || stage || "";
  };

  // --- Resize handle logic ---
  const shellRef = useRef<HTMLElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    handleRef.current?.classList.add("ws-resizing");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const shell = shellRef.current?.closest(".ws-shell") as HTMLElement | null;
      if (!shell) return;
      const width = Math.min(600, Math.max(280, ev.clientX));
      shell.style.setProperty("--left-width", `${width}px`);
    };

    const onUp = () => {
      dragging.current = false;
      handleRef.current?.classList.remove("ws-resizing");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  return (
    <aside className={`lp-shell ${mobileOpen ? "lp-shell-mobile-open" : ""}`} ref={shellRef} style={{ position: "relative" }}>
      {/* Drag resize handle */}
      <div
        ref={handleRef}
        className="ws-resize-handle"
        onMouseDown={onResizeStart}
      />
      {/* Mode selector + progressive disclosure search */}
      <div className="lp-mode-area">
        <div className="lp-title-row">
          <div className="lp-dots-wrap" ref={dotsRef}>
            <button
              type="button"
              className="lp-mode-selector-btn"
              onClick={(event) => {
                event.stopPropagation();
                setDotsOpen((open) => !open);
              }}
              aria-expanded={dotsOpen}
              aria-label="Switch workspace"
            >
              <span className="lp-active-label">{MODES[mode].label}</span>
              <ChevronDown size={14} className="lp-mode-chevron" />
            </button>
            {dotsOpen && (
              <div className="lp-dots-menu">
                {(Object.keys(MODES) as ConsoleMode[])
                  .filter((modeKey) => modeKey !== "clicks")
                  .map((modeKey) => (
                  <button
                    key={modeKey}
                    type="button"
                    className={`lp-dots-item ${mode === modeKey ? "active" : ""}`}
                    onClick={() => {
                      onModeSwitch(modeKey);
                      setDotsOpen(false);
                    }}
                    disabled={chatLoading}
                  >
                    {mode === modeKey && <span className="lp-dots-dot" />}
                    {MODES[modeKey].label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className="lp-mobile-close"
            onClick={onMobileClose}
            aria-label="Close workspace panel"
          >
            <X size={14} />
          </button>
          <button
            type="button"
            className={`lp-search-toggle ${searchOpen ? "active" : ""}`}
            onClick={() => { setSearchOpen(!searchOpen); if (!searchOpen) setTimeout(() => searchRef.current?.focus(), 60); }}
            aria-label="Toggle search"
          >
            {searchOpen ? <X size={14} /> : <Search size={14} />}
          </button>
        </div>

        {searchOpen && (
          <div className="lp-search-inline">
            <Search size={13} className="lp-search-inline-icon" />
            <input
              ref={searchRef}
              className="lp-search-inline-input"
              placeholder={`Search ${MODES[mode].label.toLowerCase()}...`}
              value={filter}
              onChange={(e) => onFilterChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setSearchOpen(false); onFilterChange(""); } }}
            />
          </div>
        )}
      </div>

      {mode === "ayaops" && (
        <div className="aya-ops-links-rail" aria-label="AyaOps Quick Links">
          <div className="aya-ops-link-group">
            <span className="aya-ops-group-label" style={{ marginBottom: "8px", display: "inline-block" }}>Recruiting</span>
            <div className="aya-ops-group-items">
              <button
                type="button"
                className={`aya-ops-link-chip ${statusFilter === "prospect" ? "active" : ""}`}
                onClick={() => setStatusFilter("prospect")}
              >
                Prospects
              </button>
              <button
                type="button"
                className={`aya-ops-link-chip ${statusFilter === "prestart" ? "active" : ""}`}
                onClick={() => setStatusFilter("prestart")}
              >
                Prestart
              </button>
              <button
                type="button"
                className={`aya-ops-link-chip ${statusFilter === "working" ? "active" : ""}`}
                onClick={() => setStatusFilter("working")}
              >
                Working
              </button>
              <button
                type="button"
                className="aya-ops-link-chip"
                onClick={() => onModeSwitch("margins")}
              >
                Packages
              </button>
            </div>
          </div>
        </div>
      )}

      {mode === "agent" && (
        <div className="agent-task-queue">
          <div className="agent-queue-header">
            <span className="agent-queue-title">Tasks</span>
            <span className="agent-queue-count">{items.length}</span>
          </div>
          {items.length === 0 ? (
            <div className="agent-empty-state">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#71717a', marginBottom: 8 }}>
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              <span>No tasks yet</span>
              <span className="agent-empty-hint">Describe a browser check in the chat to create one</span>
            </div>
          ) : (
            <div className="agent-task-list">
              {items.map((task: PanelItem) => {
                const isSelected = selectedItemId === task.id;
                return (
                  <button
                    key={task.id}
                    type="button"
                    className={`agent-task-card ${isSelected ? "selected" : ""}`}
                    onClick={() => onItemClick(task)}
                  >
                    <span className={`agent-task-dot agent-dot-${task.status || "draft"}`} />
                    <div className="agent-task-info">
                      <span className="agent-task-title">{task.label}</span>
                      <span className="agent-task-meta">{task.description || "No target"}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {cfg.keys.length > 0 && mode !== "ayaops" && mode !== "facility" && mode !== "margins" && mode !== "agent" && (
        <div
          className="lp-pulse-strip"
          aria-label={`${MODES[mode].label} pulse`}
          style={{ gridTemplateColumns: `repeat(${Math.max(cfg.keys.length, 1)}, minmax(0, 1fr))` }}
        >
          {cfg.keys.map((key, idx) => (
            <div key={key} className="lp-pulse-cell">
              <span className="lp-pulse-num">{formatPulseValue(key, Number(pulse?.[key] ?? 0))}</span>
              <span className="lp-pulse-k">{cfg.labels[idx] || key}</span>
            </div>
          ))}
        </div>
      )}

      {mode === "healthcare" && topProfessions.length > 0 && (
        <div className="lp-hc-filter-rail" aria-label="Filter by profession">
          <button
            type="button"
            className={`lp-hc-filter-chip ${professionFilter === null ? "active" : ""}`}
            onClick={() => setProfessionFilter(null)}
          >
            All
          </button>
          {topProfessions.map((prof) => (
            <button
              key={prof.name}
              type="button"
              className={`lp-hc-filter-chip ${professionFilter === prof.name ? "active" : ""}`}
              onClick={() => setProfessionFilter(professionFilter === prof.name ? null : prof.name)}
            >
              {prof.name}
              <span className="lp-hc-filter-count">{prof.count}</span>
            </button>
          ))}
        </div>
      )}

      {mode === "sports" && items.length > 0 && (() => {
        // Build today's league list from actual items
        const nowLocal = new Date();
        const todayStr = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, '0')}-${String(nowLocal.getDate()).padStart(2, '0')}`;
        const leagueLogoMap: Record<string, string> = {
          "MLB": "https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/mlb.png&w=40&h=40",
          "NBA": "https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/nba.png&w=40&h=40",
          "WNBA": "https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/wnba.png&w=40&h=40",
          "NHL": "https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/nhl.png&w=40&h=40",
          "NFL": "https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/nfl.png&w=40&h=40",
          "EPL": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/23.png&w=40&h=40",
          "La Liga": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/15.png&w=40&h=40",
          "Bundesliga": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/10.png&w=40&h=40",
          "Serie A": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/12.png&w=40&h=40",
          "Ligue 1": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/9.png&w=40&h=40",
          "MLS": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/19.png&w=40&h=40",
          "Champions League": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/2.png&w=40&h=40",
          "Europa League": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/2310.png&w=40&h=40",
          "Liga MX": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/26.png&w=40&h=40",
          "Brasileirao": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/85.png&w=40&h=40",
          "Primeira Liga": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/14.png&w=40&h=40",
          "Eredivisie": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/11.png&w=40&h=40",
          "Scottish Premiership": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/24.png&w=40&h=40",
          "Super Lig": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/18.png&w=40&h=40",
          "Belgian Pro League": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/144.png&w=40&h=40",
          "Argentina Primera": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/1.png&w=40&h=40",
        };
        const leaguesWithGamesToday = new Set<string>();
        const counts = new Map<string, number>();
        const firstDateByLeague = new Map<string, string>();
        for (const item of items) {
          const d = item.startTime ? item.startTime.slice(0, 10) : item.date || "";
          const league = item.league || "Other";

          counts.set(league, (counts.get(league) || 0) + 1);

          if (d && !firstDateByLeague.has(league)) {
            firstDateByLeague.set(league, d);
          }
          if (d === todayStr) {
            leaguesWithGamesToday.add(league);
          }
        }

        const sortedLeagues = Array.from(counts.entries())
          .map(([name, count]) => {
            const hasGamesToday = leaguesWithGamesToday.has(name);
            return {
              name,
              count,
              logo: leagueLogoMap[name] || null,
              hasGamesToday,
              targetDate: hasGamesToday ? todayStr : firstDateByLeague.get(name) || "",
            };
          })
          .sort((a, b) => {
            if (a.hasGamesToday !== b.hasGamesToday) {
              return a.hasGamesToday ? -1 : 1;
            }
            if (a.count !== b.count) {
              return b.count - a.count;
            }
            return a.name.localeCompare(b.name);
          });

        if (process.env.NODE_ENV !== "production" && sortedLeagues.length < counts.size) {
          throw new Error("League loss during UI formatting");
        }
        if (sortedLeagues.length === 0) return null;
        return (
          <div className="lp-league-nav" aria-label="Quick league navigation">
            {sortedLeagues.map((lg) => (
              <button
                key={lg.name}
                type="button"
                className="lp-league-chip"
                onClick={() => {
                  const el = itemsScrollRef.current?.querySelector(
                    `[data-league-id="${lg.targetDate}-${lg.name}"]`,
                  );
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                {lg.logo && <img src={lg.logo} alt="" className="lp-league-chip-logo" />}
                <span className="lp-league-chip-label">{lg.name}</span>
                <span className="lp-league-chip-count">{lg.count}</span>
              </button>
            ))}
          </div>
        );
      })()}



      {/* Item list */}
      <div className="lp-items" ref={itemsScrollRef}>
        {error ? (
          <div className="lp-items-empty">
            <div>{error}</div>
            <button
              type="button"
              className="c-new-btn"
              style={{ marginTop: 10 }}
              onClick={onRetry}
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <>
            {mode === "margins" && (
              <div className="margin-sub-tabs">
                <button
                  className={`margin-sub-tab ${marginSubTab === "jobs" ? "active" : ""}`}
                  onClick={() => onMarginSubTabChange("jobs")}
                >
                  Pay Packages
                </button>
                <button
                  className={`margin-sub-tab ${marginSubTab === "margins" ? "active" : ""}`}
                  onClick={() => onMarginSubTabChange("margins")}
                >
                  Margins
                </button>
              </div>
            )}
            <div className="lp-items-loading">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="lp-item-skeleton" />
              ))}
            </div>
          </>
        ) : filtered.length === 0 ? (
          <>
            {mode === "margins" && (
              <div className="margin-sub-tabs">
                <button
                  className={`margin-sub-tab ${marginSubTab === "jobs" ? "active" : ""}`}
                  onClick={() => onMarginSubTabChange("jobs")}
                >
                  Pay Packages
                </button>
                <button
                  className={`margin-sub-tab ${marginSubTab === "margins" ? "active" : ""}`}
                  onClick={() => onMarginSubTabChange("margins")}
                >
                  Margins
                </button>
              </div>
            )}
              <div className="lp-items-empty">
              {filter
                ? "No matches"
                : mode === "margins"
                  ? marginSubTab === "jobs"
                    ? "No pay packages yet. Upload facility job package data to populate this board."
                    : "No margins yet. Create an offer from a pay package to generate one."
                  : mode === "facility"
                    ? "No facility records available."
                    : "No data yet"}
            </div>
          </>
        ) : (
          (() => {
            // Sports mode: group by date with day separators
            if (mode === "sports") {
              const normalizeStatusText = (value: unknown): string => {
                if (typeof value !== "string") return "";
                return value.trim().toLowerCase();
              };

              const statusIncludesAny = (text: string, values: string[]): boolean =>
                values.some((value) => text.includes(value));

              const isLiveGame = (item: PanelItem): boolean => {
                const livePayload =
                  item.live && typeof item.live === "object" && !Array.isArray(item.live)
                    ? (item.live as Record<string, unknown>)
                    : null;
                const normalizedStatus = normalizeMLBStatusCode(item.status);

                if (normalizedStatus === "FINAL" || normalizedStatus === "POSTPONED") {
                  return false;
                }

                if (normalizedStatus === "LIVE") {
                  return livePayload ? !isLivePayloadStale(livePayload) : true;
                }

                const statusCandidates = [
                  item.status,
                  livePayload?.status,
                  livePayload?.state,
                  livePayload?.game_status,
                  livePayload?.gameState,
                  livePayload?.gameStatus,
                ]
                  .map(normalizeStatusText)
                  .filter(Boolean);

                const liveKeywords = [
                  "live",
                  "in progress",
                  "in_progress",
                  "in-play",
                  "inplay",
                  "inning",
                  "quarter",
                  "period",
                  "halftime",
                  "overtime",
                  "ot",
                  "top",
                  "bottom",
                ];
                if (statusCandidates.some((value) => statusIncludesAny(value, liveKeywords))) return true;
                if (!livePayload || isLivePayloadStale(livePayload)) return false;

                const structuralLiveFields = [
                  "inning",
                  "outs",
                  "balls",
                  "strikes",
                  "on_first",
                  "on_second",
                  "on_third",
                  "onFirst",
                  "onSecond",
                  "onThird",
                  "quarter",
                  "period",
                  "clock",
                  "time_remaining",
                  "timeRemaining",
                  "progress",
                ];

                if (structuralLiveFields.some((key) => livePayload[key] != null)) return true;
                return false;
              };

              const getLiveBadge = (item: PanelItem): string => {
                const livePayload =
                  item.live && typeof item.live === "object" && !Array.isArray(item.live)
                    ? (item.live as Record<string, unknown>)
                    : null;
                if (!livePayload) return "Live";

                const statusLike = [
                  livePayload.progress,
                  livePayload.state,
                  livePayload.status,
                  livePayload.game_status,
                  livePayload.gameState,
                  livePayload.gameStatus,
                  livePayload.clock,
                  livePayload.time_remaining,
                  livePayload.timeRemaining,
                ].find((value) => typeof value === "string" && value.trim().length > 0) as string | undefined;

                if (statusLike) {
                  return statusLike.trim().slice(0, 22);
                }

                if (livePayload.inning != null) return `Inning ${String(livePayload.inning)}`;
                if (livePayload.quarter != null) return `Q${String(livePayload.quarter)}`;
                if (livePayload.period != null) return `P${String(livePayload.period)}`;
                return "Live";
              };

              const liveStateById = new Map<string, { isLive: boolean; badge: string }>();
              for (const item of filtered) {
                const live = isLiveGame(item);
                liveStateById.set(item.id, { isLive: live, badge: live ? getLiveBadge(item) : "Live" });
              }

              const liveGames = filtered.filter((item) => liveStateById.get(item.id)?.isLive === true);
              const scheduledGames = filtered.filter((item) => liveStateById.get(item.id)?.isLive !== true);

              if (process.env.NODE_ENV !== "production" && liveGames.some((game) => liveStateById.get(game.id)?.isLive !== true)) {
                throw new Error("Invariant failed: non-live game sorted into live bucket");
              }

              // Group by date first
              const grouped: { date: string; label: string; items: PanelItem[] }[] = [];
              let lastDate = "";
              for (const item of scheduledGames) {
                const d = item.startTime ? item.startTime.slice(0, 10) : item.date || "";
                if (d !== lastDate) {
                  const dateObj = new Date(d + "T12:00:00Z");
                  grouped.push({
                    date: d,
                    label: dateObj.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
                    items: [],
                  });
                  lastDate = d;
                }
                if (grouped.length > 0) grouped[grouped.length - 1].items.push(item);
              }

              const nowLocal = new Date();
              const todayISO = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, '0')}-${String(nowLocal.getDate()).padStart(2, '0')}`;

              // League logo map (shared with nav rail above)
              const leagueLogoMap: Record<string, string> = {
                "MLB": "https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/mlb.png&w=40&h=40",
                "NBA": "https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/nba.png&w=40&h=40",
                "WNBA": "https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/wnba.png&w=40&h=40",
                "NHL": "https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/nhl.png&w=40&h=40",
                "NFL": "https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/nfl.png&w=40&h=40",
                "EPL": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/23.png&w=40&h=40",
                "La Liga": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/15.png&w=40&h=40",
                "Bundesliga": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/10.png&w=40&h=40",
                "Serie A": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/12.png&w=40&h=40",
                "Ligue 1": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/9.png&w=40&h=40",
                "MLS": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/19.png&w=40&h=40",
                "Champions League": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/2.png&w=40&h=40",
                "Europa League": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/2310.png&w=40&h=40",
                "Liga MX": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/26.png&w=40&h=40",
                "Brasileirao": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/85.png&w=40&h=40",
                "Primeira Liga": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/14.png&w=40&h=40",
                "Eredivisie": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/11.png&w=40&h=40",
                "Scottish Premiership": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/24.png&w=40&h=40",
                "Super Lig": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/18.png&w=40&h=40",
                "Belgian Pro League": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/144.png&w=40&h=40",
                "Argentina Primera": "https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/1.png&w=40&h=40",
              };

              const renderGameRow = (item: PanelItem) => {
                const hasWriteup = Boolean(item.writeupUrl);
                const liveState = liveStateById.get(item.id);
                const liveBadge = liveState?.isLive ? liveState.badge : null;
                const statusText = normalizeStatusText(item.status);
                const isScheduledStatus = statusIncludesAny(statusText, ["pre", "scheduled", "pregame", "pre-game"]);
                const hasAwayScore = Number.isFinite(item.awayScore as number);
                const hasHomeScore = Number.isFinite(item.homeScore as number);
                const hasScores = hasAwayScore && hasHomeScore;
                const showScores = hasScores && (!isScheduledStatus || Boolean(liveBadge));
                const awayWins = showScores && (item.awayScore as number) > (item.homeScore as number);
                const homeWins = showScores && (item.homeScore as number) > (item.awayScore as number);
                return (
                  <div
                    key={item.id}
                    className={`lp-item lp-item-game ${hasWriteup ? "sp-match-linked" : ""}`}
                    onClick={() => {
                      if (hasWriteup) {
                        window.open(item.writeupUrl!, "_blank");
                      } else {
                        onItemClick(item);
                      }
                    }}
                  >
                    <div className="sp-card">
                      <div className="sp-matchup">
                        <div className="sp-team-row">
                          {item.awayLogo && <img src={item.awayLogo} alt="" className="sp-team-icon" />}
                          <span className={`sp-team-name ${awayWins ? "sp-team-name-win" : ""}`}>{item.away || "TBD"}</span>
                          {item.awayRecord && <span className="sp-team-rec">{item.awayRecord}</span>}
                          {showScores ? (
                            <span className={`sp-score ${awayWins ? "sp-score-win" : ""}`}>{item.awayScore}</span>
                          ) : item.spread != null ? (
                            <span className="sp-line">{item.spread > 0 ? "+" : ""}{item.spread}</span>
                          ) : null}
                        </div>
                        <div className="sp-team-row">
                          {item.homeLogo && <img src={item.homeLogo} alt="" className="sp-team-icon" />}
                          <span className={`sp-team-name ${homeWins ? "sp-team-name-win" : ""}`}>{item.home || "TBD"}</span>
                          {item.homeRecord && <span className="sp-team-rec">{item.homeRecord}</span>}
                          {showScores ? (
                            <span className={`sp-score ${homeWins ? "sp-score-win" : ""}`}>{item.homeScore}</span>
                          ) : item.total != null ? (
                            <span className="sp-line sp-line-ou">o/u {item.total}</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="sp-card-foot">
                        <span className="sp-foot-time">
                          {item.startTime
                            ? new Date(item.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                            : "TBD"}
                        </span>
                        {item.venue && (
                          <>
                            <span className="sp-foot-sep">·</span>
                            <span className="sp-foot-venue">{item.venue}</span>
                          </>
                        )}
                        {liveBadge && <span className="mlb-live-indicator">{liveBadge}</span>}
                        <span
                          className={`sp-status-dot ${hasWriteup ? "sp-dot-ready" : "sp-dot-pending"}`}
                          title={hasWriteup ? "Writeup published" : "No writeup yet"}
                        />
                      </div>
                    </div>
                  </div>
                );
              };

              return (
                <>
                  {liveGames.length > 0 && (
                    <div className="lp-live-games-bucket">
                      <div className="lp-day-separator lp-day-live">
                        <span className="lp-day-label">Live Now</span>
                        <span className="lp-day-count">{liveGames.length}</span>
                      </div>
                      {liveGames.map(renderGameRow)}
                    </div>
                  )}
                  {grouped.map((group) => {
                    const isToday = group.date === todayISO;
                    const isPast = group.date < todayISO;

                    const leagueOrder: string[] = [];
                    const leagueMap = new Map<string, PanelItem[]>();
                    for (const item of group.items) {
                      const league = item.league || "Other";
                      if (!leagueMap.has(league)) {
                        leagueOrder.push(league);
                        leagueMap.set(league, []);
                      }
                      leagueMap.get(league)!.push(item);
                    }

                    return (
                      <div key={group.date} data-date={group.date}>
                        <div className={`lp-day-separator ${isToday ? "lp-day-today" : ""} ${isPast ? "lp-day-past" : ""}`}>
                          <span className="lp-day-label">{isToday ? "Today" : group.label}</span>
                          <span className="lp-day-count">{group.items.length}</span>
                        </div>
                        {leagueOrder.map((league) => {
                          const leagueItems = leagueMap.get(league)!;
                          const leagueLogo = leagueLogoMap[league] || null;
                          return (
                            <div key={`${group.date}-${league}`} data-league-id={`${group.date}-${league}`}>
                              <div className="lp-league-header">
                                {leagueLogo && (
                                  <img src={leagueLogo} alt="" className="lp-league-logo" />
                                )}
                                <span className="lp-league-name">{league}</span>
                                <span className="lp-league-count">{leagueItems.length}</span>
                              </div>
                              {leagueItems.map(renderGameRow)}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </>
              );
            }

            if (mode === "worldcup") {
              const grouped: { date: string; label: string; items: PanelItem[] }[] = [];
              let lastDate = "";

              for (const item of filtered) {
                const dateKey = item.kickoff ? item.kickoff.slice(0, 10) : "";
                if (dateKey !== lastDate) {
                  const dateObj = dateKey ? new Date(`${dateKey}T12:00:00Z`) : null;
                  grouped.push({
                    date: dateKey,
                    label: dateObj
                      ? dateObj.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
                      : "TBD",
                    items: [],
                  });
                  lastDate = dateKey;
                }
                if (grouped.length > 0) grouped[grouped.length - 1].items.push(item);
              }

              const nowLocal = new Date();
              const todayISO = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, "0")}-${String(nowLocal.getDate()).padStart(2, "0")}`;

              return grouped.map((group) => {
                const isToday = group.date === todayISO;
                return (
                  <div key={group.date || "tbd"} data-date={group.date}>
                    <div className={`lp-day-separator ${isToday ? "lp-day-today" : ""}`}>
                      <span className="lp-day-label">{isToday ? "Today" : group.label}</span>
                      <span className="lp-day-count">{group.items.length}</span>
                    </div>
                    {group.items.map((item) => {
                      const hasWriteup = Boolean(item.writeupUrl);
                      return (
                        <div
                          key={item.id}
                          className={`lp-item lp-item-game ${hasWriteup ? "wc-match-linked" : ""}`}
                          onClick={() => {
                            if (hasWriteup) {
                              window.open(item.writeupUrl!, "_blank");
                            } else {
                              onItemClick(item);
                            }
                          }}
                        >
                          <div className="lp-game-row">
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                              {item.homeFlag && <img src={item.homeFlag} alt="" className="lp-team-logo" />}
                              <div style={{ minWidth: 0 }}>
                                <p
                                  className="lp-item-label"
                                  style={{ margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                                >
                                  {item.homeName || "TBD"} vs {item.awayName || "TBD"}
                                </p>
                                <p className="lp-pitcher-names" style={{ margin: "2px 0 0" }}>
                                  {item.groupLetter
                                    ? `Group ${item.groupLetter} · ${item.venue || "Venue TBD"}`
                                    : `${formatStage(item.stage)} · ${item.venue || "Venue TBD"}`}
                                </p>
                              </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                              <span className="lp-game-time">
                                {item.kickoff
                                  ? new Date(item.kickoff).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                                  : "TBD"}
                              </span>
                              <span
                                className={`wc-status-dot ${hasWriteup ? "wc-dot-ready" : "wc-dot-pending"}`}
                                title={hasWriteup ? "Writeup published" : "No writeup yet"}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              });
            }

            if (mode === "facility") {
              const byState: Array<{ state: string; items: PanelItem[] }> = [];
              const stateMap = new Map<string, PanelItem[]>();
              for (const item of filtered) {
                const stateKey = String(item.facilityState || item.state || "UNSPECIFIED").toUpperCase();
                if (!stateMap.has(stateKey)) {
                  stateMap.set(stateKey, []);
                  byState.push({ state: stateKey, items: stateMap.get(stateKey)! });
                }
                stateMap.get(stateKey)!.push(item);
              }
              byState.sort((a, b) => a.state.localeCompare(b.state));

              return byState.map((group) => (
                <div key={group.state}>
                  <div className="lp-day-sep fac-state-header">
                    <span className="lp-day-label">{group.state}</span>
                    <span className="lp-day-count">{group.items.length}</span>
                  </div>
                  <div>
                    {group.items.map((item) => {
                      const active = Number(item.activeAssignments || 0);
                      const pending = Number(item.pendingStartAssignments || 0);
                      const pipeline = Number(item.pipelineAssignments || 0);
                      const hasStats = active > 0 || pending > 0 || pipeline > 0;
                      const isEasy = item.submissionDifficulty === "easy";
                      const rules = item.submittalRules || "";
                      const hasCompact = /compact/i.test(rules);
                      const hasLocals = /local/i.test(rules);
                      return (
                        <button
                          type="button"
                          key={item.id}
                          className={`lp-item lp-item-facility ${selectedItemId === item.id ? "lp-item-active" : ""}`}
                          onClick={() => onItemClick(item)}
                          aria-label={`Open facility ${item.facilityName || item.label}`}
                        >
                          <div className="fac-card-row">
                            <div className="fac-card-info">
                              <span className="fac-card-name">{item.facilityName || item.label}</span>
                              <span className="fac-card-loc">
                                {(item.facilityCity || "--")}{item.facilityState ? `, ${item.facilityState}` : ""}
                                {item.vmsPlatform ? ` · ${item.vmsPlatform}` : ""}
                              </span>
                              {(item.facilityProfileUrl || item.facilityNovaUrl || item.novaUrl) && (
                                <a
                                  className="aya-nova-btn"
                                  href={item.facilityProfileUrl || item.facilityNovaUrl || item.novaUrl || "#"}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  title={item.facilityProfileUrl || item.facilityNovaUrl || item.novaUrl || ""}
                                >
                                  Nova
                                </a>
                              )}
                            </div>
                            <div className="fac-card-icons">
                              {isEasy && <span className="fac-icon" title="Easy submittal" style={{ display: 'inline-flex', alignItems: 'center' }}><Zap size={12} strokeWidth={2.5} style={{ color: '#d97706' }} /></span>}
                              {hasCompact && <span className="fac-icon" title="Compact optional" style={{ display: 'inline-flex', alignItems: 'center' }}><ShieldCheck size={12} strokeWidth={2.5} style={{ color: '#2563eb' }} /></span>}
                              {hasLocals && <span className="fac-icon" title="Locals accepted" style={{ display: 'inline-flex', alignItems: 'center' }}><MapPin size={12} strokeWidth={2.5} style={{ color: '#16a34a' }} /></span>}
                            </div>
                            {hasStats && (
                              <div className="fac-card-stats">
                                {active > 0 && <span className="fac-stat fac-stat-active">{active} Active</span>}
                                {pending > 0 && <span className="fac-stat fac-stat-pending">{pending} Pending</span>}
                                {pipeline > 0 && <span className="fac-stat fac-stat-pipeline">{pipeline} Pipeline</span>}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ));
            }

            if (mode === "margins") {
              const formatCurrency = (value: number | null | undefined) =>
                typeof value === "number" && Number.isFinite(value)
                  ? new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: "USD",
                    maximumFractionDigits: 0,
                  }).format(value)
                  : "--";
              const formatPercent = (value: number | null | undefined) =>
                typeof value === "number" && Number.isFinite(value)
                  ? `${(value * 100).toFixed(2)}%`
                  : "--";

              const handleSubTabChange = (tab: "jobs" | "margins") => {
                onMarginSubTabChange(tab);
              };

              const handleCreateOffer = async (payPackageId: string) => {
                if (!attachName.trim()) return;
                setAttachLoading(true);
                try {
                  const token = getAuthToken ? await getAuthToken() : null;
                  const headers: Record<string, string> = { "Content-Type": "application/json" };
                  if (token) headers.Authorization = `Bearer ${token}`;
                  const res = await fetch("/api/ayaops/offers/create", {
                    method: "POST",
                    headers,
                    body: JSON.stringify({
                      margin_object_id: payPackageId,
                      pay_package_id: payPackageId,
                      candidate_name: attachName.trim(),
                    }),
                  });
                  if (!res.ok) {
                    const err = await res.json();
                    alert(err.error || "Failed to create offer");
                    return;
                  }
                  setAttachJobId(null);
                  setAttachName("");
                  handleSubTabChange("margins");
                } catch {
                  alert("Network error");
                } finally {
                  setAttachLoading(false);
                }
              };

              return (
                <>
                  {/* Pay package / approval tab toggle */}
                  <div className="margin-sub-tabs">
                    <button
                      className={`margin-sub-tab ${marginSubTab === "jobs" ? "active" : ""}`}
                      onClick={() => handleSubTabChange("jobs")}
                    >
                      Pay Packages
                    </button>
                    <button
                      className={`margin-sub-tab ${marginSubTab === "margins" ? "active" : ""}`}
                      onClick={() => handleSubTabChange("margins")}
                    >
                      Margins
                    </button>
                  </div>

                  {marginSubTab === "jobs" && (
                    <div className="lp-package-intake">
                      <div className="lp-intake-head">
                        <div>
                          <p className="lp-intake-kicker">Add Pay Package</p>
                          <strong>Parse, review, then save</strong>
                        </div>
                        {intakeSaved && <span className="lp-intake-saved">Saved</span>}
                      </div>
                      <div className="lp-intake-actions">
                        <input
                          ref={packageFileRef}
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={(e) => handlePackageImageSelect(e.target.files?.[0] || null)}
                        />
                        <button
                          type="button"
                          className="lp-intake-secondary"
                          onClick={() => packageFileRef.current?.click()}
                        >
                          <Paperclip size={13} />
                          Upload Screenshot
                        </button>
                        <button
                          type="button"
                          className="lp-intake-primary"
                          disabled={intakeLoading || (!intakeText.trim() && !intakeImageDataUrl && !intakeUrl.trim())}
                          onClick={handleParsePackage}
                        >
                          {intakeLoading ? <Loader2 size={13} className="spin" /> : <FileText size={13} />}
                          Parse Package
                        </button>
                      </div>
                      {intakeImageName && (
                        <div className="lp-intake-file">
                          <span>{intakeImageName}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setIntakeImageDataUrl(null);
                              setIntakeImageName(null);
                              if (packageFileRef.current) packageFileRef.current.value = "";
                            }}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      )}
                      <input
                        className="lp-intake-url"
                        value={intakeUrl}
                        onChange={(e) => {
                          setIntakeUrl(e.target.value);
                          setIntakeSaved(false);
                        }}
                        placeholder="Paste Nova profile or package source URL..."
                      />
                      <textarea
                        className="lp-intake-textarea"
                        rows={4}
                        value={intakeText}
                        onChange={(e) => {
                          setIntakeText(e.target.value);
                          setIntakeSaved(false);
                        }}
                        placeholder="Paste package, margin screenshot text, or job details here..."
                      />
                      {intakeError && <p className="lp-intake-error">{intakeError}</p>}
                      {intakeParsed && (
                        <div className="lp-intake-preview">
                          <div className="lp-intake-preview-head">
                            <div>
                              <p className="lp-intake-kicker">Parsed Package Preview</p>
                              <strong>{intakeParsed.extracted_package.specialty || intakeParsed.extracted_package.title || "Pay Package"}</strong>
                            </div>
                            <button
                              type="button"
                              className="lp-intake-primary"
                              disabled={intakeSaving}
                              onClick={handleSavePackage}
                            >
                              {intakeSaving ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                              Save Package
                            </button>
                          </div>
                          <div className="lp-intake-fields">
                            <label>
                              <span>Facility</span>
                              <input
                                value={intakeParsed.extracted_package.facility_name || ""}
                                onChange={(e) => updateIntakePackage({ facility_name: e.target.value || null })}
                              />
                            </label>
                            <label>
                              <span>Specialty</span>
                              <input
                                value={intakeParsed.extracted_package.specialty || ""}
                                onChange={(e) => updateIntakePackage({ specialty: e.target.value || null })}
                              />
                            </label>
                            <label>
                              <span>Start</span>
                              <input
                                type="date"
                                value={intakeParsed.extracted_package.start_date || ""}
                                onChange={(e) => updateIntakePackage({ start_date: e.target.value || null })}
                              />
                            </label>
                            <label>
                              <span>End</span>
                              <input
                                type="date"
                                value={intakeParsed.extracted_package.end_date || ""}
                                onChange={(e) => updateIntakePackage({ end_date: e.target.value || null })}
                              />
                            </label>
                            <label>
                              <span>Gross</span>
                              <input
                                inputMode="decimal"
                                value={intakeParsed.extracted_package.weekly_gross ?? ""}
                                onChange={(e) => updateIntakePackage({ weekly_gross: e.target.value ? Number(e.target.value) : null })}
                              />
                            </label>
                            <label>
                              <span>Base</span>
                              <input
                                inputMode="decimal"
                                value={intakeParsed.extracted_package.taxable_hourly_rate ?? ""}
                                onChange={(e) => updateIntakePackage({ taxable_hourly_rate: e.target.value ? Number(e.target.value) : null })}
                              />
                            </label>
                            <label>
                              <span>Stipends</span>
                              <input
                                inputMode="decimal"
                                value={intakeParsed.extracted_package.weekly_stipends ?? ""}
                                onChange={(e) => updateIntakePackage({ weekly_stipends: e.target.value ? Number(e.target.value) : null })}
                              />
                            </label>
                            <label>
                              <span>Schedule</span>
                              <input
                                value={intakeParsed.extracted_package.schedule || ""}
                                onChange={(e) => updateIntakePackage({ schedule: e.target.value || null })}
                              />
                            </label>
                            <label>
                              <span>Shift</span>
                              <input
                                value={intakeParsed.extracted_package.shift_label || ""}
                                onChange={(e) => updateIntakePackage({ shift_label: e.target.value || null })}
                              />
                            </label>
                            <label>
                              <span>Start Time</span>
                              <input
                                value={intakeParsed.extracted_package.shift_start || ""}
                                onChange={(e) => updateIntakePackage({ shift_start: e.target.value || null })}
                              />
                            </label>
                            <label>
                              <span>End Time</span>
                              <input
                                value={intakeParsed.extracted_package.shift_end || ""}
                                onChange={(e) => updateIntakePackage({ shift_end: e.target.value || null })}
                              />
                            </label>
                            <label>
                              <span>Hours</span>
                              <input
                                inputMode="decimal"
                                value={intakeParsed.extracted_package.weekly_hours ?? ""}
                                onChange={(e) => updateIntakePackage({ weekly_hours: e.target.value ? Number(e.target.value) : null })}
                              />
                            </label>
                          </div>
                          {intakeParsed.missing_fields.length > 0 && (
                            <p className="lp-intake-missing">
                              Review missing: {intakeParsed.missing_fields.slice(0, 5).join(", ")}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Pay package cards */}
                  {marginSubTab === "jobs" && filtered.map((item) => (
                    <div
                      key={item.id}
                      className={`lp-item lp-item-job ${selectedItemId === item.id ? "lp-item-active" : ""}`}
                    >
                      <button
                        type="button"
                        className="lp-job-body"
                        onClick={() => onItemClick(item)}
                      >
                        <div className="lp-flex-col">
                          <p className="lp-item-label">
                            {item.specialty || item.profession || "Role"}
                            {item.shiftType ? ` · ${item.shiftType.charAt(0).toUpperCase() + item.shiftType.slice(1)}` : ""}
                          </p>
                          <p className="lp-item-meta lp-margin-meta">
                            {item.facilityName || "--"}
                          </p>
                          {(item.assignmentStart || item.assignmentEnd) && (
                            <p className="lp-item-meta lp-margin-dates">
                              {formatShortDate(item.assignmentStart)} {item.assignmentEnd ? `→ ${formatShortDate(item.assignmentEnd)}` : ""}
                            </p>
                          )}
                        </div>
                        <div className="lp-margin-values">
                          {item.weeklyGross != null && (
                            <span className="lp-margin-gross">{formatCurrency(item.weeklyGross)}</span>
                          )}
                          {item.weeklyHours != null && (
                            <span className="lp-margin-pct">{item.weeklyHours}h/wk</span>
                          )}
                        </div>
                      </button>
                      {/* Attach action */}
                      {attachJobId === item.id ? (
                        <div className="lp-attach-form">
                          <input
                            type="text"
                            className="lp-attach-input"
                            placeholder="Candidate name for offer..."
                            value={attachName}
                            onChange={(e) => setAttachName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleCreateOffer(item.payPackageId || item.marginObjectId || item.id); }}
                            autoFocus
                          />
                          <button
                            className="lp-attach-btn"
                            disabled={attachLoading || !attachName.trim()}
                            onClick={() => handleCreateOffer(item.payPackageId || item.marginObjectId || item.id)}
                          >
                            {attachLoading ? "..." : "Create Offer"}
                          </button>
                          <button
                            className="lp-attach-cancel"
                            onClick={() => { setAttachJobId(null); setAttachName(""); }}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          className="lp-attach-trigger"
                          onClick={(e) => { e.stopPropagation(); setAttachJobId(item.id); setAttachName(""); }}
                        >
                          Create Offer
                        </button>
                      )}
                    </div>
                  ))}

                  {/* Margin approval cards */}
                  {marginSubTab === "margins" && filtered.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className={`lp-item lp-item-margin ${selectedItemId === item.id ? "lp-item-active" : ""}`}
                      onClick={() => onItemClick(item)}
                      aria-label={`Open margin details for ${item.candidateName || item.label}`}
                    >
                      <div className="lp-flex-col">
                        <p className="lp-item-label">{item.candidateName || item.label}</p>
                        <p className="lp-item-meta lp-margin-meta">
                          {(item.facilityName || "--")}
                          {item.specialty ? ` · ${item.specialty}` : item.profession ? ` · ${item.profession}` : ""}
                        </p>
                        <p className="lp-item-meta lp-margin-dates">
                          {formatShortDate(item.assignmentStart)} {item.assignmentEnd ? `→ ${formatShortDate(item.assignmentEnd)}` : ""}
                        </p>
                      </div>
                      <div className="lp-margin-values">
                        <span className="lp-margin-gross">{formatCurrency(item.weeklyGross)}</span>
                        <span className="lp-margin-pct">{formatPercent(item.actualMarginPct)}</span>
                      </div>
                    </button>
                  ))}
                </>
              );
            }

            // AyaOps mode: candidates grouped by specialty (server-normalized)
            if (mode === "ayaops") {
              const workflowStates = [
                { key: "all", label: "All" },
                { key: "prospect", label: "Prospect" },
                { key: "working", label: "Working" },
                { key: "submitted", label: "Submitted" },
                { key: "offer", label: "Offer" },
                { key: "prestart", label: "Prestart" },
                { key: "completed", label: "Completed" },
              ] as const;
              const stateLabelMap: Record<string, string> = workflowStates.reduce((acc, state) => {
                acc[state.key] = state.label;
                return acc;
              }, {} as Record<string, string>);
              const statusMap: Record<string, string> = {
                review: "prospect",
                under_review: "prospect",
                working: "working",
                active: "working",
                on_assignment: "working",
                submitted: "submitted",
                submittal: "submitted",
                submitted_to_client: "submitted",
                in_pipeline: "submitted",
                offer: "offer",
                offered: "offer",
                offer_extended: "offer",
                prestart: "prestart",
                pre_start: "prestart",
                pending_start: "prestart",
                starting_soon: "prestart",
                restart: "prestart",
                completed: "completed",
                done: "completed",
              };
              const normalizeStatus = (item: PanelItem) => {
                const rawStatus = String(item.derivedCurrentStatus || item.assignmentStatus || "")
                  .toLowerCase()
                  .trim()
                  .replace(/[\s-]+/g, "_");
                if (!rawStatus) return "prospect";
                return statusMap[rawStatus] || "prospect";
              };

              // Stat counts
              const statCounts: Record<string, number> = {
                all: 0,
                prospect: 0,
                working: 0,
                submitted: 0,
                offer: 0,
                prestart: 0,
                completed: 0,
              };
              for (const item of filtered) {
                const state = normalizeStatus(item);
                if (state in statCounts) statCounts[state]++;
                statCounts.all++;
              }

              // Apply status filter — "all" bypasses
              const statusFiltered = statusFilter === "all"
                ? filtered
                : filtered.filter((it) => normalizeStatus(it) === statusFilter);

              const specFiltered = statusFiltered;

              const ranked = [...specFiltered].sort((a, b) => {
                const levelRank = (value?: string | null) => {
                  const key = String(value || "").toLowerCase();
                  if (key === "critical") return 5;
                  if (key === "high") return 4;
                  if (key === "medium") return 3;
                  if (key === "standard") return 2;
                  if (key === "low") return 1;
                  return 0;
                };
                const levelDiff = levelRank(b.touchPriorityLevel) - levelRank(a.touchPriorityLevel);
                if (levelDiff !== 0) return levelDiff;
                const scoreDiff = (b.touchPriorityScore || 0) - (a.touchPriorityScore || 0);
                if (scoreDiff !== 0) return scoreDiff;
                const aDays = a.touchDaysToEnd ?? 9999;
                const bDays = b.touchDaysToEnd ?? 9999;
                if (aDays !== bDays) return aDays - bDays;
                return (a.label || "").localeCompare(b.label || "");
              });

              return (
                <>
                  <div className="lp-candidate-kicker-row">
                    <span className="lp-candidate-kicker">
                      {statusFilter === "prestart" ? "Prestarts" : statusFilter === "working" ? "Working" : "Candidates"}
                    </span>
                    <span className="lp-candidate-kicker-count">{specFiltered.length}</span>
                  </div>

                  {/* Flat matchup rows */}
                  {ranked.map((item) => {
                    const status = stateLabelMap[normalizeStatus(item)] || "Prospect";
                    const statusKey = status.toLowerCase().replace(/\s+/g, "-");
                    const statusLabel =
                      typeof item.touchDaysToEnd === "number"
                        ? `${status}, ${item.touchDaysToEnd} day${item.touchDaysToEnd === 1 ? "" : "s"}`
                        : status;
                    const isActive = selectedItemId === item.id;
                    return (
                      <button
                        type="button"
                        key={item.id}
                        className={`lp-item aya-candidate-card ${isActive ? "lp-item-active" : ""}`}
                        onClick={() => onItemClick(item)}
                        aria-label={`Open candidate ${item.label}`}
                      >
                        <div className="aya-card-collapsed">
                          <div className="aya-avatar">
                            {(item.label || "?").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                          </div>
                          <div className="aya-card-name-col">
                            {item.novaUrl ? (
                              <a
                                href={item.novaUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="lp-candidate-name-link"
                                onClick={e => e.stopPropagation()}
                              >{item.label}</a>
                            ) : (
                              <span className="lp-candidate-name-link">{item.label}</span>
                            )}
                            <span className="aya-card-meta">
                              {item.specialty || item.profession}
                              {item.homeState && ` · ${item.homeState}`}
                            </span>
                            {(item.rcThreadUrl || item.outlookThreadUrl || item.novaId || item.novaUrl) && (
                              <div className="aya-card-badges">
                                {(item.novaId || item.novaUrl) && (
                                  <a
                                    href={item.novaUrl || `/c/${item.novaId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="aya-nova-btn"
                                    onClick={e => e.stopPropagation()}
                                    title={item.novaUrl || `Nova profile`}
                                  >
                                    <ExternalLink size={11} strokeWidth={2.5} />
                                  </a>
                                )}
                                {item.novaId && (
                                  <a
                                    href={`/c/${item.novaId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="aya-hub-badge"
                                    onClick={e => e.stopPropagation()}
                                    title="Internal Profile"
                                  >
                                    <FileText size={11} strokeWidth={2.5} />
                                  </a>
                                )}
                                {item.rcThreadUrl && (
                                  <a
                                    href={item.rcThreadUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="aya-rc-badge"
                                    onClick={e => e.stopPropagation()}
                                    title="SMS Thread"
                                  >
                                    <MessageSquare size={11} strokeWidth={2.5} />
                                  </a>
                                )}
                                {item.outlookThreadUrl && (
                                  <a
                                    href={item.outlookThreadUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="aya-outlook-badge"
                                    onClick={e => e.stopPropagation()}
                                    title="Email Thread"
                                  >
                                    <Mail size={11} strokeWidth={2.5} />
                                  </a>
                                )}
                                {item.phone && (
                                  <a
                                    href={`tel:${item.phone}`}
                                    className="aya-rc-badge"
                                    onClick={e => e.stopPropagation()}
                                    title={`Call ${item.phone}`}
                                  >
                                    <Phone size={11} strokeWidth={2.5} />
                                  </a>
                                )}
                              </div>
                            )}
                            <span className={`aya-card-state aya-card-state-${statusKey}`}>
                              <span className="aya-card-state-dot" />
                              {statusLabel}
                            </span>
                          </div>
                          {/* Ghost action bar — visible on hover */}
                          <div className="aya-ghost-actions">
                            <button
                              type="button"
                              className="aya-ghost-btn"
                              title="Prep Note"
                              onClick={(e) => { e.stopPropagation(); onItemClick(item); }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                            </button>
                            {item.novaUrl && (
                              <a
                                href={item.novaUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="aya-ghost-btn"
                                title="Open in Nova"
                                onClick={e => e.stopPropagation()}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                              </a>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </>
              );
            }

            // Healthcare: editorial licensing cards
            if (mode === "healthcare") {
              const profFiltered = professionFilter
                ? filtered.filter((item) => {
                  const p = (item.profession || "").toLowerCase();
                  return p === professionFilter.toLowerCase();
                })
                : filtered;
              return profFiltered.map((item) => {
                const slug = item.id || "";
                const refUrl = buildLicensingReferenceUrl(slug);
                const parsed = inferHealthcareContextFromLabel(item.label);
                const stateName = parsed.state || item.state || "";
                const professionName = parsed.profession || item.profession || "";
                const isActive = selectedItemId === item.id;
                const isCopied = copiedHcUrl === item.id;
                return (
                  <div
                    key={item.id}
                    className={`lp-hc-card ${isActive ? "lp-hc-active" : ""}`}
                  >
                    <button
                      className="lp-hc-body"
                      onClick={() => onItemClick(item)}
                      title={item.board || item.label}
                      type="button"
                    >
                      <div className="lp-hc-header">
                        <span className="lp-hc-state">{stateName}</span>
                        <span className="lp-hc-profession">{professionName}</span>
                      </div>
                      <div className="lp-hc-row-group">
                        {item.fee !== undefined && (
                          <div className="lp-hc-row">
                            <span className="lp-hc-row-key">{item.renewalFee ? "Initial" : "Fee"}</span>
                            <span className="lp-hc-row-val">${item.fee}</span>
                          </div>
                        )}
                        {item.renewalFee !== undefined && (
                          <div className="lp-hc-row">
                            <span className="lp-hc-row-key">Renewal</span>
                            <span className="lp-hc-row-val">${item.renewalFee}</span>
                          </div>
                        )}
                        {item.compact && (
                          <div className="lp-hc-row">
                            <span className="lp-hc-row-key">Compact</span>
                            <span className="lp-hc-row-val lp-hc-row-yes">Yes</span>
                          </div>
                        )}
                        {item.description && (
                          <div className="lp-hc-row">
                            <span className="lp-hc-row-key">Timeline</span>
                            <span className="lp-hc-row-val">{item.description}</span>
                          </div>
                        )}
                      </div>
                    </button>
                    {refUrl && (
                      <div className="lp-hc-link-row">
                        <a
                          className="lp-hc-link"
                          href={refUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title={`Open ${stateName} ${professionName} on State Licensing Reference`}
                        >
                          {refUrl.replace("https://www.", "")}
                        </a>
                        <button
                          type="button"
                          className="lp-hc-copy-btn"
                          title="Copy link"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(refUrl).then(() => {
                              setCopiedHcUrl(item.id);
                              setTimeout(() => setCopiedHcUrl(null), 1800);
                            });
                          }}
                        >
                          {isCopied ? <Check size={11} /> : <Copy size={11} />}
                        </button>
                      </div>
                    )}
                  </div>
                );
              });
            }

            if (mode === "code") {
              return filtered.map((item) => {
                const asCodeItem = item as any;
                return (
                  <button
                    key={item.id}
                    className={`lp-item lp-item-code ${selectedItemId === item.id ? "lp-active" : ""}`}
                    onClick={() => onItemClick(item)}
                    title={item.label}
                  >
                    <span className="lp-item-label">{item.label}</span>
                    {asCodeItem.category && <span className="lp-item-meta">{asCodeItem.category} ({item.status})</span>}

                    {/* Browser Agent Payload - Grounding Target */}
                    <div className="sr-only"
                      data-grounding-type="ARCHITECTURE_VERDICT"
                      data-verdict-id={item.id}
                      data-agent={asCodeItem.agent || ""}
                      data-status={item.status || ""}
                      data-risk-zones={(asCodeItem.riskZones || []).join(",")}
                    >
                      [VERDICT]: {item.label}
                      Agent: {asCodeItem.agent}
                      Status: {item.status}
                      Preview: {asCodeItem.preview}
                      Use the 'verdicts' tools to write or list decisions.
                    </div>
                  </button>
                )
              });
            }

            if (mode === "clicks") {
              return filtered.map((item) => (
                <button
                  key={item.id}
                  className="lp-item"
                  onClick={() => onItemClick(item)}
                  title={item.label}
                  style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}
                >
                  <span className="lp-item-label">{item.label}</span>
                  {item.description && <span className="lp-item-desc" style={{ textAlign: "left" }}>{item.description}</span>}
                  <div style={{ display: "flex", justifyContent: "space-between", width: "100%", marginTop: 2 }}>
                    <span className="lp-item-meta">{item.startTime ? new Date(item.startTime).toLocaleTimeString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ""}</span>
                    <span className="lp-item-meta" style={{ color: item.status === "matched" ? "var(--green, #10b981)" : "inherit" }}>{item.status}</span>
                  </div>
                </button>
              ));
            }

            // Other non-sports modes: flat list
            return filtered.map((item) => (
              <button
                key={item.id}
                className="lp-item"
                onClick={() => onItemClick(item)}
                title={item.board || item.label}
              >
                <span className="lp-item-label">{item.label}</span>
                {item.fee !== undefined && (
                  <span className="lp-item-meta">${item.fee}</span>
                )}
                {item.description && (
                  <span className="lp-item-desc">{item.description}</span>
                )}
              </button>
            ));
          })()
        )}
      </div>
    </aside>
  );
}

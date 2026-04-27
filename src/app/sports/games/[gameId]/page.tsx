import Link from "next/link";
import { notFound } from "next/navigation";
import {
  loadCanonicalSportsGame,
  loadGameTrendTables,
  type TeamTrendRow,
  withSportsGameUrls,
} from "@/lib/sports/game-canonical";

export const dynamic = "force-dynamic";

export default async function SportsGamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId: gameIdRaw } = await params;
  const gameId = String(gameIdRaw || "").trim();
  if (!gameId) notFound();

  const raw = await loadCanonicalSportsGame(gameId);
  if (!raw) {
    return (
      <html lang="en">
        <body style={{ background: "#FAF6EE", fontFamily: "'DM Sans', sans-serif", color: "#1F1A14" }}>
          <main style={{ maxWidth: 640, margin: "0 auto", padding: "48px 20px" }}>
            <p style={{ color: "#6B6253" }}>
              No game found for <code style={{ fontFamily: "var(--mono)" }}>{gameId}</code>
            </p>
            <Link href="/chat" style={{ color: "#6B6253", fontSize: 14 }}>← Back to console</Link>
          </main>
        </body>
      </html>
    );
  }

  const game = withSportsGameUrls(raw);
  const trends = await loadGameTrendTables(raw, 5);
  const kickoff = game.startTime ? new Date(game.startTime) : null;
  const normalizedStatus = String(game.status || "").trim().toLowerCase();
  const livePayload =
    game.live && typeof game.live === "object" && !Array.isArray(game.live)
      ? (game.live as Record<string, unknown>)
      : null;
  const liveProgress =
    (typeof livePayload?.progress === "string" && livePayload.progress.trim())
    || (typeof livePayload?.status === "string" && livePayload.status.trim())
    || (typeof livePayload?.game_status === "string" && livePayload.game_status.trim())
    || null;
  const isPost =
    normalizedStatus === "post" ||
    normalizedStatus === "final" ||
    normalizedStatus === "ft" ||
    normalizedStatus.includes("final") ||
    normalizedStatus.includes("full time") ||
    normalizedStatus.includes("full_time") ||
    normalizedStatus.includes("completed") ||
    normalizedStatus.includes("ended");
  const isLive =
    normalizedStatus === "live" ||
    normalizedStatus === "in progress" ||
    normalizedStatus.includes("in progress");
  const isPre = !isPost && !isLive;

  const dateLabel = kickoff
    ? kickoff.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : game.date || "TBD";
  const timeLabel = kickoff
    ? kickoff.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" })
    : null;

  const league = game.leagueLabel || game.sport || "—";
  const spreadLabel = game.spread != null
    ? `${game.homeTeam} ${game.spread > 0 ? `+${game.spread}` : String(game.spread)}`
    : null;
  const totalLabel = game.total != null ? `Over / Under ${game.total}` : null;

  // Build a contextual headline
  const headline = isPre
    ? spreadLabel
      ? `${game.awayTeam} travels to ${game.homeTeam} as the ${Math.abs(game.spread ?? 0)}-goal ${(game.spread ?? 0) < 0 ? "favorite" : "underdog"}.`
      : `${game.awayTeam} visits ${game.homeTeam} in ${league} action.`
    : isLive
      ? `${game.awayTeam} and ${game.homeTeam} are live now${liveProgress ? ` (${liveProgress})` : ""}.`
      : (() => {
      if (game.homeScore != null && game.awayScore != null) {
        const isDraw = game.homeScore === game.awayScore;
        
        if (isDraw) {
          // Draw: use away team ATS for context since away is the "visitor"
          const awayATS = game.awayATSResult?.toUpperCase()?.charAt(0);
          let coverStr = "";
          if (awayATS === 'W') coverStr = ` and ${game.awayTeam} covered the spread`;
          else if (awayATS === 'L') coverStr = ` and ${game.homeTeam} covered the spread`;
          else if (awayATS === 'P') coverStr = " with a push on the spread";
          return `${game.awayTeam} and ${game.homeTeam} drew ${game.homeScore}-${game.awayScore}${coverStr}.`;
        }
        
        const homeWon = game.homeScore > game.awayScore;
        const winner = homeWon ? game.homeTeam : game.awayTeam;
        const loser = homeWon ? game.awayTeam : game.homeTeam;
        const winnerScore = homeWon ? game.homeScore : game.awayScore;
        const loserScore = homeWon ? game.awayScore : game.homeScore;
        const winnerATS = homeWon ? game.homeATSResult : game.awayATSResult;
        
        const atsChar = winnerATS?.toUpperCase()?.charAt(0);
        let coverStr = "";
        if (atsChar === 'W') coverStr = " and covered the spread";
        else if (atsChar === 'L') coverStr = " but didn't cover the spread";
        else if (atsChar === 'P') coverStr = " and pushed the spread";
        
        const loc = homeWon ? `against ${loser}` : `at ${loser}`;
        return `${winner} won ${winnerScore}-${loserScore} ${loc}${coverStr}.`;
      }
      return `${game.awayTeam} visited ${game.homeTeam} for a final result.`;
    })();

  // First letter for crest fallback
  const homeInitial = game.homeTeam?.charAt(0) || "H";
  const awayInitial = game.awayTeam?.charAt(0) || "A";

  return (
    <>
      <style>{drip_css}</style>
      <main className="drip-page">

        {/* Hero image for a premium human feel */}
        <div className="drip-hero" role="img" aria-label="Hero photograph context">
          {isPre ? (
            <span className="drip-hero-note">[ Matchup Preview • {league} ]</span>
          ) : isLive ? (
            <span className="drip-hero-note">[ Live Matchup • {league} ]</span>
          ) : (
            <span className="drip-hero-note">[ Final Result • {league} ]</span>
          )}
        </div>

        {/* Breadcrumb */}
        <nav className="drip-crumb" aria-label="Breadcrumb">
          <Link href="/chat" className="drip-crumb-link">Console</Link>
          <span className="drip-crumb-sep">/</span>
          <Link href="/chat" className="drip-crumb-link">{league}</Link>
          <span className="drip-crumb-sep">/</span>
          <span className="drip-crumb-current">{game.awayTeam} vs {game.homeTeam}</span>
        </nav>

        {/* Meta */}
        <div className="drip-meta">
          <span className="drip-meta-row">{dateLabel}{timeLabel ? `, ${timeLabel}` : ""}</span>
          <span className="drip-meta-row">{league}</span>
        </div>

        {/* Headline */}
        <h1 className="drip-h1">{headline}</h1>

        {/* Game header */}
        <header className="drip-game">
          <div className="drip-team">
            {game.awayLogo ? (
              <img src={game.awayLogo} alt="" width={52} height={52} className="drip-crest-img" />
            ) : (
              <div className="drip-crest drip-crest-away">{awayInitial}</div>
            )}
            <div className="drip-team-name">{game.awayTeam}</div>
            {game.awayRecord && <div className="drip-team-record">{game.awayRecord}</div>}
          </div>

          {isPre ? (
            <div className="drip-kickoff">
              {timeLabel && <span className="drip-kickoff-time">{timeLabel.split(" ")[0]}</span>}
              <span>{timeLabel ? timeLabel.split(" ").slice(1).join(" ") : "TBD"}</span>
            </div>
          ) : (
            <div className="drip-score-wrap">
              <span className="drip-score-label">{isPost ? "Final Score" : "Live Score"}</span>
              <div className="drip-score-block">
                {game.awayScore != null && game.homeScore != null ? (
                  <>
                    <span className="drip-score-val">{game.awayScore}</span>
                    <span className="drip-score-sep">-</span>
                    <span className="drip-score-val">{game.homeScore}</span>
                  </>
                ) : (
                  <span className="drip-vs">—</span>
                )}
              </div>
            </div>
          )}

          <div className="drip-team">
            {game.homeLogo ? (
              <img src={game.homeLogo} alt="" width={52} height={52} className="drip-crest-img" />
            ) : (
              <div className="drip-crest drip-crest-home">{homeInitial}</div>
            )}
            <div className="drip-team-name">{game.homeTeam}</div>
            {game.homeRecord && <div className="drip-team-record">{game.homeRecord}</div>}
          </div>
        </header>

        {/* Status */}
        <div className="drip-state">
          {isPost
            ? "Full time"
            : isLive
              ? `Live${liveProgress ? ` • ${liveProgress}` : ""}`
              : isPre && kickoff
                ? "Scheduled"
                : "—"}
        </div>

        {/* Lines */}
        {(spreadLabel || totalLabel) && (
          <section className="drip-lines" aria-label="Betting lines">
            {spreadLabel && (
              <article className="drip-line">
                <div className="drip-line-label">Spread</div>
                <div className="drip-line-posted">{spreadLabel}</div>
              </article>
            )}
            {totalLabel && (
              <article className="drip-line">
                <div className="drip-line-label">Total</div>
                <div className="drip-line-posted">{totalLabel}</div>
              </article>
            )}
          </section>
        )}

        {/* Venue */}
        {game.venue && (
          <div className="drip-venue">
            <span className="drip-venue-label">Venue</span>
            <span>{game.venue}</span>
          </div>
        )}

        {/* Trend tables */}
        <section className="drip-trends" aria-label="Recent team trend tables">
          <h2 className="drip-trends-title">Recent Results (Last 5)</h2>
          <p className="drip-trends-sub">Verified from canonical game records and ordered by kickoff descending.</p>
          <div className="drip-trends-grid">
            <TrendTable title={`${game.awayTeam} trend`} rows={trends.away} />
            <TrendTable title={`${game.homeTeam} trend`} rows={trends.home} />
          </div>
        </section>

        {/* API / Hub links */}
        <div className="drip-links">
          <Link href={game.hubUrl} className="drip-link">Hub JSON →</Link>
          <Link href={game.apiUrl} className="drip-link">API →</Link>
          {game.writeupUrl && (
            <a href={game.writeupUrl} target="_blank" rel="noopener noreferrer" className="drip-link">Writeup →</a>
          )}
        </div>

        <footer className="drip-foot">
          <span>Game ID: {gameId}</span>
          <span className="drip-foot-source">
            <Link href="/chat">The Lab</Link>
          </span>
        </footer>
      </main>
    </>
  );
}

function formatTrendDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value.includes("T") ? value : `${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function TrendTable({ title, rows }: { title: string; rows: TeamTrendRow[] }) {
  return (
    <article className="drip-trend-card">
      <h3 className="drip-trend-title">{title}</h3>
      <table className="drip-trend-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Opp</th>
            <th>Score</th>
            <th>Res</th>
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? rows.map((row) => (
            <tr key={`${row.gameId}-${row.opponent}-${row.kickoff || row.date || ""}`}>
              <td>{formatTrendDate(row.kickoff || row.date)}</td>
              <td>{row.opponent}</td>
              <td>
                {row.teamScore != null && row.opponentScore != null
                  ? `${row.teamScore}-${row.opponentScore}`
                  : "—"}
              </td>
              <td>
                <span className={`drip-res-pill ${row.result ? `drip-res-${row.result.toLowerCase()}` : "drip-res-na"}`}>
                  {row.result || "—"}
                </span>
              </td>
            </tr>
          )) : (
            <tr>
              <td colSpan={4} className="drip-trend-empty">No recent rows</td>
            </tr>
          )}
        </tbody>
      </table>
    </article>
  );
}

const drip_css = `
  @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500&family=DM+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap');

  .drip-page {
    --bg: #FAF6EE;
    --bg-card: #FFFFFF;
    --ink: #1F1A14;
    --ink-2: #4A3F2D;
    --ink-3: #6B6253;
    --ink-4: #8A7E6B;
    --rule: #E5DCC7;
    --rule-soft: #F0E8D5;
    --serif: 'Source Serif 4', Georgia, serif;
    --sans: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    --mono: 'IBM Plex Mono', 'SF Mono', Menlo, monospace;

    max-width: 640px;
    margin: 0 auto;
    padding: 32px 20px 48px;
    background: var(--bg);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 16px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    min-height: 100vh;
  }

  /* Hero */
  .drip-hero {
    background: linear-gradient(135deg, #B8A47E 0%, #9B8865 100%);
    height: 180px;
    border-radius: 4px;
    margin-bottom: 24px;
    display: flex;
    align-items: flex-end;
    padding: 16px;
    font-family: var(--mono);
    font-size: 10px;
    color: #F5EFE0;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    position: relative;
    overflow: hidden;
    box-shadow: inset 0 2px 20px rgba(0,0,0,0.1);
  }
  .drip-hero::before {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 30% 40%, rgba(245,239,224,0.15), transparent 60%);
  }
  .drip-hero-note {
    position: relative;
    z-index: 1;
    opacity: 0.9;
  }

  /* Breadcrumb */
  .drip-crumb {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-4);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-bottom: 28px;
  }
  .drip-crumb-link {
    color: var(--ink-4);
    text-decoration: none;
    transition: color 0.15s ease;
  }
  .drip-crumb-link:hover { color: var(--ink-2); }
  .drip-crumb-sep { margin: 0 10px; color: #C0B49C; }
  .drip-crumb-current { color: var(--ink-2); }

  /* Meta */
  .drip-meta {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-4);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-bottom: 12px;
  }
  .drip-meta-row { display: block; }
  .drip-meta-row + .drip-meta-row { margin-top: 2px; }

  /* Headline */
  .drip-h1 {
    font-family: var(--serif);
    font-size: 32px;
    line-height: 1.18;
    font-weight: 400;
    letter-spacing: -0.01em;
    margin: 0 0 28px;
    color: var(--ink);
  }

  /* Game header */
  .drip-game {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 16px;
    align-items: center;
    padding: 22px 0 24px;
    border-top: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
    margin-bottom: 18px;
  }
  .drip-team {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .drip-crest {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--serif);
    font-size: 22px;
    font-weight: 500;
    background: var(--bg-card);
    color: var(--ink-2);
    border: 1px solid var(--rule);
    flex-shrink: 0;
  }
  .drip-crest-img {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    object-fit: contain;
    background: var(--bg-card);
    border: 1px solid var(--rule);
    flex-shrink: 0;
  }
  .drip-team-name {
    font-family: var(--serif);
    font-size: 16px;
    font-weight: 500;
    text-align: center;
  }
  .drip-team-record {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-4);
    letter-spacing: 0.04em;
  }
  .drip-vs {
    font-family: var(--mono);
    font-size: 14px;
    color: var(--ink-3);
    padding: 0 18px;
    letter-spacing: 0.04em;
  }
  .drip-kickoff {
    font-family: var(--mono);
    font-size: 14px;
    line-height: 1.3;
    text-align: center;
    padding: 0 18px;
    color: var(--ink-3);
    letter-spacing: 0.04em;
  }
  .drip-kickoff-time {
    font-size: 18px;
    color: var(--ink);
    display: block;
    margin-bottom: 4px;
  }
  
  /* Scores */
  .drip-score-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    min-width: 150px;
  }
  .drip-score-label {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--ink-4);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .drip-score-block {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    font-family: var(--serif);
    font-size: 46px;
    line-height: 1;
    color: var(--ink);
  }
  .drip-score-val {
    font-weight: 500;
  }
  .drip-score-sep {
    color: var(--ink-4);
    font-size: 20px;
    font-family: var(--mono);
  }


  /* Status */
  .drip-state {
    text-align: center;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-4);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-bottom: 28px;
  }

  /* Lines */
  .drip-lines {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 36px;
  }
  .drip-line {
    background: var(--bg-card);
    border: 1px solid var(--rule);
    padding: 16px 18px;
    border-radius: 2px;
  }
  .drip-line-label {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-4);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-bottom: 8px;
  }
  .drip-line-posted {
    font-family: var(--serif);
    font-size: 18px;
    font-weight: 500;
    color: var(--ink);
  }

  /* Venue */
  .drip-venue {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--ink-3);
    padding: 14px 16px;
    background: var(--bg-card);
    border: 1px solid var(--rule);
    border-radius: 2px;
    margin-bottom: 36px;
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .drip-venue-label {
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-4);
    flex-shrink: 0;
  }

  /* Trends */
  .drip-trends {
    margin-bottom: 34px;
  }
  .drip-trends-title {
    font-family: var(--serif);
    font-size: 24px;
    line-height: 1.2;
    margin: 0 0 8px;
    color: var(--ink);
  }
  .drip-trends-sub {
    margin: 0 0 14px;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.04em;
    color: var(--ink-4);
  }
  .drip-trends-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .drip-trend-card {
    background: var(--bg-card);
    border: 1px solid var(--rule);
    border-radius: 2px;
    padding: 12px;
  }
  .drip-trend-title {
    margin: 0 0 8px;
    font-family: var(--serif);
    font-size: 17px;
    font-weight: 500;
    color: var(--ink);
  }
  .drip-trend-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  .drip-trend-table th,
  .drip-trend-table td {
    padding: 7px 4px;
    border-bottom: 1px solid var(--rule-soft);
    font-size: 12px;
    color: var(--ink-2);
    text-align: left;
    vertical-align: middle;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .drip-trend-table th {
    font-family: var(--mono);
    letter-spacing: 0.04em;
    color: var(--ink-4);
    font-size: 10px;
    text-transform: uppercase;
  }
  .drip-trend-empty {
    color: var(--ink-4) !important;
    text-align: center !important;
    font-family: var(--mono);
    font-size: 11px !important;
  }
  .drip-res-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    border-radius: 999px;
    font-family: var(--mono);
    font-size: 10px;
    border: 1px solid var(--rule);
    color: var(--ink-3);
  }
  .drip-res-w {
    background: #e8f4e6;
    border-color: #b9d7b5;
    color: #1f5f2c;
  }
  .drip-res-l {
    background: #faeaea;
    border-color: #ddbbbb;
    color: #7b2a2a;
  }
  .drip-res-d {
    background: #f4f0e8;
    border-color: #d7cab5;
    color: #5f4f2c;
  }

  /* Links */
  .drip-links {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 36px;
  }
  .drip-link {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--ink-3);
    text-decoration: none;
    letter-spacing: 0.04em;
    transition: color 0.15s ease;
  }
  .drip-link:hover { color: var(--ink); }

  /* Footer */
  .drip-foot {
    margin-top: 32px;
    padding-top: 18px;
    border-top: 1px solid var(--rule);
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-4);
    letter-spacing: 0.04em;
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
  }
  .drip-foot-source a {
    color: var(--ink-3);
    text-decoration: none;
  }
  .drip-foot-source a:hover { color: var(--ink); }

  /* Mobile */
  @media (max-width: 480px) {
    .drip-page { padding: 24px 16px 40px; }
    .drip-h1 { font-size: 26px; margin-bottom: 22px; }
    .drip-crest, .drip-crest-img { width: 44px; height: 44px; font-size: 18px; }
    .drip-team-name { font-size: 14px; }
    .drip-score-block { font-size: 38px; }
    .drip-lines { grid-template-columns: 1fr; }
    .drip-trends-grid { grid-template-columns: 1fr; }
    .drip-kickoff { padding: 0 8px; font-size: 12px; }
    .drip-kickoff-time { font-size: 15px; }
  }
`;

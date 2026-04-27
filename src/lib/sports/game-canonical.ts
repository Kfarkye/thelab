import { getDb } from "@/lib/spanner-pool";
import { normalizeMLBStatusCode } from "@/lib/sports/status";

const LEAGUE_LABEL_BY_ID = new Map<string, string>([
  ["mlb", "MLB"],
  ["nba", "NBA"],
  ["wnba", "WNBA"],
  ["nhl", "NHL"],
  ["nfl", "NFL"],
  ["eng.1", "EPL"],
  ["esp.1", "La Liga"],
  ["ita.1", "Serie A"],
  ["ger.1", "Bundesliga"],
  ["fra.1", "Ligue 1"],
  ["ligue1", "Ligue 1"],
  ["usa.1", "MLS"],
  ["mex.1", "Liga MX"],
  ["ned.1", "Eredivisie"],
  ["por.1", "Primeira Liga"],
  ["sco.1", "Scottish Premiership"],
  ["tur.1", "Super Lig"],
  ["arg.1", "Argentina Primera"],
  ["bel.1", "Belgian Pro League"],
  ["bra.1", "Brasileirao"],
  ["uefa.champions", "Champions League"],
  ["uefa.europa", "Europa League"],
]);

export type CanonicalSportsGame = {
  id: string;
  source: "game" | "match";
  homeTeam: string;
  awayTeam: string;
  homeAbbrev: string | null;
  awayAbbrev: string | null;
  homeLogo: string | null;
  awayLogo: string | null;
  date: string | null;
  startTime: string | null;
  status: string | null;
  venue: string | null;
  sport: string | null;
  leagueId: string | null;
  leagueLabel: string | null;
  writeupUrl: string | null;
  publishedAt: string | null;
  homeRecord: string | null;
  awayRecord: string | null;
  spread: number | null;
  total: number | null;
  homeScore: number | null;
  awayScore: number | null;
  homeATSResult: string | null;
  awayATSResult: string | null;
};

export type CanonicalSportsGameSearchResult = {
  id: string;
  label: string;
  leagueLabel: string | null;
  status: string | null;
};

export type TeamTrendRow = {
  gameId: string;
  kickoff: string | null;
  date: string | null;
  leagueLabel: string | null;
  opponent: string;
  teamScore: number | null;
  opponentScore: number | null;
  result: "W" | "L" | "D" | null;
};

export type TeamTrendsForGame = {
  home: TeamTrendRow[];
  away: TeamTrendRow[];
};

let cachedGamePreviewTablePresence: boolean | null = null;

function toIsoOrNull(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDateOnly(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function sanitizeHttpsUrl(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return /^https:\/\//i.test(raw) ? raw : null;
}

function toLeagueLabel(leagueId: unknown): string | null {
  const normalized = String(leagueId || "").trim().toLowerCase();
  if (!normalized) return null;
  return LEAGUE_LABEL_BY_ID.get(normalized) || String(leagueId);
}

function computeResult(teamScore: number | null, opponentScore: number | null): "W" | "L" | "D" | null {
  if (teamScore == null || opponentScore == null) return null;
  if (teamScore > opponentScore) return "W";
  if (teamScore < opponentScore) return "L";
  return "D";
}

function isLikelyPlaceholderZeroZero(leagueLabel: string | null, teamScore: number | null, opponentScore: number | null): boolean {
  if (teamScore !== 0 || opponentScore !== 0) return false;
  return leagueLabel === "NBA" || leagueLabel === "WNBA" || leagueLabel === "NHL" || leagueLabel === "NFL" || leagueLabel === "MLB";
}

type GameResultSnapshot = {
  matchId: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homeATSResult: string | null;
  awayATSResult: string | null;
  homeRecord: string | null;
  awayRecord: string | null;
  spread: number | null;
  total: number | null;
};

function mapGameResultSnapshot(row: Record<string, unknown>): GameResultSnapshot {
  return {
    matchId: row.MatchID ? String(row.MatchID) : null,
    homeScore: toNumberOrNull(row.HomeScore),
    awayScore: toNumberOrNull(row.AwayScore),
    homeATSResult: row.HomeATSResult ? String(row.HomeATSResult) : null,
    awayATSResult: row.AwayATSResult ? String(row.AwayATSResult) : null,
    homeRecord: row.HomeRecord ? String(row.HomeRecord) : null,
    awayRecord: row.AwayRecord ? String(row.AwayRecord) : null,
    spread: toNumberOrNull(row.Spread),
    total: toNumberOrNull(row.Total),
  };
}

function mergeGameWithSnapshot(game: CanonicalSportsGame, snapshot: GameResultSnapshot): CanonicalSportsGame {
  return {
    ...game,
    homeScore: snapshot.homeScore,
    awayScore: snapshot.awayScore,
    homeATSResult: snapshot.homeATSResult,
    awayATSResult: snapshot.awayATSResult,
    homeRecord: snapshot.homeRecord || game.homeRecord,
    awayRecord: snapshot.awayRecord || game.awayRecord,
    spread: snapshot.spread ?? game.spread,
    total: snapshot.total ?? game.total,
  };
}

async function loadGameResultSnapshotByMatchId(
  db: ReturnType<typeof getDb>,
  matchId: string,
): Promise<GameResultSnapshot | null> {
  const [rows] = await db.run({
    sql: `SELECT
            MIN(gr.MatchID) AS MatchID,
            MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamScore END) AS HomeScore,
            MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamScore END) AS AwayScore,
            MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ATSResult END) AS HomeATSResult,
            MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.ATSResult END) AS AwayATSResult,
            MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamRecord END) AS HomeRecord,
            MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamRecord END) AS AwayRecord,
            MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingSpread END) AS Spread,
            MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingTotal END) AS Total
          FROM GameResult gr
          WHERE gr.MatchID = @matchId`,
    params: { matchId },
    types: { matchId: { type: "string" } },
  });

  if (rows.length === 0) return null;
  const row = rows[0].toJSON() as Record<string, unknown>;
  if (!row.MatchID) return null;
  return mapGameResultSnapshot(row);
}

async function loadGameResultSnapshotByMatchup(
  db: ReturnType<typeof getDb>,
  options: { homeTeam: string; awayTeam: string; targetStartTime: string | null },
): Promise<GameResultSnapshot | null> {
  const homeTeam = options.homeTeam.trim().toLowerCase();
  const awayTeam = options.awayTeam.trim().toLowerCase();
  const targetStartTime = toIsoOrNull(options.targetStartTime);

  if (!homeTeam || !awayTeam) return null;

  const [rows] = await db.run({
    sql: `WITH matchup AS (
            SELECT
              MIN(gr.MatchID) AS MatchID,
              MIN(gr.StartTime) AS StartTime,
              MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamScore END) AS HomeScore,
              MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamScore END) AS AwayScore,
              MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ATSResult END) AS HomeATSResult,
              MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.ATSResult END) AS AwayATSResult,
              MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamRecord END) AS HomeRecord,
              MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamRecord END) AS AwayRecord,
              MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingSpread END) AS Spread,
              MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingTotal END) AS Total
            FROM GameResult gr
            WHERE (
              (LOWER(gr.Side) = 'home' AND LOWER(gr.TeamName) = @homeTeam AND LOWER(gr.OpponentName) = @awayTeam)
              OR
              (LOWER(gr.Side) = 'away' AND LOWER(gr.TeamName) = @awayTeam AND LOWER(gr.OpponentName) = @homeTeam)
            )
            GROUP BY gr.MatchID
          )
          SELECT
            MatchID,
            HomeScore,
            AwayScore,
            HomeATSResult,
            AwayATSResult,
            HomeRecord,
            AwayRecord,
            Spread,
            Total
          FROM matchup
          ORDER BY
            CASE
              WHEN @targetStartTime IS NULL THEN 0
              ELSE ABS(TIMESTAMP_DIFF(StartTime, @targetStartTime, MINUTE))
            END ASC,
            StartTime DESC
          LIMIT 1`,
    params: { homeTeam, awayTeam, targetStartTime: targetStartTime ? new Date(targetStartTime) : null },
    types: {
      homeTeam: { type: "string" },
      awayTeam: { type: "string" },
      targetStartTime: { type: "timestamp" },
    },
  });

  if (rows.length === 0) return null;
  const row = rows[0].toJSON() as Record<string, unknown>;
  if (!row.MatchID) return null;
  return mapGameResultSnapshot(row);
}

async function hasGamePreviewTable(): Promise<boolean> {
  if (cachedGamePreviewTablePresence != null) {
    return cachedGamePreviewTablePresence;
  }

  const db = getDb("sportsdb");
  const [rows] = await db.run({
    sql: `SELECT TABLE_NAME
          FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = ''
            AND TABLE_NAME = 'GamePreview'`,
  });

  cachedGamePreviewTablePresence = rows.length > 0;
  return cachedGamePreviewTablePresence;
}

function buildUrls(gameId: string) {
  const encodedId = encodeURIComponent(gameId);
  return {
    hubUrl: `/api/hub/games/${encodedId}`,
    apiUrl: `/api/sports/games/${encodedId}`,
    publicUrl: `/sports/games/${encodedId}`,
  };
}

export function buildSportsGameUrls(gameId: string) {
  return buildUrls(gameId);
}

function mapGameTableRow(row: Record<string, unknown>): CanonicalSportsGame {
  return {
    id: String(row.GameID || ""),
    source: "game",
    homeTeam: String(row.HomeTeam || "TBD"),
    awayTeam: String(row.AwayTeam || "TBD"),
    homeAbbrev: row.HomeAbbrev ? String(row.HomeAbbrev) : null,
    awayAbbrev: row.AwayAbbrev ? String(row.AwayAbbrev) : null,
    homeLogo: row.HomeLogo ? String(row.HomeLogo) : null,
    awayLogo: row.AwayLogo ? String(row.AwayLogo) : null,
    date: toDateOnly(row.GameDate),
    startTime: toIsoOrNull(row.ScheduledStartAt),
    status: normalizeMLBStatusCode(row.Status),
    venue: row.Venue ? String(row.Venue) : null,
    sport: "baseball",
    leagueId: "mlb",
    leagueLabel: "MLB",
    writeupUrl: sanitizeHttpsUrl(row.WriteupUrl),
    publishedAt: toIsoOrNull(row.PublishedAt),
    homeRecord: null,
    awayRecord: null,
    spread: null,
    total: null,
    homeScore: null,
    awayScore: null,
    homeATSResult: null,
    awayATSResult: null,
  };
}

function mapGameResultRow(row: Record<string, unknown>): CanonicalSportsGame {
  const leagueId = row.LeagueID ? String(row.LeagueID) : null;
  return {
    id: String(row.MatchID || ""),
    source: "match",
    homeTeam: String(row.HomeTeam || row.HomeFromAway || "TBD"),
    awayTeam: String(row.AwayTeam || row.AwayFromHome || "TBD"),
    homeAbbrev: null,
    awayAbbrev: null,
    homeLogo: row.HomeLogo ? String(row.HomeLogo) : null,
    awayLogo: row.AwayLogo ? String(row.AwayLogo) : null,
    date: toDateOnly(row.GameDate),
    startTime: toIsoOrNull(row.StartTime),
    status:
      row.StartTime && new Date(String(row.StartTime)).getTime() > Date.now()
        ? "SCHEDULED"
        : "FINAL",
    venue: null,
    sport: row.Sport ? String(row.Sport) : null,
    leagueId,
    leagueLabel: toLeagueLabel(leagueId),
    writeupUrl: sanitizeHttpsUrl(row.WriteupUrl),
    publishedAt: toIsoOrNull(row.PublishedAt),
    homeRecord: row.HomeRecord ? String(row.HomeRecord) : null,
    awayRecord: row.AwayRecord ? String(row.AwayRecord) : null,
    spread: toNumberOrNull(row.Spread),
    total: toNumberOrNull(row.Total),
    homeScore: toNumberOrNull(row.HomeScore),
    awayScore: toNumberOrNull(row.AwayScore),
    homeATSResult: row.HomeATSResult ? String(row.HomeATSResult) : null,
    awayATSResult: row.AwayATSResult ? String(row.AwayATSResult) : null,
  };
}

export async function loadCanonicalSportsGame(gameIdRaw: string): Promise<CanonicalSportsGame | null> {
  const gameId = String(gameIdRaw || "").trim();
  if (!gameId) return null;

  const db = getDb("sportsdb");
  const previewTableExists = await hasGamePreviewTable();

  const gameSql = previewTableExists
    ? `SELECT
          g.GameID,
          g.GameDate,
          g.ScheduledStartAt,
          g.Status,
          g.Venue,
          h.Name AS HomeTeam,
          h.Abbrev AS HomeAbbrev,
          h.LogoURL AS HomeLogo,
          a.Name AS AwayTeam,
          a.Abbrev AS AwayAbbrev,
          a.LogoURL AS AwayLogo,
          p.WriteupUrl,
          p.PublishedAt
        FROM Game g
        LEFT JOIN Team h ON g.HomeTeamID = h.TeamID
        LEFT JOIN Team a ON g.AwayTeamID = a.TeamID
        LEFT JOIN GamePreview p ON p.GameID = g.GameID
        WHERE CAST(g.GameID AS STRING) = @gameId
        LIMIT 1`
    : `SELECT
          g.GameID,
          g.GameDate,
          g.ScheduledStartAt,
          g.Status,
          g.Venue,
          h.Name AS HomeTeam,
          h.Abbrev AS HomeAbbrev,
          h.LogoURL AS HomeLogo,
          a.Name AS AwayTeam,
          a.Abbrev AS AwayAbbrev,
          a.LogoURL AS AwayLogo,
          CAST(NULL AS STRING) AS WriteupUrl,
          CAST(NULL AS TIMESTAMP) AS PublishedAt
        FROM Game g
        LEFT JOIN Team h ON g.HomeTeamID = h.TeamID
        LEFT JOIN Team a ON g.AwayTeamID = a.TeamID
        WHERE CAST(g.GameID AS STRING) = @gameId
        LIMIT 1`;

  const [gameRows] = await db.run({
    sql: gameSql,
    params: { gameId },
    types: { gameId: { type: "string" } },
  });

  if (gameRows.length > 0) {
    const row = gameRows[0].toJSON() as Record<string, unknown>;
    const baseGame = mapGameTableRow(row);
    let snapshot = await loadGameResultSnapshotByMatchId(db, baseGame.id);

    if (!snapshot && baseGame.homeTeam && baseGame.awayTeam) {
      snapshot = await loadGameResultSnapshotByMatchup(db, {
        homeTeam: baseGame.homeTeam,
        awayTeam: baseGame.awayTeam,
        targetStartTime: baseGame.startTime,
      });
    }

    return snapshot ? mergeGameWithSnapshot(baseGame, snapshot) : baseGame;
  }

  const matchSql = previewTableExists
    ? `SELECT
          gr.MatchID,
          MIN(gr.GameDate) AS GameDate,
          MIN(gr.StartTime) AS StartTime,
          MIN(gr.Sport) AS Sport,
          MIN(gr.LeagueID) AS LeagueID,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamName END) AS HomeTeam,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamName END) AS AwayTeam,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.OpponentName END) AS AwayFromHome,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.OpponentName END) AS HomeFromAway,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamLogoURL END) AS HomeLogo,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamLogoURL END) AS AwayLogo,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamRecord END) AS HomeRecord,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamRecord END) AS AwayRecord,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingSpread END) AS Spread,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingTotal END) AS Total,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamScore END) AS HomeScore,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamScore END) AS AwayScore,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ATSResult END) AS HomeATSResult,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.ATSResult END) AS AwayATSResult,
          p.WriteupUrl,
          p.PublishedAt
        FROM GameResult gr
        LEFT JOIN GamePreview p ON p.GameID = gr.MatchID
        WHERE gr.MatchID = @gameId
        GROUP BY gr.MatchID, p.WriteupUrl, p.PublishedAt
        LIMIT 1`
    : `SELECT
          gr.MatchID,
          MIN(gr.GameDate) AS GameDate,
          MIN(gr.StartTime) AS StartTime,
          MIN(gr.Sport) AS Sport,
          MIN(gr.LeagueID) AS LeagueID,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamName END) AS HomeTeam,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamName END) AS AwayTeam,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.OpponentName END) AS AwayFromHome,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.OpponentName END) AS HomeFromAway,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamLogoURL END) AS HomeLogo,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamLogoURL END) AS AwayLogo,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamRecord END) AS HomeRecord,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamRecord END) AS AwayRecord,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingSpread END) AS Spread,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingTotal END) AS Total,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamScore END) AS HomeScore,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamScore END) AS AwayScore,
          MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ATSResult END) AS HomeATSResult,
          MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.ATSResult END) AS AwayATSResult,
          CAST(NULL AS STRING) AS WriteupUrl,
          CAST(NULL AS TIMESTAMP) AS PublishedAt
        FROM GameResult gr
        WHERE gr.MatchID = @gameId
        GROUP BY gr.MatchID
        LIMIT 1`;

  const [matchRows] = await db.run({
    sql: matchSql,
    params: { gameId },
    types: { gameId: { type: "string" } },
  });

  if (matchRows.length > 0) {
    const row = matchRows[0].toJSON() as Record<string, unknown>;
    return mapGameResultRow(row);
  }

  return null;
}

export async function searchCanonicalSportsGames(
  queryRaw: string,
  limit = 5,
): Promise<CanonicalSportsGameSearchResult[]> {
  const query = String(queryRaw || "").trim().toLowerCase();
  if (!query) return [];

  const db = getDb("sportsdb");
  const pattern = `%${query}%`;
  const safeLimit = Math.max(1, Math.min(10, Math.trunc(limit)));

  const [gameRows] = await db.run({
    sql: `SELECT
            g.GameID,
            g.Status,
            h.Name AS HomeTeam,
            a.Name AS AwayTeam
          FROM Game g
          LEFT JOIN Team h ON g.HomeTeamID = h.TeamID
          LEFT JOIN Team a ON g.AwayTeamID = a.TeamID
          WHERE LOWER(h.Name) LIKE @pattern OR LOWER(a.Name) LIKE @pattern
          ORDER BY g.ScheduledStartAt DESC
          LIMIT ${safeLimit}`,
    params: { pattern },
    types: { pattern: { type: "string" } },
  });

  const [matchRows] = await db.run({
    sql: `SELECT
            gr.MatchID,
            MIN(gr.LeagueID) AS LeagueID,
            MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamName END) AS HomeTeam,
            MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamName END) AS AwayTeam
          FROM GameResult gr
          WHERE LOWER(gr.TeamName) LIKE @pattern OR LOWER(gr.OpponentName) LIKE @pattern
          GROUP BY gr.MatchID
          LIMIT ${safeLimit}`,
    params: { pattern },
    types: { pattern: { type: "string" } },
  });

  const byId = new Map<string, CanonicalSportsGameSearchResult>();

  for (const rowLike of gameRows) {
    const row = rowLike.toJSON() as Record<string, unknown>;
    const id = String(row.GameID || "").trim();
    if (!id) continue;
    const away = String(row.AwayTeam || "TBD");
    const home = String(row.HomeTeam || "TBD");

    byId.set(id, {
      id,
      label: `${away} @ ${home}`,
      leagueLabel: "MLB",
      status: normalizeMLBStatusCode(row.Status),
    });
  }

  for (const rowLike of matchRows) {
    const row = rowLike.toJSON() as Record<string, unknown>;
    const id = String(row.MatchID || "").trim();
    if (!id || byId.has(id)) continue;
    const away = String(row.AwayTeam || "TBD");
    const home = String(row.HomeTeam || "TBD");

    byId.set(id, {
      id,
      label: `${away} @ ${home}`,
      leagueLabel: toLeagueLabel(row.LeagueID),
      status: null,
    });
  }

  return Array.from(byId.values()).slice(0, safeLimit);
}

async function loadTeamTrendRows(
  db: ReturnType<typeof getDb>,
  teamNameRaw: string,
  limit: number,
): Promise<TeamTrendRow[]> {
  const normalizedTeam = teamNameRaw.trim().toLowerCase();
  if (!normalizedTeam) return [];

  const safeLimit = Math.max(1, Math.min(10, Math.trunc(limit)));

  const [rows] = await db.run({
    sql: `SELECT
            gr.MatchID,
            MIN(gr.StartTime) AS Kickoff,
            MIN(gr.GameDate) AS GameDate,
            MIN(gr.LeagueID) AS LeagueID,
            MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamName END) AS HomeTeam,
            MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamName END) AS AwayTeam,
            MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamScore END) AS HomeScore,
            MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamScore END) AS AwayScore
          FROM GameResult gr
          WHERE (LOWER(gr.TeamName) = @teamName OR LOWER(gr.OpponentName) = @teamName)
            AND gr.TeamScore IS NOT NULL
            AND (
              (gr.StartTime IS NOT NULL AND gr.StartTime <= CURRENT_TIMESTAMP())
              OR (gr.StartTime IS NULL AND gr.GameDate <= CURRENT_DATE())
            )
          GROUP BY gr.MatchID
          ORDER BY GameDate DESC, Kickoff DESC
          LIMIT ${safeLimit}`,
    params: { teamName: normalizedTeam },
    types: { teamName: { type: "string" } },
  });

  return rows
    .map((row: any) => {
      const doc = row.toJSON() as Record<string, unknown>;
      const homeTeam = String(doc.HomeTeam || "");
      const awayTeam = String(doc.AwayTeam || "");
      const isHome = homeTeam.trim().toLowerCase() === normalizedTeam;
      const isAway = awayTeam.trim().toLowerCase() === normalizedTeam;

      if (!isHome && !isAway) return null;

      const homeScore = toNumberOrNull(doc.HomeScore);
      const awayScore = toNumberOrNull(doc.AwayScore);
      const teamScore = isHome ? homeScore : awayScore;
      const opponentScore = isHome ? awayScore : homeScore;
      const opponent = isHome ? awayTeam || "TBD" : homeTeam || "TBD";
      const leagueLabel = toLeagueLabel(doc.LeagueID);

      if (isLikelyPlaceholderZeroZero(leagueLabel, teamScore, opponentScore)) {
        return null;
      }

      return {
        gameId: String(doc.MatchID || ""),
        kickoff: toIsoOrNull(doc.Kickoff),
        date: toDateOnly(doc.GameDate),
        leagueLabel,
        opponent,
        teamScore,
        opponentScore,
        result: computeResult(teamScore, opponentScore),
      } satisfies TeamTrendRow;
    })
    .filter((entry: TeamTrendRow | null): entry is TeamTrendRow => Boolean(entry && entry.gameId));
}

export async function loadGameTrendTables(
  game: CanonicalSportsGame,
  limit = 5,
): Promise<TeamTrendsForGame> {
  const db = getDb("sportsdb");

  const [home, away] = await Promise.all([
    loadTeamTrendRows(db, game.homeTeam, limit),
    loadTeamTrendRows(db, game.awayTeam, limit),
  ]);

  return { home, away };
}

export function withSportsGameUrls(game: CanonicalSportsGame) {
  return {
    ...game,
    ...buildUrls(game.id),
  };
}

import { getSportsDb } from "@/lib/spanner-pool";
import type { GovernedClaimIngestItem } from "@/lib/sports/claims-ledger";

const DEFAULT_SOURCE_POLICY_ID = "DRIP.RULE.SOURCE.BEAT_REPORT.TIER_1";
const DEFAULT_LOOKBACK_DAYS = 5;
const DEFAULT_LIMIT = 120;

function readString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const nested =
      record.value ??
      record.stringValue ??
      record.integerValue ??
      record.numberValue ??
      record.floatValue ??
      record.boolValue;
    if (nested !== undefined) return readString(nested);
  }
  return "";
}

function readNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function toLeagueToken(rawLeague: string): string {
  const normalized = rawLeague.trim().toUpperCase();
  if (normalized === "NFL") return "NFL";
  if (normalized === "NBA") return "NBA";
  if (normalized === "WNBA") return "WNBA";
  if (normalized === "NHL") return "NHL";
  if (normalized === "MLB") return "MLB";
  return normalized || "SPORTS";
}

function buildEspnGameUrl(leagueToken: string, sourceId: string): string {
  const cleanedSourceId = sourceId.replace(/[^0-9]/g, "");
  if (!cleanedSourceId) return "https://www.espn.com";

  const leagueSlugByToken: Record<string, string> = {
    NFL: "nfl",
    NBA: "nba",
    WNBA: "wnba",
    NHL: "nhl",
    MLB: "mlb",
  };

  const leagueSlug = leagueSlugByToken[leagueToken];
  if (!leagueSlug) return "https://www.espn.com";
  return `https://www.espn.com/${leagueSlug}/game/_/gameId/${cleanedSourceId}`;
}

type RawMarketRow = {
  match_id: string;
  league_id: string;
  source_id: string;
  start_time: string | null;
  home_team: string;
  away_team: string;
  home_spread: number | null;
  closing_total: number | null;
};

function rowToGovernedItem(row: RawMarketRow): GovernedClaimIngestItem | null {
  const matchId = row.match_id.trim();
  if (!matchId) return null;

  const hasSpread = row.home_spread != null;
  const hasTotal = row.closing_total != null;
  if (!hasSpread && !hasTotal) return null;

  const leagueToken = toLeagueToken(row.league_id);
  const sourceObservedAt = new Date().toISOString();
  const sourceUrl = buildEspnGameUrl(leagueToken, row.source_id);
  const spreadPart = hasSpread ? `Spread ${row.home_team} ${row.home_spread! > 0 ? "+" : ""}${row.home_spread}` : null;
  const totalPart = hasTotal ? `Total ${row.closing_total}` : null;
  const summaryParts = [spreadPart, totalPart].filter(Boolean);
  const publicDisplay = `${row.away_team} at ${row.home_team}: ${summaryParts.join(" | ")}`;

  return {
    source_policy_id: DEFAULT_SOURCE_POLICY_ID,
    extraction: {
      claim_key: `${leagueToken}:MATCH:${matchId}:MARKET_LINE`,
      league: leagueToken,
      entity_id: matchId,
      claim_type: "MARKET_LINE",
      source_url: sourceUrl,
      source_observed_at: sourceObservedAt,
      public_display: publicDisplay,
      statement: `Observed ${summaryParts.join(" | ")} for ${row.away_team} at ${row.home_team}`,
      structured_value: {
        match_id: matchId,
        league: leagueToken,
        source_id: row.source_id,
        start_time: row.start_time,
        away_team: row.away_team,
        home_team: row.home_team,
        home_spread: row.home_spread,
        closing_total: row.closing_total,
      },
    },
  };
}

export async function buildDefaultSportsClaimItems(
  options?: { lookbackDays?: number; limit?: number; leagueIds?: string[] },
): Promise<GovernedClaimIngestItem[]> {
  const lookbackDays = Math.max(1, Math.min(14, Math.trunc(options?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS)));
  const limit = Math.max(1, Math.min(500, Math.trunc(options?.limit ?? DEFAULT_LIMIT)));
  const leagues = (options?.leagueIds || ["nfl"]).map((league) => league.trim().toLowerCase()).filter(Boolean);
  const db = getSportsDb();

  const [rows] = await db.run({
    sql: `SELECT
            gr.MatchID AS match_id,
            MIN(gr.LeagueID) AS league_id,
            MIN(gr.SourceID) AS source_id,
            MIN(gr.StartTime) AS start_time,
            MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.TeamName END) AS home_team,
            MAX(CASE WHEN LOWER(gr.Side) = 'away' THEN gr.TeamName END) AS away_team,
            MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingSpread END) AS home_spread,
            MAX(CASE WHEN LOWER(gr.Side) = 'home' THEN gr.ClosingTotal END) AS closing_total
          FROM GameResult gr
          WHERE gr.StartTime >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @lookbackDays DAY)
            AND LOWER(gr.LeagueID) IN UNNEST(@leagueIds)
          GROUP BY gr.MatchID
          ORDER BY MIN(gr.StartTime) DESC
          LIMIT @limit`,
    params: {
      lookbackDays,
      leagueIds: leagues,
      limit,
    },
    types: {
      lookbackDays: { type: "int64" },
      leagueIds: { type: "array", child: { type: "string" } },
      limit: { type: "int64" },
    },
  });

  const items: GovernedClaimIngestItem[] = [];
  for (const rowLike of rows) {
    const rowJson = rowLike.toJSON() as Record<string, unknown>;
    const parsed: RawMarketRow = {
      match_id: readString(rowJson.match_id),
      league_id: readString(rowJson.league_id),
      source_id: readString(rowJson.source_id),
      start_time: toIso(rowJson.start_time),
      home_team: readString(rowJson.home_team),
      away_team: readString(rowJson.away_team),
      home_spread: readNumber(rowJson.home_spread),
      closing_total: readNumber(rowJson.closing_total),
    };
    const item = rowToGovernedItem(parsed);
    if (item) items.push(item);
  }

  return items;
}


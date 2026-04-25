import { getDb } from "@/lib/spanner-pool";
import { loadCanonicalSportsGame } from "@/lib/sports/game-canonical";
import { createHash } from "node:crypto";

export type MarketType = "SPREAD" | "TOTAL" | "MONEYLINE" | "PLAYER_PROP";
export type Side = "HOME" | "AWAY" | "OVER" | "UNDER";
export type PriorityBand = "FEATURED" | "STANDARD" | "WATCH";
export type EventStatus = "SCHEDULED" | "LIVE" | "FINAL" | "POSTPONED";
export type GradingStatus = "PENDING" | "WON" | "LOST" | "PUSH" | "VOID";
export type PickTier = "PUBLIC" | "PAID" | "INTERNAL";

export type PickLiveData = {
  current_score?: string | null;
  pace_summary?: string | null;
  progress?: string | null;
  [key: string]: unknown;
};

export type PickRow = {
  pick_id: string;
  brief_id: string | null;
  game_id: string;
  sport: string;
  market_type: string;
  subject_type: string | null;
  subject_name: string | null;
  subject_team: string | null;
  side: string;
  line: number;
  odds_american: number | null;
  stake_units: number | null;
  display: string;
  kicker: string | null;
  rationale: string | null;
  priority_band: string | null;
  event_status: string | null;
  grading_status: string | null;
  settlement_value: number | null;
  units_result: number | null;
  closing_line: number | null;
  live_data: PickLiveData | null;
  live_data_updated_at: string | null;
  public_payload: Record<string, unknown> | null;
  internal_payload: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
  line_observed_at: string | null;
  graded_at: string | null;
};

export type PickTrackRecord = {
  sample_size: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  units: number;
  record: string;
  matured: boolean;
};

export type DraftQueueStatus = "PENDING" | "COMMITTED" | "REJECTED";

export type DraftQueueItem = PickRow & {
  draft_status: DraftQueueStatus;
  draft_actor: string | null;
  draft_reason: string | null;
  draft_action_at: string | null;
};

export type DraftQueueSnapshot = {
  total: number;
  pending: number;
  committed: number;
  rejected: number;
  items: DraftQueueItem[];
};

export type DraftMutationAction = "commit" | "reject";

export type DraftMutationResult = {
  pick_id: string;
  event_type: "DRAFT_COMMITTED" | "DRAFT_REJECTED";
  previous_draft_status: DraftQueueStatus;
  new_draft_status: DraftQueueStatus;
  previous_event_status: string | null;
  new_event_status: string | null;
  actor: string;
  reason: string | null;
  event_id: string;
};

type PicksTableMeta = {
  tableName: string;
  columnsByLower: Map<string, string>;
};

type LiveTableMeta = {
  tableName: string;
  gameIdColumn: string;
  scoreColumn: string | null;
  paceColumn: string | null;
  progressColumn: string | null;
  payloadColumn: string | null;
  timestampColumn: string | null;
  freshnessColumn: string | null;
};

type GradeEventRow = {
  pick_id: string;
  event_id: string;
  event_type: string;
  previous_grading_status: string | null;
  new_grading_status: string;
  settlement_value: number | null;
  units_result: number | null;
  source_payload: Record<string, unknown> | null;
  actor: string | null;
  created_at: string | null;
};

const LIVE_TABLE_NAME_PRIORITY = [
  "livecontextsnapshots",
  "live_context_snapshots",
  "livecontextsnapshot",
  "live_context_snapshot",
];

let cachedPicksMeta: PicksTableMeta | null | undefined;
let cachedLiveMeta: LiveTableMeta | null | undefined;
let cachedPickGradeEventsTableName: string | null | undefined;

function readString(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function readNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readInt(value: unknown): number | null {
  const parsed = readNumber(value);
  return parsed == null ? null : Math.trunc(parsed);
}

function toIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function readJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function asUpperToken(value: string | null): string | null {
  const normalized = readString(value);
  return normalized ? normalized.toUpperCase() : null;
}

function payloadValue(payload: Record<string, unknown> | null, key: string): unknown {
  if (!payload || typeof payload !== "object") return null;
  return payload[key];
}

function payloadToken(payload: Record<string, unknown> | null, key: string): string | null {
  return asUpperToken(readString(payloadValue(payload, key)));
}

function toTimestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function deriveDraftStatus(pick: PickRow): DraftQueueStatus {
  const explicitStatus = payloadToken(pick.internal_payload, "draft_status");
  if (explicitStatus === "PENDING" || explicitStatus === "COMMITTED" || explicitStatus === "REJECTED") {
    return explicitStatus;
  }

  const eventStatus = asUpperToken(pick.event_status);
  if (eventStatus === "DRAFT") return "PENDING";
  return "COMMITTED";
}

function isDraftManagedPick(pick: PickRow): boolean {
  const explicitStatus = payloadToken(pick.internal_payload, "draft_status");
  if (explicitStatus === "PENDING" || explicitStatus === "COMMITTED" || explicitStatus === "REJECTED") {
    return true;
  }
  return asUpperToken(pick.event_status) === "DRAFT";
}

function toDraftQueueItem(pick: PickRow): DraftQueueItem {
  return {
    ...pick,
    draft_status: deriveDraftStatus(pick),
    draft_actor: readString(payloadValue(pick.internal_payload, "draft_action_by")),
    draft_reason: readString(payloadValue(pick.internal_payload, "draft_reason")),
    draft_action_at: toIso(payloadValue(pick.internal_payload, "draft_action_at")),
  };
}

function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replace(/`/g, "")}\``;
}

function selectColumn(meta: PicksTableMeta, candidates: string[]): string | null {
  for (const candidate of candidates) {
    const resolved = meta.columnsByLower.get(candidate.toLowerCase());
    if (resolved) return resolved;
  }
  return null;
}

function selectLiveColumn(columns: Map<string, string>, candidates: string[]): string | null {
  for (const candidate of candidates) {
    const resolved = columns.get(candidate.toLowerCase());
    if (resolved) return resolved;
  }
  return null;
}

function buildPickUrls(pickId: string, briefId: string | null) {
  const encodedPickId = encodeURIComponent(pickId);
  const encodedBriefId = briefId ? encodeURIComponent(briefId) : null;

  return {
    hub_url: `/api/hub/picks/${encodedPickId}`,
    api_url: `/api/sports/picks/${encodedPickId}`,
    public_url: encodedBriefId
      ? `/brief/${encodedBriefId}#pick-${encodedPickId}`
      : `/brief/picks/${encodedPickId}`,
  };
}

function formatUnitsLabel(result: number | null): string {
  if (result == null || !Number.isFinite(result)) return "0 units";
  const rounded = Math.round(result * 100) / 100;
  const serialized = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/\.?0+$/, "");
  const signed = `${rounded > 0 ? "+" : ""}${serialized}`;
  return `${signed} units`;
}

export function buildConsumerSettlementSummary(input: {
  display: string;
  market_type: string | null;
  grading_status: string | null;
  units_result: number | null;
}): string {
  const display = readString(input.display) || "Pick";
  const marketType = asUpperToken(input.market_type);
  const grading = asUpperToken(input.grading_status) || "PENDING";
  const units = formatUnitsLabel(input.units_result);

  if (grading === "PENDING") {
    return `${display} is pending.`;
  }

  if (grading === "WON") {
    if (marketType === "SPREAD") return `${display} covered. ${units}.`;
    if (marketType === "TOTAL") return `${display} hit. ${units}.`;
    if (marketType === "MONEYLINE") return `${display} won. ${units}.`;
    return `${display} won. ${units}.`;
  }

  if (grading === "LOST") {
    if (marketType === "SPREAD") return `${display} did not cover. ${units}.`;
    if (marketType === "TOTAL") return `${display} missed. ${units}.`;
    if (marketType === "MONEYLINE") return `${display} lost. ${units}.`;
    return `${display} lost. ${units}.`;
  }

  if (grading === "PUSH") {
    return `${display} pushed. 0 units.`;
  }

  if (grading === "VOID") {
    return `${display} void. No action.`;
  }

  return `${display} settled ${grading.toLowerCase()}. ${units}.`;
}

async function listTableColumns(): Promise<Map<string, Map<string, string>>> {
  const db = getDb("sportsdb");
  const [rows] = await db.run({
    sql: `SELECT TABLE_NAME, COLUMN_NAME
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = ''`,
  });

  const byTable = new Map<string, Map<string, string>>();

  for (const row of rows) {
    const data = row.toJSON() as Record<string, unknown>;
    const tableName = readString(data.TABLE_NAME);
    const columnName = readString(data.COLUMN_NAME);
    if (!tableName || !columnName) continue;

    const key = tableName.toLowerCase();
    if (!byTable.has(key)) {
      byTable.set(key, new Map());
      byTable.get(key)!.set("__table_name__", tableName);
    }
    byTable.get(key)!.set(columnName.toLowerCase(), columnName);
  }

  return byTable;
}

async function resolvePicksTableMeta(): Promise<PicksTableMeta | null> {
  if (cachedPicksMeta !== undefined) return cachedPicksMeta;

  const byTable = await listTableColumns();
  const picksColumns = byTable.get("picks");
  if (!picksColumns) {
    cachedPicksMeta = null;
    return null;
  }

  const tableName = picksColumns.get("__table_name__") || "Picks";
  picksColumns.delete("__table_name__");

  cachedPicksMeta = {
    tableName,
    columnsByLower: picksColumns,
  };

  return cachedPicksMeta;
}

async function resolvePickGradeEventsTableName(): Promise<string | null> {
  if (cachedPickGradeEventsTableName !== undefined) {
    return cachedPickGradeEventsTableName;
  }

  const db = getDb("sportsdb");
  const [rows] = await db.run({
    sql: `SELECT TABLE_NAME
          FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = ''`,
  });

  for (const row of rows) {
    const data = row.toJSON() as Record<string, unknown>;
    const tableName = readString(data.TABLE_NAME);
    if (!tableName) continue;
    if (tableName.toLowerCase() === "pickgradeevents") {
      cachedPickGradeEventsTableName = tableName;
      return tableName;
    }
  }

  cachedPickGradeEventsTableName = null;
  return null;
}

async function resolveLiveTableMeta(): Promise<LiveTableMeta | null> {
  if (cachedLiveMeta !== undefined) return cachedLiveMeta;

  const byTable = await listTableColumns();

  for (const nameLower of LIVE_TABLE_NAME_PRIORITY) {
    const columns = byTable.get(nameLower);
    if (!columns) continue;

    const tableName = columns.get("__table_name__") || nameLower;
    columns.delete("__table_name__");

    const gameIdColumn = selectLiveColumn(columns, ["game_id", "gameid", "match_id", "matchid"]);
    if (!gameIdColumn) continue;

    cachedLiveMeta = {
      tableName,
      gameIdColumn,
      scoreColumn: selectLiveColumn(columns, ["current_score", "currentscore", "score", "score_summary"]),
      paceColumn: selectLiveColumn(columns, ["pace_summary", "pacesummary", "pace"]),
      progressColumn: selectLiveColumn(columns, ["progress", "game_progress", "clock", "period"]),
      payloadColumn: selectLiveColumn(columns, ["live_data", "payload", "payload_json", "snapshot_json", "context_json"]),
      timestampColumn: selectLiveColumn(columns, ["captured_at", "snapshot_at", "created_at", "updated_at", "event_time"]),
      freshnessColumn: selectLiveColumn(columns, ["live_data_updated_at", "captured_at", "snapshot_at", "updated_at", "created_at", "event_time"]),
    };

    return cachedLiveMeta;
  }

  cachedLiveMeta = null;
  return null;
}

function isLiveStatus(eventStatus: string | null): boolean {
  const normalized = asUpperToken(eventStatus);
  return normalized === "LIVE" || normalized === "IN_PROGRESS" || normalized === "INPLAY";
}

function isFinalGameStatus(status: string | null): boolean {
  const normalized = String(status || "").trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === "final" ||
    normalized === "post" ||
    normalized === "ft" ||
    normalized.includes("final") ||
    normalized.includes("full time") ||
    normalized.includes("full_time") ||
    normalized.includes("ended") ||
    normalized.includes("completed")
  );
}

function mapPickRow(doc: Record<string, unknown>): PickRow {
  return {
    pick_id: readString(doc.pick_id) || "",
    brief_id: readString(doc.brief_id),
    game_id: readString(doc.game_id) || "",
    sport: readString(doc.sport) || "",
    market_type: asUpperToken(readString(doc.market_type)) || "",
    subject_type: asUpperToken(readString(doc.subject_type)),
    subject_name: readString(doc.subject_name),
    subject_team: asUpperToken(readString(doc.subject_team)),
    side: asUpperToken(readString(doc.side)) || "",
    line: readNumber(doc.line) || 0,
    odds_american: readInt(doc.odds_american),
    stake_units: readNumber(doc.stake_units),
    display: readString(doc.display) || "",
    kicker: readString(doc.kicker),
    rationale: readString(doc.rationale),
    priority_band: asUpperToken(readString(doc.priority_band)),
    event_status: asUpperToken(readString(doc.event_status)),
    grading_status: asUpperToken(readString(doc.grading_status)) || "PENDING",
    settlement_value: readNumber(doc.settlement_value),
    units_result: readNumber(doc.units_result),
    closing_line: readNumber(doc.closing_line),
    live_data: (readJsonObject(doc.live_data) as PickLiveData | null) || null,
    live_data_updated_at: toIso(doc.live_data_updated_at),
    public_payload: readJsonObject(doc.public_payload),
    internal_payload: readJsonObject(doc.internal_payload),
    created_at: toIso(doc.created_at),
    updated_at: toIso(doc.updated_at),
    line_observed_at: toIso(doc.line_observed_at),
    graded_at: toIso(doc.graded_at),
  };
}

function mergeLiveData(base: PickLiveData | null, update: PickLiveData | null): PickLiveData | null {
  if (!base && !update) return null;
  return {
    ...(base || {}),
    ...(update || {}),
  };
}

async function loadLiveContextByGameIds(gameIds: string[]): Promise<Map<string, PickLiveData>> {
  const uniqueIds = [...new Set(gameIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  const meta = await resolveLiveTableMeta();
  if (!meta) return new Map();

  const selectParts = [`${quoteIdentifier(meta.gameIdColumn)} AS game_id`];
  if (meta.scoreColumn) selectParts.push(`${quoteIdentifier(meta.scoreColumn)} AS current_score`);
  if (meta.paceColumn) selectParts.push(`${quoteIdentifier(meta.paceColumn)} AS pace_summary`);
  if (meta.progressColumn) selectParts.push(`${quoteIdentifier(meta.progressColumn)} AS progress`);
  if (meta.payloadColumn) selectParts.push(`${quoteIdentifier(meta.payloadColumn)} AS payload_json`);
  if (meta.timestampColumn) selectParts.push(`${quoteIdentifier(meta.timestampColumn)} AS snapshot_at`);
  if (meta.freshnessColumn) selectParts.push(`${quoteIdentifier(meta.freshnessColumn)} AS live_data_updated_at`);

  const orderClause = meta.timestampColumn
    ? `ORDER BY ${quoteIdentifier(meta.gameIdColumn)} ASC, ${quoteIdentifier(meta.timestampColumn)} DESC`
    : `ORDER BY ${quoteIdentifier(meta.gameIdColumn)} ASC`;

  const db = getDb("sportsdb");
  const [rows] = await db.run({
    sql: `SELECT ${selectParts.join(", ")}
          FROM ${quoteIdentifier(meta.tableName)}
          WHERE ${quoteIdentifier(meta.gameIdColumn)} IN UNNEST(@gameIds)
          ${orderClause}`,
    params: { gameIds: uniqueIds },
    types: {
      gameIds: { type: "array", child: { type: "string" } },
    },
  });

  const byGameId = new Map<string, PickLiveData>();

  for (const row of rows) {
    const data = row.toJSON() as Record<string, unknown>;
    const gameId = readString(data.game_id);
    if (!gameId || byGameId.has(gameId)) continue;

    const payload = readJsonObject(data.payload_json) || {};
    const liveData: PickLiveData = {
      ...payload,
      current_score: readString(data.current_score) || readString(payload.current_score) || null,
      pace_summary: readString(data.pace_summary) || readString(payload.pace_summary) || null,
      progress: readString(data.progress) || readString(payload.progress) || null,
    };
    const freshnessIso = toIso(data.live_data_updated_at || data.snapshot_at);
    if (freshnessIso) {
      liveData.live_data_updated_at = freshnessIso;
    }

    byGameId.set(gameId, liveData);
  }

  return byGameId;
}

function buildSelectSql(meta: PicksTableMeta): string {
  const pickId = selectColumn(meta, ["pick_id"]);
  const gameId = selectColumn(meta, ["game_id"]);
  const line = selectColumn(meta, ["line"]);
  const display = selectColumn(meta, ["display"]);

  if (!pickId || !gameId || !line || !display) {
    throw new Error("Picks table is missing required columns (pick_id, game_id, line, display).");
  }

  const select = [
    `${quoteIdentifier(pickId)} AS pick_id`,
    `${quoteIdentifier(selectColumn(meta, ["brief_id"]) || pickId)} AS brief_id`,
    `${quoteIdentifier(gameId)} AS game_id`,
    `${quoteIdentifier(selectColumn(meta, ["sport"]) || gameId)} AS sport`,
    `${quoteIdentifier(selectColumn(meta, ["market_type"]) || gameId)} AS market_type`,
    `${quoteIdentifier(selectColumn(meta, ["subject_type"]) || gameId)} AS subject_type`,
    `${quoteIdentifier(selectColumn(meta, ["subject_name"]) || gameId)} AS subject_name`,
    `${quoteIdentifier(selectColumn(meta, ["subject_team"]) || gameId)} AS subject_team`,
    `${quoteIdentifier(selectColumn(meta, ["side"]) || gameId)} AS side`,
    `${quoteIdentifier(line)} AS line`,
    `${quoteIdentifier(selectColumn(meta, ["odds_american"]) || line)} AS odds_american`,
    `${quoteIdentifier(selectColumn(meta, ["stake_units"]) || line)} AS stake_units`,
    `${quoteIdentifier(display)} AS display`,
    `${quoteIdentifier(selectColumn(meta, ["kicker"]) || display)} AS kicker`,
    `${quoteIdentifier(selectColumn(meta, ["rationale"]) || display)} AS rationale`,
    `${quoteIdentifier(selectColumn(meta, ["priority_band"]) || display)} AS priority_band`,
    `${quoteIdentifier(selectColumn(meta, ["event_status"]) || display)} AS event_status`,
    `${quoteIdentifier(selectColumn(meta, ["grading_status"]) || display)} AS grading_status`,
    `${quoteIdentifier(selectColumn(meta, ["settlement_value", "result_value"]) || line)} AS settlement_value`,
    `${quoteIdentifier(selectColumn(meta, ["units_result", "result_value"]) || line)} AS units_result`,
    `${quoteIdentifier(selectColumn(meta, ["closing_line"]) || line)} AS closing_line`,
    `${quoteIdentifier(selectColumn(meta, ["live_data"]) || display)} AS live_data`,
    `${quoteIdentifier(selectColumn(meta, ["live_data_updated_at", "updated_at", "line_observed_at", "created_at"]) || display)} AS live_data_updated_at`,
    `${quoteIdentifier(selectColumn(meta, ["public_payload"]) || display)} AS public_payload`,
    `${quoteIdentifier(selectColumn(meta, ["internal_payload"]) || display)} AS internal_payload`,
    `${quoteIdentifier(selectColumn(meta, ["created_at"]) || display)} AS created_at`,
    `${quoteIdentifier(selectColumn(meta, ["updated_at", "created_at"]) || display)} AS updated_at`,
    `${quoteIdentifier(selectColumn(meta, ["line_observed_at"]) || display)} AS line_observed_at`,
    `${quoteIdentifier(selectColumn(meta, ["graded_at"]) || display)} AS graded_at`,
  ];

  return select.join(",\n            ");
}

export async function listPicks(options: {
  briefId?: string | null;
  date?: string | null;
  limit?: number;
}): Promise<PickRow[]> {
  const meta = await resolvePicksTableMeta();
  if (!meta) return [];

  const selectSql = buildSelectSql(meta);
  const params: Record<string, unknown> = {};
  const types: Record<string, unknown> = {};
  const where: string[] = [];

  const briefIdColumn = selectColumn(meta, ["brief_id"]);
  const createdAtColumn = selectColumn(meta, ["created_at"]);
  const lineObservedAtColumn = selectColumn(meta, ["line_observed_at"]);

  const briefId = readString(options.briefId || null);
  if (briefId && briefIdColumn) {
    where.push(`p.${quoteIdentifier(briefIdColumn)} = @briefId`);
    params.briefId = briefId;
    types.briefId = { type: "string" };
  }

  const targetDate = readString(options.date || null);
  if (targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    if (lineObservedAtColumn && createdAtColumn) {
      where.push(`(DATE(p.${quoteIdentifier(lineObservedAtColumn)}) = @targetDate OR DATE(p.${quoteIdentifier(createdAtColumn)}) = @targetDate)`);
      params.targetDate = targetDate;
      types.targetDate = { type: "date" };
    } else if (createdAtColumn) {
      where.push(`DATE(p.${quoteIdentifier(createdAtColumn)}) = @targetDate`);
      params.targetDate = targetDate;
      types.targetDate = { type: "date" };
    }
  }

  const safeLimit = Math.max(1, Math.min(250, Math.trunc(options.limit || 60)));
  const sortColumn = lineObservedAtColumn || createdAtColumn || "pick_id";

  const db = getDb("sportsdb");
  const [rows] = await db.run({
    sql: `SELECT
            ${selectSql}
          FROM ${quoteIdentifier(meta.tableName)} p
          ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY p.${quoteIdentifier(sortColumn)} DESC
          LIMIT ${safeLimit}`,
    params,
    types,
  });

  const picks = rows
    .map((row: any) => mapPickRow(row.toJSON() as Record<string, unknown>))
    .filter((pick: PickRow) => pick.pick_id && pick.game_id);

  const liveGameIds = picks
    .filter((pick: PickRow) => isLiveStatus(pick.event_status))
    .map((pick: PickRow) => pick.game_id);

  if (liveGameIds.length === 0) return picks;

  const liveByGame = await loadLiveContextByGameIds(liveGameIds);

  return picks.map((pick: PickRow) => {
    const liveData = liveByGame.get(pick.game_id) || null;
    if (!liveData) return pick;
    const liveDataUpdatedAt = readString(liveData.live_data_updated_at) || pick.live_data_updated_at;
    return {
      ...pick,
      live_data: mergeLiveData(pick.live_data, liveData),
      live_data_updated_at: liveDataUpdatedAt,
    };
  });
}

export async function getPickById(pickIdRaw: string): Promise<PickRow | null> {
  const pickId = readString(pickIdRaw);
  if (!pickId) return null;

  const meta = await resolvePicksTableMeta();
  if (!meta) return null;

  const selectSql = buildSelectSql(meta);
  const pickIdColumn = selectColumn(meta, ["pick_id"]);
  if (!pickIdColumn) return null;

  const db = getDb("sportsdb");
  const [rows] = await db.run({
    sql: `SELECT
            ${selectSql}
          FROM ${quoteIdentifier(meta.tableName)} p
          WHERE p.${quoteIdentifier(pickIdColumn)} = @pickId
          LIMIT 1`,
    params: { pickId },
    types: { pickId: { type: "string" } },
  });

  if (rows.length === 0) return null;

  const pick = mapPickRow(rows[0].toJSON() as Record<string, unknown>);
  if (!isLiveStatus(pick.event_status)) return pick;

  const liveByGame = await loadLiveContextByGameIds([pick.game_id]);
  const liveData = liveByGame.get(pick.game_id) || null;
  if (!liveData) return pick;
  const liveDataUpdatedAt = readString(liveData.live_data_updated_at) || pick.live_data_updated_at;

  return {
    ...pick,
    live_data: mergeLiveData(pick.live_data, liveData),
    live_data_updated_at: liveDataUpdatedAt,
  };
}

export function resolvePick(pick: PickRow, tier: PickTier) {
  const isLive = isLiveStatus(pick.event_status);
  const liveUpdatedAt = pick.live_data_updated_at
    ? new Date(pick.live_data_updated_at).getTime()
    : Number.NaN;
  const isLiveStale = isLive
    ? !Number.isFinite(liveUpdatedAt) || Date.now() - liveUpdatedAt > 60_000
    : false;

  const publicFields: Record<string, unknown> = {
    id: pick.pick_id,
    brief_id: pick.brief_id,
    game_id: pick.game_id,
    sport: pick.sport,
    market_type: pick.market_type,
    side: pick.side,
    line: pick.line,
    display: pick.display,
    event_status: pick.event_status,
    grading_status: pick.grading_status,
    priority: pick.priority_band,
    kicker: pick.kicker,
    rationale: pick.rationale,
    live: isLive && !isLiveStale ? pick.live_data : null,
    is_live_stale: isLiveStale,
    ticker: `${pick.display} (${pick.odds_american ?? -110})`,
    ...buildPickUrls(pick.pick_id, pick.brief_id),
  };

  if (asUpperToken(pick.grading_status) !== "PENDING") {
    publicFields.result = pick.units_result;
    publicFields.settlement_value = pick.settlement_value;
  }

  if (tier === "PAID") {
    return {
      ...publicFields,
      sources: pick.internal_payload?.sanitized_sources ?? [],
      closing_line: pick.closing_line,
      line_observed_at: pick.line_observed_at,
    };
  }

  if (tier === "INTERNAL") {
    return {
      ...pick,
      ...buildPickUrls(pick.pick_id, pick.brief_id),
    };
  }

  return publicFields;
}

export async function listResolvedPicks(options: {
  briefId?: string | null;
  date?: string | null;
  limit?: number;
  tier?: PickTier;
}) {
  const tier = options.tier || "PUBLIC";
  const rows = await listPicks(options);
  return rows.map((pick) => resolvePick(pick, tier));
}

function normalizeDraftQueueStatus(value: string | null): DraftQueueStatus | "ALL" {
  const normalized = asUpperToken(value);
  if (normalized === "PENDING" || normalized === "COMMITTED" || normalized === "REJECTED") {
    return normalized;
  }
  return "ALL";
}

function normalizeDraftAction(value: string | null): DraftMutationAction | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "commit") return "commit";
  if (normalized === "reject") return "reject";
  return null;
}

function buildDraftEventId(pickId: string, action: DraftMutationAction, reason: string | null): string {
  const nonce = `${pickId}:${action}:${reason || ""}:${Date.now()}`;
  const hash = createHash("sha256").update(nonce).digest("hex").slice(0, 16);
  return `draft_${action}_${hash}`;
}

export async function listDraftQueue(options: {
  status?: DraftQueueStatus | "ALL" | null;
  limit?: number;
}): Promise<DraftQueueSnapshot> {
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(options.limit || 120)));
  const scanLimit = Math.max(safeLimit * 4, 160);
  const statusFilter = normalizeDraftQueueStatus(readString(options.status || null));

  const scanned = await listPicks({ limit: scanLimit });
  const managed = scanned
    .filter((pick) => isDraftManagedPick(pick))
    .map((pick) => toDraftQueueItem(pick))
    .sort((a, b) => {
      const aTs = Math.max(
        toTimestamp(a.draft_action_at),
        toTimestamp(a.updated_at),
        toTimestamp(a.created_at),
      );
      const bTs = Math.max(
        toTimestamp(b.draft_action_at),
        toTimestamp(b.updated_at),
        toTimestamp(b.created_at),
      );
      return bTs - aTs;
    });

  const snapshot: DraftQueueSnapshot = {
    total: managed.length,
    pending: managed.filter((pick) => pick.draft_status === "PENDING").length,
    committed: managed.filter((pick) => pick.draft_status === "COMMITTED").length,
    rejected: managed.filter((pick) => pick.draft_status === "REJECTED").length,
    items:
      statusFilter === "ALL"
        ? managed.slice(0, safeLimit)
        : managed.filter((pick) => pick.draft_status === statusFilter).slice(0, safeLimit),
  };

  return snapshot;
}

export async function transitionDraftPick(input: {
  pick_id: string;
  action: DraftMutationAction | string;
  actor: string;
  reason?: string | null;
}): Promise<{
  pick: PickRow;
  mutation: DraftMutationResult;
}> {
  const pickId = readString(input.pick_id);
  if (!pickId) {
    throw new Error("Pick ID is required.");
  }

  const action = normalizeDraftAction(readString(input.action));
  if (!action) {
    throw new Error("Unsupported draft action.");
  }

  const actor = readString(input.actor) || "ops_editor";
  const reason = readString(input.reason || null);

  const current = await getPickById(pickId);
  if (!current) {
    throw new Error(`Pick not found for ID ${pickId}.`);
  }

  const previousDraftStatus = deriveDraftStatus(current);
  const newDraftStatus: DraftQueueStatus = action === "commit" ? "COMMITTED" : "REJECTED";
  const previousEventStatus = asUpperToken(current.event_status);
  const newEventStatus =
    action === "commit"
      ? !previousEventStatus || previousEventStatus === "DRAFT"
        ? "SCHEDULED"
        : previousEventStatus
      : "DRAFT";
  const eventType = action === "commit" ? "DRAFT_COMMITTED" : "DRAFT_REJECTED";
  const eventId = buildDraftEventId(pickId, action, reason);

  const nextInternalPayload: Record<string, unknown> = {
    ...(current.internal_payload || {}),
    draft_status: newDraftStatus,
    draft_action_by: actor,
    draft_action_at: new Date().toISOString(),
    draft_reason: reason,
  };

  const meta = await resolvePicksTableMeta();
  if (!meta) {
    throw new Error("Picks table is not available.");
  }

  const pickIdColumn = selectColumn(meta, ["pick_id"]);
  const internalPayloadColumn = selectColumn(meta, ["internal_payload"]);
  const eventStatusColumn = selectColumn(meta, ["event_status"]);
  const updatedAtColumn = selectColumn(meta, ["updated_at"]);
  if (!pickIdColumn || !internalPayloadColumn) {
    throw new Error("Picks table is missing required draft columns.");
  }

  const setClauses = [`${quoteIdentifier(internalPayloadColumn)} = @internalPayload`];
  if (eventStatusColumn) {
    setClauses.push(`${quoteIdentifier(eventStatusColumn)} = @eventStatus`);
  }
  if (updatedAtColumn) {
    setClauses.push(`${quoteIdentifier(updatedAtColumn)} = PENDING_COMMIT_TIMESTAMP()`);
  }

  const eventsTableName = await resolvePickGradeEventsTableName();
  const db = getDb("sportsdb");

  await db.runTransactionAsync(async (tx: any) => {
    await tx.runUpdate({
      sql: `UPDATE ${quoteIdentifier(meta.tableName)}
            SET ${setClauses.join(", ")}
            WHERE ${quoteIdentifier(pickIdColumn)} = @pickId`,
      params: {
        pickId,
        internalPayload: nextInternalPayload,
        eventStatus: newEventStatus,
      },
      types: {
        pickId: { type: "string" },
        internalPayload: { type: "json" },
        eventStatus: { type: "string" },
      },
    });

    if (eventsTableName) {
      const sourcePayload = {
        reason,
        previous_draft_status: previousDraftStatus,
        new_draft_status: newDraftStatus,
        previous_event_status: previousEventStatus,
        new_event_status: newEventStatus,
      };

      await tx.runUpdate({
        sql: `INSERT OR UPDATE ${quoteIdentifier(eventsTableName)}
                (pick_id, event_id, event_type, previous_grading_status, new_grading_status, settlement_value, units_result, source_payload, actor, created_at)
              VALUES
                (@pickId, @eventId, @eventType, @previousStatus, @newStatus, @settlementValue, @unitsResult, @sourcePayload, @actor, PENDING_COMMIT_TIMESTAMP())`,
        params: {
          pickId,
          eventId,
          eventType,
          previousStatus: current.grading_status || "PENDING",
          newStatus: current.grading_status || "PENDING",
          settlementValue: current.settlement_value,
          unitsResult: current.units_result,
          sourcePayload,
          actor,
        },
        types: {
          pickId: { type: "string" },
          eventId: { type: "string" },
          eventType: { type: "string" },
          previousStatus: { type: "string" },
          newStatus: { type: "string" },
          settlementValue: { type: "float64" },
          unitsResult: { type: "float64" },
          sourcePayload: { type: "json" },
          actor: { type: "string" },
        },
      });
    }

    await tx.commit();
  });

  const updated = await getPickById(pickId);
  if (!updated) {
    throw new Error(`Updated pick ${pickId} could not be reloaded.`);
  }

  return {
    pick: updated,
    mutation: {
      pick_id: pickId,
      event_type: eventType,
      previous_draft_status: previousDraftStatus,
      new_draft_status: newDraftStatus,
      previous_event_status: previousEventStatus,
      new_event_status: newEventStatus,
      actor,
      reason,
      event_id: eventId,
    },
  };
}

export async function computeTrackRecord(days = 30): Promise<PickTrackRecord> {
  const meta = await resolvePicksTableMeta();
  if (!meta) {
    return {
      sample_size: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      voids: 0,
      units: 0,
      record: "0 to 0 to 0",
      matured: false,
    };
  }

  const gradingStatusColumn = selectColumn(meta, ["grading_status"]);
  const unitsColumn = selectColumn(meta, ["units_result", "result_value"]);
  const gradedAtColumn = selectColumn(meta, ["graded_at", "created_at"]);

  if (!gradingStatusColumn || !unitsColumn || !gradedAtColumn) {
    return {
      sample_size: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      voids: 0,
      units: 0,
      record: "0 to 0 to 0",
      matured: false,
    };
  }

  const safeDays = Math.max(1, Math.min(365, Math.trunc(days || 30)));
  const settledStatuses = ["WON", "LOST", "PUSH", "VOID"];
  const db = getDb("sportsdb");
  const [rows] = await db.run({
    sql: `SELECT
            SUM(CASE WHEN UPPER(COALESCE(p.${quoteIdentifier(gradingStatusColumn)}, '')) IN UNNEST(@settledStatuses) THEN 1 ELSE 0 END) AS graded,
            SUM(CASE WHEN UPPER(COALESCE(p.${quoteIdentifier(gradingStatusColumn)}, '')) = 'WON' THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN UPPER(COALESCE(p.${quoteIdentifier(gradingStatusColumn)}, '')) = 'LOST' THEN 1 ELSE 0 END) AS losses,
            SUM(CASE WHEN UPPER(COALESCE(p.${quoteIdentifier(gradingStatusColumn)}, '')) = 'PUSH' THEN 1 ELSE 0 END) AS pushes,
            SUM(CASE WHEN UPPER(COALESCE(p.${quoteIdentifier(gradingStatusColumn)}, '')) = 'VOID' THEN 1 ELSE 0 END) AS voids,
            SUM(CASE WHEN p.${quoteIdentifier(unitsColumn)} IS NULL THEN 0 ELSE p.${quoteIdentifier(unitsColumn)} END) AS units
          FROM ${quoteIdentifier(meta.tableName)} p
          WHERE DATE(p.${quoteIdentifier(gradedAtColumn)}) >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
            AND UPPER(COALESCE(p.${quoteIdentifier(gradingStatusColumn)}, '')) IN UNNEST(@settledStatuses)`,
    params: {
      days: safeDays,
      settledStatuses,
    },
    types: {
      days: { type: "int64" },
      settledStatuses: { type: "array", child: { type: "string" } },
    },
  });

  const snapshot = rows[0]?.toJSON() as Record<string, unknown> | undefined;
  const wins = readInt(snapshot?.wins) || 0;
  const losses = readInt(snapshot?.losses) || 0;
  const pushes = readInt(snapshot?.pushes) || 0;
  const sampleSize = readInt(snapshot?.graded) || 0;

  return {
    sample_size: sampleSize,
    wins,
    losses,
    pushes,
    voids: readInt(snapshot?.voids) || 0,
    units: readNumber(snapshot?.units) || 0,
    record: `${wins} to ${losses} to ${pushes}`,
    matured: sampleSize >= 50,
  };
}

function gradeAgainstMarket(pick: PickRow, score: { home: number; away: number }) {
  const marketType = asUpperToken(pick.market_type);
  const side = asUpperToken(pick.side);
  const line = pick.line;

  if (!marketType || !side) return null;

  const homeScore = score.home;
  const awayScore = score.away;
  const total = homeScore + awayScore;

  if (marketType === "TOTAL") {
    if (side === "OVER") {
      if (total > line) return { grading_status: "WON" as GradingStatus, settlement_value: total, units_result: Number((pick.stake_units || 1) * 0.91) };
      if (total < line) return { grading_status: "LOST" as GradingStatus, settlement_value: total, units_result: Number(-(pick.stake_units || 1)) };
      return { grading_status: "PUSH" as GradingStatus, settlement_value: total, units_result: 0 };
    }
    if (side === "UNDER") {
      if (total < line) return { grading_status: "WON" as GradingStatus, settlement_value: total, units_result: Number((pick.stake_units || 1) * 0.91) };
      if (total > line) return { grading_status: "LOST" as GradingStatus, settlement_value: total, units_result: Number(-(pick.stake_units || 1)) };
      return { grading_status: "PUSH" as GradingStatus, settlement_value: total, units_result: 0 };
    }
    return null;
  }

  if (marketType === "SPREAD") {
    if (side === "HOME") {
      const cover = homeScore + line - awayScore;
      if (cover > 0) return { grading_status: "WON" as GradingStatus, settlement_value: homeScore, units_result: Number((pick.stake_units || 1) * 0.91) };
      if (cover < 0) return { grading_status: "LOST" as GradingStatus, settlement_value: homeScore, units_result: Number(-(pick.stake_units || 1)) };
      return { grading_status: "PUSH" as GradingStatus, settlement_value: homeScore, units_result: 0 };
    }
    if (side === "AWAY") {
      const cover = awayScore + line - homeScore;
      if (cover > 0) return { grading_status: "WON" as GradingStatus, settlement_value: awayScore, units_result: Number((pick.stake_units || 1) * 0.91) };
      if (cover < 0) return { grading_status: "LOST" as GradingStatus, settlement_value: awayScore, units_result: Number(-(pick.stake_units || 1)) };
      return { grading_status: "PUSH" as GradingStatus, settlement_value: awayScore, units_result: 0 };
    }
    return null;
  }

  if (marketType === "MONEYLINE") {
    if (side === "HOME") {
      if (homeScore > awayScore) return { grading_status: "WON" as GradingStatus, settlement_value: homeScore, units_result: Number((pick.stake_units || 1) * 0.91) };
      if (homeScore < awayScore) return { grading_status: "LOST" as GradingStatus, settlement_value: homeScore, units_result: Number(-(pick.stake_units || 1)) };
      return { grading_status: "PUSH" as GradingStatus, settlement_value: homeScore, units_result: 0 };
    }
    if (side === "AWAY") {
      if (awayScore > homeScore) return { grading_status: "WON" as GradingStatus, settlement_value: awayScore, units_result: Number((pick.stake_units || 1) * 0.91) };
      if (awayScore < homeScore) return { grading_status: "LOST" as GradingStatus, settlement_value: awayScore, units_result: Number(-(pick.stake_units || 1)) };
      return { grading_status: "PUSH" as GradingStatus, settlement_value: awayScore, units_result: 0 };
    }
    return null;
  }

  return null;
}

function hashGradeEventId(pickId: string, settlement: number | null, gradingStatus: string): string {
  const base = `${pickId}:${String(settlement ?? "na")}:${gradingStatus}`;
  const hash = Buffer.from(base).toString("base64url").slice(0, 32);
  return `grade_${hash}`;
}

export async function runPickGradingSweep(limit = 200): Promise<{
  examined: number;
  graded: number;
  events_written: number;
  skipped: number;
}> {
  const meta = await resolvePicksTableMeta();
  if (!meta) {
    return { examined: 0, graded: 0, events_written: 0, skipped: 0 };
  }

  const eventsTableName = await resolvePickGradeEventsTableName();
  const picks = await listPicks({ limit });
  const pending = picks.filter((pick) => asUpperToken(pick.grading_status) === "PENDING");

  if (pending.length === 0) {
    return { examined: 0, graded: 0, events_written: 0, skipped: 0 };
  }

  const gameFinalStatus = new Map<string, boolean>();
  for (const gameId of [...new Set(pending.map((pick) => pick.game_id).filter(Boolean))]) {
    try {
      const canonical = await loadCanonicalSportsGame(gameId);
      gameFinalStatus.set(gameId, isFinalGameStatus(canonical?.status || null));
    } catch {
      gameFinalStatus.set(gameId, false);
    }
  }

  const db = getDb("sportsdb");
  const gameIds = [...new Set(pending.map((pick) => pick.game_id).filter(Boolean))];
  const [gameRows] = await db.run({
    sql: `SELECT MatchID,
                 MAX(CASE WHEN LOWER(Side) = 'home' THEN TeamScore END) AS HomeScore,
                 MAX(CASE WHEN LOWER(Side) = 'away' THEN TeamScore END) AS AwayScore
          FROM GameResult
          WHERE MatchID IN UNNEST(@matchIds)
          GROUP BY MatchID`,
    params: { matchIds: gameIds },
    types: {
      matchIds: { type: "array", child: { type: "string" } },
    },
  });

  const scoreByGame = new Map<string, { home: number; away: number }>();
  for (const row of gameRows) {
    const data = row.toJSON() as Record<string, unknown>;
    const matchId = readString(data.MatchID);
    const home = readNumber(data.HomeScore);
    const away = readNumber(data.AwayScore);
    if (!matchId || home == null || away == null) continue;
    scoreByGame.set(matchId, { home, away });
  }

  let examined = 0;
  let graded = 0;
  let eventsWritten = 0;

  await db.runTransactionAsync(async (tx: any) => {
    for (const pick of pending) {
      examined += 1;
      const score = scoreByGame.get(pick.game_id);
      if (!score) continue;
      if (!gameFinalStatus.get(pick.game_id)) continue;

      const grade = gradeAgainstMarket(pick, score);
      if (!grade) continue;

      const eventStatus = "FINAL";
      const eventId = hashGradeEventId(pick.pick_id, grade.settlement_value, grade.grading_status);

      await tx.runUpdate({
        sql: `UPDATE ${quoteIdentifier(meta.tableName)}
              SET grading_status = @gradingStatus,
                  event_status = @eventStatus,
                  settlement_value = @settlementValue,
                  units_result = @unitsResult,
                  graded_at = PENDING_COMMIT_TIMESTAMP(),
                  updated_at = PENDING_COMMIT_TIMESTAMP()
              WHERE pick_id = @pickId`,
        params: {
          gradingStatus: grade.grading_status,
          eventStatus,
          settlementValue: grade.settlement_value,
          unitsResult: grade.units_result,
          pickId: pick.pick_id,
        },
        types: {
          gradingStatus: { type: "string" },
          eventStatus: { type: "string" },
          settlementValue: { type: "float64" },
          unitsResult: { type: "float64" },
          pickId: { type: "string" },
        },
      });

      if (eventsTableName) {
        const sourcePayload = {
          game_id: pick.game_id,
          home_score: score.home,
          away_score: score.away,
          market_type: pick.market_type,
          side: pick.side,
          line: pick.line,
        };

        await tx.runUpdate({
          sql: `INSERT OR UPDATE ${quoteIdentifier(eventsTableName)}
                  (pick_id, event_id, event_type, previous_grading_status, new_grading_status, settlement_value, units_result, source_payload, actor, created_at)
                VALUES
                  (@pickId, @eventId, @eventType, @previousStatus, @newStatus, @settlementValue, @unitsResult, @sourcePayload, @actor, PENDING_COMMIT_TIMESTAMP())`,
          params: {
            pickId: pick.pick_id,
            eventId,
            eventType: "GRADED",
            previousStatus: pick.grading_status || "PENDING",
            newStatus: grade.grading_status,
            settlementValue: grade.settlement_value,
            unitsResult: grade.units_result,
            sourcePayload,
            actor: "system_grader",
          },
          types: {
            pickId: { type: "string" },
            eventId: { type: "string" },
            eventType: { type: "string" },
            previousStatus: { type: "string" },
            newStatus: { type: "string" },
            settlementValue: { type: "float64" },
            unitsResult: { type: "float64" },
            sourcePayload: { type: "json" },
            actor: { type: "string" },
          },
        });

        eventsWritten += 1;
      }

      graded += 1;
    }

    await tx.commit();
  });

  return {
    examined,
    graded,
    events_written: eventsWritten,
    skipped: Math.max(0, examined - graded),
  };
}

export async function listRecentGradeEvents(limit = 100): Promise<GradeEventRow[]> {
  const eventsTableName = await resolvePickGradeEventsTableName();
  if (!eventsTableName) return [];

  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit || 100)));
  const db = getDb("sportsdb");
  const [rows] = await db.run({
    sql: `SELECT pick_id,
                 event_id,
                 event_type,
                 previous_grading_status,
                 new_grading_status,
                 settlement_value,
                 units_result,
                 source_payload,
                 actor,
                 created_at
          FROM ${quoteIdentifier(eventsTableName)}
          ORDER BY created_at DESC
          LIMIT ${safeLimit}`,
  });

  return rows.map((row: any) => {
    const data = row.toJSON() as Record<string, unknown>;
    return {
      pick_id: readString(data.pick_id) || "",
      event_id: readString(data.event_id) || "",
      event_type: readString(data.event_type) || "",
      previous_grading_status: asUpperToken(readString(data.previous_grading_status)),
      new_grading_status: asUpperToken(readString(data.new_grading_status)) || "",
      settlement_value: readNumber(data.settlement_value),
      units_result: readNumber(data.units_result),
      source_payload: readJsonObject(data.source_payload),
      actor: readString(data.actor),
      created_at: toIso(data.created_at),
    };
  });
}

export function todayDateKey(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = `${now.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${now.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

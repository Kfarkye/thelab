import {
  isLivePayloadStale,
  normalizeMLBStatusCode,
  type CanonicalGameStatus,
} from "@/lib/sports/status";

type LiveSnapshotTableMeta = {
  tableName: string;
  gameIdColumn: string;
  leagueIdColumn: string | null;
  sportColumn: string | null;
  statusColumn: string | null;
  homeScoreColumn: string | null;
  awayScoreColumn: string | null;
  progressColumn: string | null;
  sourceColumn: string | null;
  providerGameIdColumn: string | null;
  providerMatchIdColumn: string | null;
  payloadColumn: string | null;
  lastSyncAtColumn: string | null;
  isLiveStaleColumn: string | null;
};

export type CanonicalGameLiveSnapshot = {
  gameId: string;
  leagueId: string | null;
  sport: string | null;
  status: CanonicalGameStatus;
  homeScore: number | null;
  awayScore: number | null;
  progress: string | null;
  source: string;
  providerGameId: string | null;
  providerMatchId: string | null;
  livePayload: Record<string, unknown> | null;
  lastSyncAt: string | null;
  isLiveStale: boolean;
};

export type CanonicalGameLiveSnapshotInput = {
  gameId: string;
  leagueId?: string | null;
  sport?: string | null;
  status: CanonicalGameStatus | string;
  homeScore?: number | null;
  awayScore?: number | null;
  progress?: string | null;
  source: string;
  providerGameId?: string | null;
  providerMatchId?: string | null;
  livePayload?: Record<string, unknown> | null;
  lastSyncAt?: string | null;
  isLiveStale: boolean;
};

export type UpsertLiveSnapshotResult = {
  table: string | null;
  written: number;
  skipped: boolean;
  errors: string[];
};

const LIVE_SNAPSHOT_TABLE_NAME_PRIORITY = [
  "gamelivesnapshot",
  "game_live_snapshot",
  "gamelivesnapshots",
  "game_live_snapshots",
  "livecontextsnapshots",
  "live_context_snapshots",
  "livecontextsnapshot",
  "live_context_snapshot",
];

let cachedLiveSnapshotTableMeta: LiveSnapshotTableMeta | null | undefined;

async function getSportsDb() {
  const { getDb } = await import("@/lib/spanner-pool");
  return getDb("sportsdb");
}

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

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const token = value.trim().toLowerCase();
    if (!token) return null;
    if (["1", "true", "yes", "y", "on"].includes(token)) return true;
    if (["0", "false", "no", "n", "off"].includes(token)) return false;
  }
  return null;
}

function toIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
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

function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replace(/`/g, "")}\``;
}

function selectColumn(columns: Map<string, string>, candidates: string[]): string | null {
  for (const candidate of candidates) {
    const resolved = columns.get(candidate.toLowerCase());
    if (resolved) return resolved;
  }
  return null;
}

async function listTableColumns(): Promise<Map<string, Map<string, string>>> {
  const db = await getSportsDb();
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

async function resolveLiveSnapshotTableMeta(): Promise<LiveSnapshotTableMeta | null> {
  if (cachedLiveSnapshotTableMeta !== undefined) return cachedLiveSnapshotTableMeta;

  const byTable = await listTableColumns();

  for (const tableNameLower of LIVE_SNAPSHOT_TABLE_NAME_PRIORITY) {
    const columns = byTable.get(tableNameLower);
    if (!columns) continue;

    const tableName = columns.get("__table_name__") || tableNameLower;
    columns.delete("__table_name__");

    const gameIdColumn = selectColumn(columns, ["game_id", "gameid", "canonical_game_id"]);
    if (!gameIdColumn) continue;

    cachedLiveSnapshotTableMeta = {
      tableName,
      gameIdColumn,
      leagueIdColumn: selectColumn(columns, ["league_id", "leagueid"]),
      sportColumn: selectColumn(columns, ["sport"]),
      statusColumn: selectColumn(columns, ["status", "game_status", "state"]),
      homeScoreColumn: selectColumn(columns, ["home_score", "homescore", "home_runs"]),
      awayScoreColumn: selectColumn(columns, ["away_score", "awayscore", "away_runs"]),
      progressColumn: selectColumn(columns, ["progress", "game_progress", "status_text", "clock"]),
      sourceColumn: selectColumn(columns, ["source", "source_name", "source_system"]),
      providerGameIdColumn: selectColumn(columns, [
        "provider_game_id",
        "providergameid",
        "mlb_game_pk",
        "game_pk",
      ]),
      providerMatchIdColumn: selectColumn(columns, [
        "provider_match_id",
        "providermatchid",
        "espn_match_id",
        "match_id",
        "matchid",
      ]),
      payloadColumn: selectColumn(columns, [
        "snapshot_json",
        "payload_json",
        "live_payload",
        "live_situation",
        "live_data",
        "context_json",
      ]),
      lastSyncAtColumn: selectColumn(columns, [
        "last_sync_at",
        "lastsyncat",
        "captured_at",
        "snapshot_at",
        "updated_at",
        "created_at",
      ]),
      isLiveStaleColumn: selectColumn(columns, ["is_live_stale", "islivestale", "stale"]),
    };

    return cachedLiveSnapshotTableMeta;
  }

  cachedLiveSnapshotTableMeta = null;
  return null;
}

function deriveProgress(payload: Record<string, unknown> | null, explicitProgress: string | null): string | null {
  if (explicitProgress) return explicitProgress;
  if (!payload) return null;

  const payloadProgress = readString(payload.progress)
    || readString(payload.game_progress)
    || readString(payload.status)
    || readString(payload.gameStatus)
    || readString(payload.game_status)
    || readString(payload.clock)
    || readString(payload.time_remaining)
    || readString(payload.timeRemaining);
  if (payloadProgress) return payloadProgress;

  const inning = readNumber(payload.inning);
  if (inning == null) return null;
  const halfRaw = readString(payload.half) || "";
  const half = halfRaw.toUpperCase() === "BOTTOM" ? "Bottom" : "Top";
  return `${half} ${inning}`;
}

function deriveStatus(
  explicitStatus: string | null,
  payload: Record<string, unknown> | null,
): CanonicalGameStatus {
  if (explicitStatus) return normalizeMLBStatusCode(explicitStatus);

  if (payload) {
    const payloadStatus = readString(payload.status)
      || readString(payload.state)
      || readString(payload.game_status)
      || readString(payload.gameStatus)
      || readString(payload.game_state)
      || readString(payload.gameState);
    if (payloadStatus) return normalizeMLBStatusCode(payloadStatus);
  }

  return "SCHEDULED";
}

function deriveScore(
  explicit: number | null,
  payload: Record<string, unknown> | null,
  keys: string[],
): number | null {
  if (explicit != null) return explicit;
  if (!payload) return null;

  for (const key of keys) {
    const parsed = readNumber(payload[key]);
    if (parsed != null) return parsed;
  }
  return null;
}

function mapSnapshotRow(row: Record<string, unknown>): CanonicalGameLiveSnapshot | null {
  const gameId = readString(row.game_id);
  if (!gameId) return null;

  const payload = readJsonObject(row.payload_json);
  const explicitStatus = readString(row.status_token);
  const status = deriveStatus(explicitStatus, payload);
  const lastSyncAt = toIso(row.last_sync_at)
    || (payload ? toIso(payload.last_updated) : null)
    || null;

  let isLiveStale = readBoolean(row.is_live_stale);
  if (isLiveStale == null) {
    if (payload) {
      isLiveStale = isLivePayloadStale(payload);
    } else {
      isLiveStale = status !== "LIVE";
    }
  }

  const progress = deriveProgress(payload, readString(row.progress_text));
  const homeScore = deriveScore(readNumber(row.home_score), payload, ["home_score", "homeScore", "home_runs"]);
  const awayScore = deriveScore(readNumber(row.away_score), payload, ["away_score", "awayScore", "away_runs"]);

  return {
    gameId,
    leagueId: readString(row.league_id),
    sport: readString(row.sport),
    status,
    homeScore,
    awayScore,
    progress,
    source: readString(row.source_name) || (payload ? readString(payload.source) : null) || "unknown",
    providerGameId: readString(row.provider_game_id) || (payload ? readString(payload.provider_game_id) : null),
    providerMatchId: readString(row.provider_match_id) || (payload ? readString(payload.provider_match_id) : null),
    livePayload: payload,
    lastSyncAt,
    isLiveStale,
  };
}

function buildCanonicalLivePayload(snapshot: CanonicalGameLiveSnapshot): Record<string, unknown> | null {
  const base = snapshot.livePayload ? { ...snapshot.livePayload } : {};

  if (snapshot.status === "LIVE" && snapshot.isLiveStale) {
    return null;
  }

  if (snapshot.status !== "LIVE") {
    return null;
  }

  if (!base.status) base.status = snapshot.status;
  if (!base.game_status) base.game_status = snapshot.status;
  if (snapshot.progress && !base.progress) base.progress = snapshot.progress;
  if (snapshot.lastSyncAt && !base.last_updated) base.last_updated = snapshot.lastSyncAt;

  if (snapshot.homeScore != null && base.home_score == null) {
    base.home_score = snapshot.homeScore;
  }
  if (snapshot.awayScore != null && base.away_score == null) {
    base.away_score = snapshot.awayScore;
  }

  return Object.keys(base).length > 0 ? base : null;
}

export function applyLiveSnapshotToGameRecord<T extends Record<string, unknown>>(
  record: T,
  snapshot: CanonicalGameLiveSnapshot | null | undefined,
): T {
  if (!snapshot) return record;

  const merged: Record<string, unknown> = {
    ...record,
    status: snapshot.status,
    is_live_stale: snapshot.isLiveStale,
    liveSource: snapshot.source,
    lastSyncAt: snapshot.lastSyncAt,
    providerGameId: snapshot.providerGameId,
    providerMatchId: snapshot.providerMatchId,
  };

  if (snapshot.homeScore != null) {
    merged["homeScore"] = snapshot.homeScore;
  }
  if (snapshot.awayScore != null) {
    merged["awayScore"] = snapshot.awayScore;
  }

  const canonicalLivePayload = buildCanonicalLivePayload(snapshot);
  merged["live"] = canonicalLivePayload;

  return merged as T;
}

export async function loadGameLiveSnapshotsByGameIds(
  gameIdsRaw: string[],
): Promise<Map<string, CanonicalGameLiveSnapshot>> {
  const gameIds = [
    ...new Set(gameIdsRaw.map((id) => String(id || "").trim()).filter(Boolean)),
  ];
  if (gameIds.length === 0) return new Map();

  const meta = await resolveLiveSnapshotTableMeta();
  if (!meta) return new Map();

  const selectParts = [`${quoteIdentifier(meta.gameIdColumn)} AS game_id`];
  if (meta.leagueIdColumn) selectParts.push(`${quoteIdentifier(meta.leagueIdColumn)} AS league_id`);
  if (meta.sportColumn) selectParts.push(`${quoteIdentifier(meta.sportColumn)} AS sport`);
  if (meta.statusColumn) selectParts.push(`${quoteIdentifier(meta.statusColumn)} AS status_token`);
  if (meta.homeScoreColumn) selectParts.push(`${quoteIdentifier(meta.homeScoreColumn)} AS home_score`);
  if (meta.awayScoreColumn) selectParts.push(`${quoteIdentifier(meta.awayScoreColumn)} AS away_score`);
  if (meta.progressColumn) selectParts.push(`${quoteIdentifier(meta.progressColumn)} AS progress_text`);
  if (meta.sourceColumn) selectParts.push(`${quoteIdentifier(meta.sourceColumn)} AS source_name`);
  if (meta.providerGameIdColumn) selectParts.push(`${quoteIdentifier(meta.providerGameIdColumn)} AS provider_game_id`);
  if (meta.providerMatchIdColumn) selectParts.push(`${quoteIdentifier(meta.providerMatchIdColumn)} AS provider_match_id`);
  if (meta.payloadColumn) selectParts.push(`${quoteIdentifier(meta.payloadColumn)} AS payload_json`);
  if (meta.lastSyncAtColumn) selectParts.push(`${quoteIdentifier(meta.lastSyncAtColumn)} AS last_sync_at`);
  if (meta.isLiveStaleColumn) selectParts.push(`${quoteIdentifier(meta.isLiveStaleColumn)} AS is_live_stale`);

  const orderClause = meta.lastSyncAtColumn
    ? `ORDER BY ${quoteIdentifier(meta.gameIdColumn)} ASC, ${quoteIdentifier(meta.lastSyncAtColumn)} DESC`
    : `ORDER BY ${quoteIdentifier(meta.gameIdColumn)} ASC`;

  const db = await getSportsDb();
  const [rows] = await db.run({
    sql: `SELECT ${selectParts.join(", ")}
          FROM ${quoteIdentifier(meta.tableName)}
          WHERE ${quoteIdentifier(meta.gameIdColumn)} IN UNNEST(@gameIds)
          ${orderClause}`,
    params: { gameIds },
    types: {
      gameIds: { type: "array", child: { type: "string" } },
    },
  });

  const byGameId = new Map<string, CanonicalGameLiveSnapshot>();
  for (const row of rows) {
    const data = row.toJSON() as Record<string, unknown>;
    const snapshot = mapSnapshotRow(data);
    if (!snapshot || byGameId.has(snapshot.gameId)) continue;
    byGameId.set(snapshot.gameId, snapshot);
  }

  return byGameId;
}

export async function loadGameLiveSnapshotByGameId(
  gameIdRaw: string,
): Promise<CanonicalGameLiveSnapshot | null> {
  const gameId = String(gameIdRaw || "").trim();
  if (!gameId) return null;

  const snapshots = await loadGameLiveSnapshotsByGameIds([gameId]);
  return snapshots.get(gameId) || null;
}

export async function upsertGameLiveSnapshots(
  entries: CanonicalGameLiveSnapshotInput[],
): Promise<UpsertLiveSnapshotResult> {
  const normalizedEntries = entries
    .map((entry) => {
      const gameId = String(entry.gameId || "").trim();
      if (!gameId) return null;
      const nowIso = new Date().toISOString();
      const normalizedStatus = normalizeMLBStatusCode(entry.status);
      const payload = entry.livePayload ? { ...entry.livePayload } : null;

      if (payload) {
        payload.status ??= normalizedStatus;
        payload.game_status ??= normalizedStatus;
        payload.progress ??= entry.progress ?? null;
        payload.last_updated ??= entry.lastSyncAt ?? nowIso;
        payload.provider_game_id ??= entry.providerGameId ?? null;
        payload.provider_match_id ??= entry.providerMatchId ?? null;
        if (entry.homeScore != null && payload.home_score == null) payload.home_score = entry.homeScore;
        if (entry.awayScore != null && payload.away_score == null) payload.away_score = entry.awayScore;
      }

      return {
        ...entry,
        gameId,
        status: normalizedStatus,
        livePayload: payload,
        lastSyncAt: entry.lastSyncAt || nowIso,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  if (normalizedEntries.length === 0) {
    return {
      table: null,
      written: 0,
      skipped: true,
      errors: ["No valid live snapshot entries to upsert."],
    };
  }

  const meta = await resolveLiveSnapshotTableMeta();
  if (!meta) {
    return {
      table: null,
      written: 0,
      skipped: true,
      errors: ["No live snapshot table found (expected GameLiveSnapshot or live_context_snapshots)."],
    };
  }

  const rows = normalizedEntries.map((entry) => {
    const row: Record<string, unknown> = {
      [meta.gameIdColumn]: entry.gameId,
    };

    if (meta.leagueIdColumn) row[meta.leagueIdColumn] = entry.leagueId ?? null;
    if (meta.sportColumn) row[meta.sportColumn] = entry.sport ?? null;
    if (meta.statusColumn) row[meta.statusColumn] = entry.status;
    if (meta.homeScoreColumn) row[meta.homeScoreColumn] = entry.homeScore ?? null;
    if (meta.awayScoreColumn) row[meta.awayScoreColumn] = entry.awayScore ?? null;
    if (meta.progressColumn) row[meta.progressColumn] = entry.progress ?? null;
    if (meta.sourceColumn) row[meta.sourceColumn] = entry.source;
    if (meta.providerGameIdColumn) row[meta.providerGameIdColumn] = entry.providerGameId ?? null;
    if (meta.providerMatchIdColumn) row[meta.providerMatchIdColumn] = entry.providerMatchId ?? null;
    if (meta.payloadColumn) row[meta.payloadColumn] = entry.livePayload ?? null;
    if (meta.lastSyncAtColumn) row[meta.lastSyncAtColumn] = entry.lastSyncAt ? new Date(entry.lastSyncAt).toISOString() : new Date().toISOString();
    if (meta.isLiveStaleColumn) row[meta.isLiveStaleColumn] = entry.isLiveStale;

    return row;
  });

  const db = await getSportsDb();
  const table = db.table(meta.tableName);
  const errors: string[] = [];
  let written = 0;

  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    try {
      await table.upsert(chunk);
      written += chunk.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Chunk ${i}-${i + chunk.length}: ${message.slice(0, 220)}`);
    }
  }

  return {
    table: meta.tableName,
    written,
    skipped: false,
    errors,
  };
}

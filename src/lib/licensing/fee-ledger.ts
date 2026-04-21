import { getLicensingDb } from "@/lib/spanner-pool";

const licensingDb = getLicensingDb();

export const FEE_TYPE_ENUM = [
  "application_fee",
  "license_fee",
  "background_check_fee",
  "fingerprint_fee",
  "verification_fee",
  "training_fee",
  "renewal_fee",
  "other",
] as const;

const FEE_TYPE_SET = new Set<string>(FEE_TYPE_ENUM);

const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
]);

const STATE_NAME_TO_CODE = new Map<string, string>([
  ["ALABAMA", "AL"], ["ALASKA", "AK"], ["ARIZONA", "AZ"], ["ARKANSAS", "AR"],
  ["CALIFORNIA", "CA"], ["COLORADO", "CO"], ["CONNECTICUT", "CT"], ["DELAWARE", "DE"],
  ["FLORIDA", "FL"], ["GEORGIA", "GA"], ["HAWAII", "HI"], ["IDAHO", "ID"],
  ["ILLINOIS", "IL"], ["INDIANA", "IN"], ["IOWA", "IA"], ["KANSAS", "KS"],
  ["KENTUCKY", "KY"], ["LOUISIANA", "LA"], ["MAINE", "ME"], ["MARYLAND", "MD"],
  ["MASSACHUSETTS", "MA"], ["MICHIGAN", "MI"], ["MINNESOTA", "MN"], ["MISSISSIPPI", "MS"],
  ["MISSOURI", "MO"], ["MONTANA", "MT"], ["NEBRASKA", "NE"], ["NEVADA", "NV"],
  ["NEW HAMPSHIRE", "NH"], ["NEW JERSEY", "NJ"], ["NEW MEXICO", "NM"], ["NEW YORK", "NY"],
  ["NORTH CAROLINA", "NC"], ["NORTH DAKOTA", "ND"], ["OHIO", "OH"], ["OKLAHOMA", "OK"],
  ["OREGON", "OR"], ["PENNSYLVANIA", "PA"], ["RHODE ISLAND", "RI"], ["SOUTH CAROLINA", "SC"],
  ["SOUTH DAKOTA", "SD"], ["TENNESSEE", "TN"], ["TEXAS", "TX"], ["UTAH", "UT"],
  ["VERMONT", "VT"], ["VIRGINIA", "VA"], ["WASHINGTON", "WA"], ["WEST VIRGINIA", "WV"],
  ["WISCONSIN", "WI"], ["WYOMING", "WY"], ["DISTRICT OF COLUMBIA", "DC"],
]);

export interface FeeCaptureRowInput {
  state?: string;
  profession?: string;
  fee_type?: string;
  amount_usd?: number | string;
  board_name?: string;
  source_status?: string;
  raw_text?: string;
  confidence?: number;
  position_index?: number;
}

export interface FeeCaptureIngestInput {
  view_type?: string;
  source_kind?: string;
  source_url?: string | null;
  screenshot_id?: string | null;
  captured_at?: string | null;
  rows: FeeCaptureRowInput[];
}

export interface FeeLedgerQueryInput {
  state?: string;
  profession?: string;
  fee_type?: string;
  event_id?: string;
  view_type?: string;
  source_kind?: string;
  source_url?: string;
  limit?: number;
  event_limit?: number;
}

interface FeeObjectRecord {
  object_id: string;
  namespace: string;
  object_type: string;
  state: string;
  profession: string;
  fee_type: string;
  amount_usd: string;
  board_name: string | null;
  source_status: string;
  current: boolean;
  effective_at: string;
  updated_at: string;
  created_at?: string;
}

interface FeeCaptureEventRecord {
  event_id: string;
  view_type: string;
  captured_at: string;
  source_kind: string;
  source_url: string | null;
  screenshot_id: string | null;
  rows_captured: number;
  created_at: string;
}

interface FeeCaptureLinkRecord {
  event_id: string;
  position_index: number;
  object_id: string;
  raw_text: string | null;
  confidence: number | null;
  source_row_json: string;
  captured_at: string;
  created_at: string;
}

interface NormalizedCaptureRow {
  objectId: string;
  state: string;
  profession: string;
  professionToken: string;
  feeType: string;
  amountUsd: number;
  boardName: string | null;
  sourceStatus: string;
  rawText: string | null;
  confidence: number | null;
  positionIndex: number;
  sourceRowJson: string;
}

function toSpannerNumeric(value: number | null | undefined): string | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) return null;
  return String(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = asRecord(value);
    if (record) {
      const nested =
        record.value ??
        record.stringValue ??
        record.integerValue ??
        record.numberValue;
      if (nested !== undefined) return readString(nested);
    }

    const asText = String(value).trim();
    if (asText && asText !== "[object Object]") return asText;
    return "";
  }

  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

function readNumber(value: unknown): number | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = asRecord(value);
    if (record) {
      const nested =
        record.value ??
        record.stringValue ??
        record.integerValue ??
        record.numberValue ??
        record.floatValue;
      if (nested !== undefined) return readNumber(nested);
    }

    const asText = String(value).trim();
    if (asText && asText !== "[object Object]") {
      const parsed = Number(asText.replace(/[$,\s]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,\s]/g, "").trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value || ""));
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return new Date().toISOString();
}

function formatNumericOutput(value: unknown): string {
  const parsed = readNumber(value);
  if (parsed == null) return "0";
  if (Number.isInteger(parsed)) return String(parsed);
  return String(parsed);
}

function normalizeStateCode(value: unknown): string {
  const raw = readString(value).toUpperCase();
  if (!raw) return "";
  if (US_STATE_CODES.has(raw)) return raw;
  return STATE_NAME_TO_CODE.get(raw) || "";
}

function normalizeProfessionLabel(value: unknown): string {
  const cleaned = readString(value).replace(/\s+/g, " ");
  return cleaned.toUpperCase();
}

function toObjectToken(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 64);
}

function normalizeFeeType(value: unknown): string {
  const raw = readString(value).toLowerCase().replace(/[\s-]+/g, "_");
  return FEE_TYPE_SET.has(raw) ? raw : "";
}

function buildObjectId(stateCode: string, professionToken: string, feeType: string): string {
  return `SLR.OBJ.FEE.${stateCode}.${professionToken}.${feeType.toUpperCase()}`;
}

function buildEventPrefix(capturedAt: Date): string {
  const date = capturedAt.toISOString().slice(0, 10).replace(/-/g, "");
  return `SLR.EVT.FEE_CAPTURE.${date}.`;
}

function normalizeRow(input: FeeCaptureRowInput, fallbackIndex: number): NormalizedCaptureRow {
  const rawState = input.state;
  const rawProfession = input.profession;
  const rawFeeType = input.fee_type;
  const rawAmount = input.amount_usd;

  const state = normalizeStateCode(rawState);
  if (!state) throw new Error("Invalid row: state must be a valid US state code or name");

  const profession = normalizeProfessionLabel(rawProfession);
  if (!profession) throw new Error("Invalid row: profession is required");

  const feeType = normalizeFeeType(rawFeeType);
  if (!feeType) {
    throw new Error(
      `Invalid row: fee_type must be one of ${FEE_TYPE_ENUM.join(", ")}`,
    );
  }

  const amountUsd = readNumber(rawAmount);
  if (amountUsd == null || amountUsd < 0) {
    throw new Error("Invalid row: amount_usd must be a non-negative number");
  }

  const professionToken = toObjectToken(profession);
  if (!professionToken) throw new Error("Invalid row: profession token could not be derived");

  const objectId = buildObjectId(state, professionToken, feeType);
  const sourceStatus = readString(input.source_status) || "captured_from_view";
  const confidenceRaw = readNumber(input.confidence);
  const confidence = confidenceRaw == null ? null : Math.max(0, Math.min(1, confidenceRaw));
  const positionRaw = readNumber(input.position_index);
  const positionIndex = positionRaw == null || positionRaw <= 0 ? fallbackIndex : Math.floor(positionRaw);

  return {
    objectId,
    state,
    profession,
    professionToken,
    feeType,
    amountUsd,
    boardName: readString(input.board_name) || null,
    sourceStatus,
    rawText: readString(input.raw_text) || null,
    confidence,
    positionIndex,
    sourceRowJson: JSON.stringify(input),
  };
}

function toFeeObjectRecord(row: Record<string, unknown>): FeeObjectRecord {
  return {
    object_id: String(row.object_id || ""),
    namespace: String(row.namespace || "SLR"),
    object_type: String(row.object_type || "FEE"),
    state: String(row.state || ""),
    profession: String(row.profession || ""),
    fee_type: String(row.fee_type || ""),
    amount_usd: formatNumericOutput(row.amount_usd),
    board_name: row.board_name ? String(row.board_name) : null,
    source_status: String(row.source_status || "captured_from_view"),
    current: Boolean(row.current ?? row.current_flag ?? false),
    effective_at: toIso(row.effective_at),
    updated_at: toIso(row.updated_at),
    created_at: row.created_at ? toIso(row.created_at) : undefined,
  };
}

function toFeeCaptureEventRecord(row: Record<string, unknown>): FeeCaptureEventRecord {
  return {
    event_id: String(row.event_id || ""),
    view_type: String(row.view_type || "fee_list"),
    captured_at: toIso(row.captured_at),
    source_kind: String(row.source_kind || "browser_agent"),
    source_url: row.source_url ? String(row.source_url) : null,
    screenshot_id: row.screenshot_id ? String(row.screenshot_id) : null,
    rows_captured: Number(row.rows_captured || 0),
    created_at: toIso(row.created_at),
  };
}

function toFeeCaptureLinkRecord(row: Record<string, unknown>): FeeCaptureLinkRecord {
  return {
    event_id: String(row.event_id || ""),
    position_index: Number(row.position_index || 0),
    object_id: String(row.object_id || ""),
    raw_text: row.raw_text ? String(row.raw_text) : null,
    confidence: row.confidence == null ? null : Number(row.confidence),
    source_row_json: String(row.source_row_json || "{}"),
    captured_at: toIso(row.captured_at),
    created_at: toIso(row.created_at),
  };
}

export async function ingestFeeLedgerCapture(input: FeeCaptureIngestInput) {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (rows.length === 0) {
    throw new Error("rows is required and must include at least one row");
  }

  const capturedAtDate = new Date(readString(input.captured_at) || Date.now());
  if (Number.isNaN(capturedAtDate.getTime())) {
    throw new Error("captured_at must be a valid date string");
  }

  const viewType = readString(input.view_type) || "fee_list";
  const sourceKind = readString(input.source_kind) || "browser_agent";
  const sourceUrl = readString(input.source_url) || null;
  const screenshotId = readString(input.screenshot_id) || null;

  const normalizedRows = rows.map((row, index) => normalizeRow(row, index + 1));

  const resultSummary = await licensingDb.runTransactionAsync(async (tx: any) => {
    const eventPrefix = buildEventPrefix(capturedAtDate);
    const [seqRows] = await tx.run({
      sql: `SELECT COUNT(*) AS c
            FROM fee_capture_events
            WHERE STARTS_WITH(event_id, @eventPrefix)`,
      params: { eventPrefix },
      types: { eventPrefix: { type: "string" } },
    });

    const seqData = seqRows[0]?.toJSON() as Record<string, unknown> | undefined;
    const seq = Number(seqData?.c || 0) + 1;
    const eventId = `${eventPrefix}${String(seq).padStart(3, "0")}`;

    await tx.runUpdate({
      sql: `INSERT INTO fee_capture_events (
              event_id, view_type, captured_at, source_kind, source_url, screenshot_id, rows_captured, created_at
            ) VALUES (
              @eventId, @viewType, @capturedAt, @sourceKind, @sourceUrl, @screenshotId, @rowsCaptured, PENDING_COMMIT_TIMESTAMP()
            )`,
      params: {
        eventId,
        viewType,
        capturedAt: capturedAtDate,
        sourceKind,
        sourceUrl,
        screenshotId,
        rowsCaptured: normalizedRows.length,
      },
      types: {
        eventId: { type: "string" },
        viewType: { type: "string" },
        capturedAt: { type: "timestamp" },
        sourceKind: { type: "string" },
        sourceUrl: { type: "string" },
        screenshotId: { type: "string" },
        rowsCaptured: { type: "int64" },
      },
    });

    let objectsTouched = 0;
    let objectsChanged = 0;

    for (const row of normalizedRows) {
      const [existingRows] = await tx.run({
        sql: `SELECT amount_usd, board_name, source_status
              FROM fee_objects
              WHERE object_id = @objectId
              LIMIT 1`,
        params: { objectId: row.objectId },
        types: { objectId: { type: "string" } },
      });

      const existing = existingRows[0]?.toJSON() as Record<string, unknown> | undefined;
      const oldAmount = existing ? readNumber(existing.amount_usd) : null;
      const oldBoard = existing ? (readString(existing.board_name) || null) : null;
      const oldSourceStatus = existing ? (readString(existing.source_status) || null) : null;

      const changed =
        !existing ||
        oldAmount !== row.amountUsd ||
        oldBoard !== row.boardName ||
        oldSourceStatus !== row.sourceStatus;

      if (!existing) {
        await tx.runUpdate({
        sql: `INSERT INTO fee_objects (
                  object_id, namespace, object_type, state, profession, fee_type,
                  amount_usd, board_name, source_status, current_flag, effective_at, updated_at, created_at
                ) VALUES (
                  @objectId, 'SLR', 'FEE', @state, @profession, @feeType,
                  @amountUsd, @boardName, @sourceStatus, TRUE, @effectiveAt, PENDING_COMMIT_TIMESTAMP(), PENDING_COMMIT_TIMESTAMP()
                )`,
          params: {
            objectId: row.objectId,
            state: row.state,
            profession: row.profession,
            feeType: row.feeType,
            amountUsd: toSpannerNumeric(row.amountUsd),
            boardName: row.boardName,
            sourceStatus: row.sourceStatus,
            effectiveAt: capturedAtDate,
          },
          types: {
            objectId: { type: "string" },
            state: { type: "string" },
            profession: { type: "string" },
            feeType: { type: "string" },
            amountUsd: { type: "numeric" },
            boardName: { type: "string" },
            sourceStatus: { type: "string" },
            effectiveAt: { type: "timestamp" },
          },
        });
        objectsTouched += 1;
        objectsChanged += 1;
      } else if (changed) {
        await tx.runUpdate({
          sql: `UPDATE fee_objects
                SET amount_usd = @amountUsd,
                    board_name = @boardName,
                    source_status = @sourceStatus,
                    current_flag = TRUE,
                    effective_at = @effectiveAt,
                    updated_at = PENDING_COMMIT_TIMESTAMP()
                WHERE object_id = @objectId`,
          params: {
            objectId: row.objectId,
            amountUsd: toSpannerNumeric(row.amountUsd),
            boardName: row.boardName,
            sourceStatus: row.sourceStatus,
            effectiveAt: capturedAtDate,
          },
          types: {
            objectId: { type: "string" },
            amountUsd: { type: "numeric" },
            boardName: { type: "string" },
            sourceStatus: { type: "string" },
            effectiveAt: { type: "timestamp" },
          },
        });
        objectsTouched += 1;
        objectsChanged += 1;
      }

      await tx.runUpdate({
        sql: `INSERT OR UPDATE INTO fee_capture_links (
                event_id, position_index, object_id, raw_text, confidence, source_row_json, captured_at, created_at
              ) VALUES (
                @eventId, @positionIndex, @objectId, @rawText, @confidence, @sourceRowJson, @capturedAt, PENDING_COMMIT_TIMESTAMP()
              )`,
        params: {
          eventId,
          positionIndex: row.positionIndex,
          objectId: row.objectId,
          rawText: row.rawText,
          confidence: toSpannerNumeric(row.confidence),
          sourceRowJson: row.sourceRowJson,
          capturedAt: capturedAtDate,
        },
        types: {
          eventId: { type: "string" },
          positionIndex: { type: "int64" },
          objectId: { type: "string" },
          rawText: { type: "string" },
          confidence: { type: "numeric" },
          sourceRowJson: { type: "string" },
          capturedAt: { type: "timestamp" },
        },
      });
    }

    await tx.commit();

    return {
      eventId,
      rowsCaptured: normalizedRows.length,
      objectsTouched,
      objectsChanged,
      linksInserted: normalizedRows.length,
    };
  });

  return {
    event_id: resultSummary.eventId,
    object_id_format: "SLR.OBJ.FEE.<STATE>.<PROFESSION>.<FEE_TYPE>",
    event_id_format: "SLR.EVT.FEE_CAPTURE.<YYYYMMDD>.<SEQ>",
    rows_captured: resultSummary.rowsCaptured,
    objects_touched: resultSummary.objectsTouched,
    objects_changed: resultSummary.objectsChanged,
    links_inserted: resultSummary.linksInserted,
    captured_at: capturedAtDate.toISOString(),
    fee_type_enum: [...FEE_TYPE_ENUM],
  };
}

function normalizeLimit(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export async function queryFeeLedger(input: FeeLedgerQueryInput) {
  const stateFilter = normalizeStateCode(input.state);
  const professionFilter = normalizeProfessionLabel(input.profession);
  const feeTypeFilter = input.fee_type ? normalizeFeeType(input.fee_type) : "";
  const eventId = readString(input.event_id);
  const viewType = readString(input.view_type);
  const sourceKind = readString(input.source_kind);
  const sourceUrl = readString(input.source_url);
  const limit = normalizeLimit(input.limit, 100, 1, 1000);
  const eventLimit = normalizeLimit(input.event_limit, 50, 1, 500);

  if (input.fee_type && !feeTypeFilter) {
    throw new Error(`fee_type must be one of ${FEE_TYPE_ENUM.join(", ")}`);
  }

  const response: {
    filters: Record<string, unknown>;
    objects: FeeObjectRecord[];
    events: FeeCaptureEventRecord[];
    links: FeeCaptureLinkRecord[];
  } = {
    filters: {
      state: stateFilter || null,
      profession: professionFilter || null,
      fee_type: feeTypeFilter || null,
      event_id: eventId || null,
      view_type: viewType || null,
      source_kind: sourceKind || null,
      source_url: sourceUrl || null,
      limit,
      event_limit: eventLimit,
    },
    objects: [],
    events: [],
    links: [],
  };

  if (eventId) {
    const [eventRows] = await licensingDb.run({
      sql: `SELECT event_id, view_type, captured_at, source_kind, source_url, screenshot_id, rows_captured, created_at
            FROM fee_capture_events
            WHERE event_id = @eventId
            LIMIT 1`,
      params: { eventId },
      types: { eventId: { type: "string" } },
    });
    response.events = eventRows.map((row: any) => toFeeCaptureEventRecord(asRecord(row.toJSON()) || {}));

    const [linkRows] = await licensingDb.run({
      sql: `SELECT event_id, position_index, object_id, raw_text, confidence, source_row_json, captured_at, created_at
            FROM fee_capture_links
            WHERE event_id = @eventId
            ORDER BY position_index
            LIMIT @lim`,
      params: { eventId, lim: limit },
      types: {
        eventId: { type: "string" },
        lim: { type: "int64" },
      },
    });
    response.links = linkRows.map((row: any) => toFeeCaptureLinkRecord(asRecord(row.toJSON()) || {}));

    if (response.links.length > 0) {
      const objectIds = response.links.map((link) => link.object_id);
      const [objectRows] = await licensingDb.run({
        sql: `SELECT object_id, namespace, object_type, state, profession, fee_type, amount_usd,
                     board_name, source_status, current_flag, effective_at, updated_at, created_at
              FROM fee_objects
              WHERE object_id IN UNNEST(@objectIds)
              LIMIT @lim`,
        params: { objectIds, lim: limit },
        types: {
          objectIds: { type: "array", child: { type: "string" } },
          lim: { type: "int64" },
        },
      });
      response.objects = objectRows.map((row: any) => toFeeObjectRecord(asRecord(row.toJSON()) || {}));
    }

    return response;
  }

  const eventWhere: string[] = [];
  const eventParams: Record<string, unknown> = { lim: eventLimit };
  const eventTypes: Record<string, unknown> = { lim: { type: "int64" } };

  if (viewType) {
    eventWhere.push("view_type = @viewType");
    eventParams.viewType = viewType;
    eventTypes.viewType = { type: "string" };
  }
  if (sourceKind) {
    eventWhere.push("source_kind = @sourceKind");
    eventParams.sourceKind = sourceKind;
    eventTypes.sourceKind = { type: "string" };
  }
  if (sourceUrl) {
    eventWhere.push("source_url = @sourceUrl");
    eventParams.sourceUrl = sourceUrl;
    eventTypes.sourceUrl = { type: "string" };
  }

  const eventSql = `SELECT event_id, view_type, captured_at, source_kind, source_url, screenshot_id, rows_captured, created_at
                    FROM fee_capture_events
                    ${eventWhere.length ? `WHERE ${eventWhere.join(" AND ")}` : ""}
                    ORDER BY captured_at DESC
                    LIMIT @lim`;
  const [eventRows] = await licensingDb.run({ sql: eventSql, params: eventParams, types: eventTypes });
  response.events = eventRows.map((row: any) => toFeeCaptureEventRecord(asRecord(row.toJSON()) || {}));

  const objectWhere: string[] = ["current_flag = TRUE"];
  const objectParams: Record<string, unknown> = { lim: limit };
  const objectTypes: Record<string, unknown> = { lim: { type: "int64" } };

  if (stateFilter) {
    objectWhere.push("state = @state");
    objectParams.state = stateFilter;
    objectTypes.state = { type: "string" };
  }
  if (professionFilter) {
    objectWhere.push("profession = @profession");
    objectParams.profession = professionFilter;
    objectTypes.profession = { type: "string" };
  }
  if (feeTypeFilter) {
    objectWhere.push("fee_type = @feeType");
    objectParams.feeType = feeTypeFilter;
    objectTypes.feeType = { type: "string" };
  }

  const applySourceFilter = viewType || sourceKind || sourceUrl;
  const objectSql = applySourceFilter
    ? `SELECT DISTINCT o.object_id, o.namespace, o.object_type, o.state, o.profession, o.fee_type, o.amount_usd,
              o.board_name, o.source_status, o.current_flag, o.effective_at, o.updated_at, o.created_at
       FROM fee_capture_events e
       JOIN fee_capture_links l ON l.event_id = e.event_id
       JOIN fee_objects o ON o.object_id = l.object_id
       WHERE ${[
         ...eventWhere.map((clause) => `e.${clause}`),
         ...objectWhere.map((clause) => `o.${clause}`),
       ].join(" AND ")}
       ORDER BY o.state, o.profession, o.fee_type
       LIMIT @lim`
    : `SELECT object_id, namespace, object_type, state, profession, fee_type, amount_usd,
              board_name, source_status, current_flag, effective_at, updated_at, created_at
       FROM fee_objects
       WHERE ${objectWhere.join(" AND ")}
       ORDER BY state, profession, fee_type
       LIMIT @lim`;

  const sourceMergedParams = applySourceFilter
    ? { ...eventParams, ...objectParams }
    : objectParams;
  const sourceMergedTypes = applySourceFilter
    ? { ...eventTypes, ...objectTypes }
    : objectTypes;

  const [objectRows] = await licensingDb.run({
    sql: objectSql,
    params: sourceMergedParams,
    types: sourceMergedTypes,
  });
  response.objects = objectRows.map((row: any) => toFeeObjectRecord(asRecord(row.toJSON()) || {}));

  return response;
}

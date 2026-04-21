import { getLicensingDb } from "@/lib/spanner-pool";

const licensingDb = getLicensingDb();

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

const FACT_KEYS = [
  "application_fee_usd",
  "background_check_fee_usd",
  "verification_required",
  "verification_fee_note",
  "fingerprint_mode",
  "estimated_processing_time_text",
  "estimated_processing_time_days_min",
  "estimated_processing_time_days_max",
  "temporary_license_available",
  "license_in_hand_required",
  "board_name",
  "portal_url",
  "last_source_verified_at",
] as const;

type NormalizedFacts = {
  application_fee_usd: number | null;
  background_check_fee_usd: number | null;
  verification_required: boolean | null;
  verification_fee_note: string | null;
  fingerprint_mode: string | null;
  estimated_processing_time_text: string | null;
  estimated_processing_time_days_min: number | null;
  estimated_processing_time_days_max: number | null;
  temporary_license_available: boolean | null;
  license_in_hand_required: boolean | null;
  board_name: string | null;
  portal_url: string | null;
  last_source_verified_at: string | null;
};

interface SourceRefInput {
  title?: string | null;
  uri?: string | null;
  ref_id?: string | null;
  [key: string]: unknown;
}

export interface HealthcareResearchApprovalInput {
  state?: string | null;
  profession?: string | null;
  category?: string | null;
  answer_text?: string | null;
  search_queries?: string[] | null;
  source_refs?: SourceRefInput[] | null;
  approval_note?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  raw_answer_json?: Record<string, unknown> | null;
}

export interface HealthcareResearchApprovalResult {
  object_id: string;
  snapshot_id: string;
  diff_id: string;
  category: string;
  state: string;
  profession: string;
  approved_at: string;
  approved_by: string;
  is_first_version: boolean;
  has_material_change: boolean;
  changed_field_count: number;
  changed_fields: Record<string, { from: unknown; to: unknown }>;
  changed_field_names: string[];
  change_summary: string;
  normalized_facts: NormalizedFacts;
}

type TxLike = {
  run: (...args: unknown[]) => Promise<unknown>;
  runUpdate: (...args: unknown[]) => Promise<unknown>;
  commit: () => Promise<unknown>;
};

type RowLike = {
  toJSON: () => Record<string, unknown>;
};

type SqlQuery = {
  sql: string;
  params?: Record<string, unknown>;
  types?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readRows(result: unknown): RowLike[] {
  if (!Array.isArray(result) || result.length === 0) return [];
  const first = result[0];
  if (!Array.isArray(first)) return [];
  return first.filter(
    (row): row is RowLike =>
      Boolean(row) && typeof row === "object" && typeof (row as RowLike).toJSON === "function",
  );
}

async function runRows(tx: TxLike, query: SqlQuery): Promise<RowLike[]> {
  const result = await tx.run(query);
  return readRows(result);
}

function readString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = asRecord(value);
    if (record) {
      const nested =
        record.value ??
        record.stringValue ??
        record.integerValue ??
        record.numberValue ??
        record.floatValue ??
        record.boolValue;
      if (nested !== undefined) return readString(nested);
    }
  }
  return "";
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = readString(value).replace(/[$,\s]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(readString(value) || Date.now());
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  const raw = readString(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function toObjectToken(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 64);
}

function normalizeStateCode(value: unknown): string {
  const raw = readString(value).toUpperCase();
  if (!raw) return "";
  if (US_STATE_CODES.has(raw)) return raw;
  return STATE_NAME_TO_CODE.get(raw) || "";
}

function normalizeProfessionLabel(value: unknown): string {
  return readString(value).replace(/\s+/g, " ").trim().toUpperCase();
}

function buildObjectId(stateCode: string, professionToken: string): string {
  return `HC.OBJ.LICENSE.${stateCode}.${professionToken}`;
}

function buildSnapshotPrefix(stateCode: string, professionToken: string, approvedAt: Date): string {
  const ymd = approvedAt.toISOString().slice(0, 10).replace(/-/g, "");
  return `HC.SNAP.LICENSE.${stateCode}.${professionToken}.${ymd}.`;
}

function buildDiffPrefix(stateCode: string, professionToken: string, approvedAt: Date): string {
  const ymd = approvedAt.toISOString().slice(0, 10).replace(/-/g, "");
  return `HC.DIFF.LICENSE.${stateCode}.${professionToken}.${ymd}.`;
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return asRecord(parsed) || {};
  } catch {
    return {};
  }
}

function extractMoneyValue(answer: string, pattern: RegExp): number | null {
  const match = answer.match(pattern);
  if (!match) return null;
  return readNumber(match[1]);
}

function extractSentence(answer: string, pattern: RegExp): string | null {
  const match = answer.match(pattern);
  if (!match) return null;
  const sentence = String(match[0] || "").replace(/\s+/g, " ").trim();
  return sentence || null;
}

function detectBoolean(answer: string, positive: RegExp[], negative: RegExp[]): boolean | null {
  for (const pattern of positive) {
    if (pattern.test(answer)) return true;
  }
  for (const pattern of negative) {
    if (pattern.test(answer)) return false;
  }
  return null;
}

function normalizeDays(unit: string, value: number): number {
  const normalizedUnit = unit.toLowerCase();
  if (normalizedUnit.startsWith("week")) return value * 7;
  if (normalizedUnit.startsWith("month")) return value * 30;
  return value;
}

function extractProcessingTime(answer: string): {
  text: string | null;
  minDays: number | null;
  maxDays: number | null;
} {
  const rangeMatch = answer.match(
    /(?:processing|timeline|turnaround)[^.:\n]{0,80}?(\d{1,3})\s*(day|days|week|weeks|month|months)\s*(?:to|-|–)\s*(\d{1,3})\s*(day|days|week|weeks|month|months)/i,
  );
  if (rangeMatch) {
    const a = Number(rangeMatch[1]);
    const unitA = rangeMatch[2];
    const b = Number(rangeMatch[3]);
    const unitB = rangeMatch[4];
    const minDays = normalizeDays(unitA, a);
    const maxDays = normalizeDays(unitB, b);
    return {
      text: rangeMatch[0].trim(),
      minDays: Math.min(minDays, maxDays),
      maxDays: Math.max(minDays, maxDays),
    };
  }

  const singleMatch = answer.match(
    /(?:processing|timeline|turnaround)[^.:\n]{0,80}?(\d{1,3})\s*(day|days|week|weeks|month|months)/i,
  );
  if (singleMatch) {
    const value = Number(singleMatch[1]);
    const unit = singleMatch[2];
    const days = normalizeDays(unit, value);
    return { text: singleMatch[0].trim(), minDays: days, maxDays: days };
  }

  return { text: null, minDays: null, maxDays: null };
}

function normalizeSourceRefs(input: SourceRefInput[] | null | undefined): Array<Record<string, unknown>> {
  const refs = Array.isArray(input) ? input : [];
  const normalized: Array<Record<string, unknown>> = [];
  for (const ref of refs) {
    const title = readString(ref.title || ref.ref_id);
    const uri = readString(ref.uri);
    const verifiedAtRaw = readString(ref.verified_at || ref.verifiedAt);
    if (!title && !uri) continue;
    const verifiedAt = toIsoOrNull(verifiedAtRaw);
    normalized.push({
      title: title || "Source",
      uri,
      verified_at: verifiedAt,
    });
  }
  return normalized;
}

function parseNormalizedFacts(
  answerText: string,
  sourceRefs: Array<Record<string, unknown>>,
): NormalizedFacts {
  const compact = answerText.replace(/\s+/g, " ").trim();
  const processing = extractProcessingTime(compact);
  const portalMatch = compact.match(/https?:\/\/[^\s)]+/i);
  const boardMatch =
    compact.match(/(?:board name|licensing board|board)\s*[:\-]\s*([^.|\n]+)/i) ||
    compact.match(/([A-Z][A-Za-z&,\-\s]{8,120}\sBoard(?:\s+of\s+[A-Za-z\s]+)?)/i);

  const verificationSentence = extractSentence(
    compact,
    /[^.]*verification[^.]*?(?:fee|required|not required|waived|optional)[^.]*\./i,
  );

  let fingerprintMode: string | null = null;
  if (/live\s*scan/i.test(compact)) fingerprintMode = "Live Scan";
  else if (/fingerprint card/i.test(compact)) fingerprintMode = "Fingerprint card";
  else if (/fingerprint/i.test(compact)) fingerprintMode = "Fingerprint required";

  const sourceVerified = sourceRefs
    .map((ref) => toIsoOrNull(ref.verified_at))
    .find((value) => Boolean(value)) || null;

  return {
    application_fee_usd: extractMoneyValue(compact, /application fee[^$\d]{0,40}\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i),
    background_check_fee_usd: extractMoneyValue(
      compact,
      /background check(?: fee)?[^$\d]{0,40}\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
    ),
    verification_required: detectBoolean(
      compact,
      [/\bverification\b[^.]{0,40}\b(required|mandatory|needed)\b/i],
      [/\bverification\b[^.]{0,40}\b(not required|not needed|optional|waived)\b/i],
    ),
    verification_fee_note: verificationSentence,
    fingerprint_mode: fingerprintMode,
    estimated_processing_time_text: processing.text,
    estimated_processing_time_days_min: processing.minDays,
    estimated_processing_time_days_max: processing.maxDays,
    temporary_license_available: detectBoolean(
      compact,
      [/\btemporary license\b[^.]{0,30}\b(available|offered|issued)\b/i],
      [/\btemporary license\b[^.]{0,30}\b(not available|not offered|unavailable)\b/i],
    ),
    license_in_hand_required: detectBoolean(
      compact,
      [/\blicense in hand\b[^.]{0,30}\b(required|needed|mandatory)\b/i],
      [/\blicense in hand\b[^.]{0,30}\b(not required|not needed)\b/i],
    ),
    board_name: boardMatch ? readString(boardMatch[1]) || null : null,
    portal_url: portalMatch ? readString(portalMatch[0]) || null : null,
    last_source_verified_at: sourceVerified,
  };
}

function toJsonString(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

function computeChangedFields(
  prevFacts: Record<string, unknown>,
  nextFacts: NormalizedFacts,
): {
  changedFields: Record<string, { from: unknown; to: unknown }>;
  changedFieldNames: string[];
  hasMaterialChange: boolean;
  changeSummary: string;
} {
  const changedFields: Record<string, { from: unknown; to: unknown }> = {};

  for (const key of FACT_KEYS) {
    const prevValue = key in prevFacts ? prevFacts[key] : null;
    const nextValue = (nextFacts as Record<string, unknown>)[key] ?? null;
    if (JSON.stringify(prevValue ?? null) !== JSON.stringify(nextValue ?? null)) {
      changedFields[key] = { from: prevValue ?? null, to: nextValue ?? null };
    }
  }

  const changedFieldNames = Object.keys(changedFields);
  const hasMaterialChange = changedFieldNames.length > 0;
  const changeSummary = hasMaterialChange
    ? `${changedFieldNames.length} field${changedFieldNames.length === 1 ? "" : "s"} changed: ${changedFieldNames.slice(0, 5).join(", ")}${changedFieldNames.length > 5 ? "…" : ""}.`
    : "No material field changes since last approved snapshot.";

  return {
    changedFields,
    changedFieldNames,
    hasMaterialChange,
    changeSummary,
  };
}

export async function approveHealthcareResearchSnapshot(
  input: HealthcareResearchApprovalInput,
): Promise<HealthcareResearchApprovalResult> {
  const stateCode = normalizeStateCode(input.state);
  const profession = normalizeProfessionLabel(input.profession);
  const category = readString(input.category) || "licensing";
  const answerText = readString(input.answer_text);
  const approvedBy = readString(input.approved_by) || "local_user";
  const approvalNote = readString(input.approval_note) || null;
  const approvedAtDate = new Date(readString(input.approved_at) || Date.now());

  if (!stateCode) throw new Error("state is required and must be a valid US state");
  if (!profession) throw new Error("profession is required");
  if (!answerText) throw new Error("answer_text is required");
  if (Number.isNaN(approvedAtDate.getTime())) throw new Error("approved_at must be a valid date");

  const professionToken = toObjectToken(profession);
  if (!professionToken) throw new Error("profession token could not be derived");
  const objectId = buildObjectId(stateCode, professionToken);
  const approvedAtIso = approvedAtDate.toISOString();

  const searchQueries = Array.isArray(input.search_queries)
    ? input.search_queries.map((entry) => readString(entry)).filter(Boolean)
    : [];
  const sourceRefs = normalizeSourceRefs(input.source_refs);
  const normalizedFacts = parseNormalizedFacts(answerText, sourceRefs);

  const txSummary = await licensingDb.runTransactionAsync(async (tx: any) => {
    const txLike = tx as unknown as TxLike;
    const [existingObjectRow] = await runRows(txLike, {
      sql: `SELECT object_id, current_snapshot_id, current_summary_json
            FROM hc_research_objects
            WHERE object_id = @objectId
            LIMIT 1`,
      params: { objectId },
      types: { objectId: { type: "string" } },
    });

    const existingObject = asRecord(existingObjectRow?.toJSON()) || null;
    const previousSnapshotIdFromObject = readString(existingObject?.current_snapshot_id) || null;

    let previousSnapshotId: string | null = previousSnapshotIdFromObject;
    let previousFacts: Record<string, unknown> = {};

    if (previousSnapshotId) {
      const [snapshotRow] = await runRows(txLike, {
        sql: `SELECT normalized_facts_json
              FROM hc_research_snapshots
              WHERE snapshot_id = @snapshotId
              LIMIT 1`,
        params: { snapshotId: previousSnapshotId },
        types: { snapshotId: { type: "string" } },
      });
      const snapshotData = asRecord(snapshotRow?.toJSON()) || {};
      previousFacts = parseJsonObject(readString(snapshotData.normalized_facts_json));
    } else {
      const [latestRow] = await runRows(txLike, {
        sql: `SELECT snapshot_id, normalized_facts_json
              FROM hc_research_snapshots
              WHERE object_id = @objectId
              ORDER BY approved_at DESC
              LIMIT 1`,
        params: { objectId },
        types: { objectId: { type: "string" } },
      });
      const latestData = asRecord(latestRow?.toJSON()) || {};
      previousSnapshotId = readString(latestData.snapshot_id) || null;
      previousFacts = parseJsonObject(readString(latestData.normalized_facts_json));
    }

    const {
      changedFields,
      changedFieldNames,
      hasMaterialChange,
      changeSummary,
    } = computeChangedFields(previousFacts, normalizedFacts);

    const snapshotPrefix = buildSnapshotPrefix(stateCode, professionToken, approvedAtDate);
    const [snapshotSeqRow] = await runRows(txLike, {
      sql: `SELECT COUNT(*) AS c
            FROM hc_research_snapshots
            WHERE STARTS_WITH(snapshot_id, @prefix)`,
      params: { prefix: snapshotPrefix },
      types: { prefix: { type: "string" } },
    });
    const snapshotSeqData = asRecord(snapshotSeqRow?.toJSON()) || {};
    const snapshotSeq = Number(readNumber(snapshotSeqData.c) || 0) + 1;
    const snapshotId = `${snapshotPrefix}${String(snapshotSeq).padStart(3, "0")}`;

    const rawAnswerJson = toJsonString(
      asRecord(input.raw_answer_json) || {
        answer_text: answerText,
      },
    );
    const normalizedFactsJson = toJsonString(normalizedFacts);
    const searchQueriesJson = toJsonString(searchQueries);
    const sourceRefsJson = toJsonString(sourceRefs);

    await txLike.runUpdate({
      sql: `INSERT INTO hc_research_snapshots (
              snapshot_id,
              object_id,
              approved_at,
              approved_by,
              search_queries_json,
              source_refs_json,
              raw_answer_json,
              normalized_facts_json,
              approval_note,
              created_at
            ) VALUES (
              @snapshotId,
              @objectId,
              @approvedAt,
              @approvedBy,
              @searchQueriesJson,
              @sourceRefsJson,
              @rawAnswerJson,
              @normalizedFactsJson,
              @approvalNote,
              PENDING_COMMIT_TIMESTAMP()
            )`,
      params: {
        snapshotId,
        objectId,
        approvedAt: approvedAtDate,
        approvedBy,
        searchQueriesJson,
        sourceRefsJson,
        rawAnswerJson,
        normalizedFactsJson,
        approvalNote,
      },
      types: {
        snapshotId: { type: "string" },
        objectId: { type: "string" },
        approvedAt: { type: "timestamp" },
        approvedBy: { type: "string" },
        searchQueriesJson: { type: "string" },
        sourceRefsJson: { type: "string" },
        rawAnswerJson: { type: "string" },
        normalizedFactsJson: { type: "string" },
        approvalNote: { type: "string" },
      },
    });

    const objectSummaryJson = toJsonString({
      state: stateCode,
      profession,
      current_snapshot_id: snapshotId,
      has_material_change: hasMaterialChange,
      changed_field_count: changedFieldNames.length,
      change_summary: previousSnapshotId ? changeSummary : "First approved snapshot.",
      approved_at: approvedAtIso,
    });

    if (!existingObject) {
      await txLike.runUpdate({
        sql: `INSERT INTO hc_research_objects (
                object_id,
                category,
                state,
                profession,
                current_snapshot_id,
                last_verified_at,
                current_summary_json,
                updated_at,
                created_at
              ) VALUES (
                @objectId,
                @category,
                @state,
                @profession,
                @snapshotId,
                @lastVerifiedAt,
                @summaryJson,
                PENDING_COMMIT_TIMESTAMP(),
                PENDING_COMMIT_TIMESTAMP()
              )`,
        params: {
          objectId,
          category,
          state: stateCode,
          profession,
          snapshotId,
          lastVerifiedAt: approvedAtDate,
          summaryJson: objectSummaryJson,
        },
        types: {
          objectId: { type: "string" },
          category: { type: "string" },
          state: { type: "string" },
          profession: { type: "string" },
          snapshotId: { type: "string" },
          lastVerifiedAt: { type: "timestamp" },
          summaryJson: { type: "string" },
        },
      });
    } else {
      await txLike.runUpdate({
        sql: `UPDATE hc_research_objects
              SET category = @category,
                  state = @state,
                  profession = @profession,
                  current_snapshot_id = @snapshotId,
                  last_verified_at = @lastVerifiedAt,
                  current_summary_json = @summaryJson,
                  updated_at = PENDING_COMMIT_TIMESTAMP()
              WHERE object_id = @objectId`,
        params: {
          objectId,
          category,
          state: stateCode,
          profession,
          snapshotId,
          lastVerifiedAt: approvedAtDate,
          summaryJson: objectSummaryJson,
        },
        types: {
          objectId: { type: "string" },
          category: { type: "string" },
          state: { type: "string" },
          profession: { type: "string" },
          snapshotId: { type: "string" },
          lastVerifiedAt: { type: "timestamp" },
          summaryJson: { type: "string" },
        },
      });
    }

    const diffPrefix = buildDiffPrefix(stateCode, professionToken, approvedAtDate);
    const [diffSeqRow] = await runRows(txLike, {
      sql: `SELECT COUNT(*) AS c
            FROM hc_research_diffs
            WHERE STARTS_WITH(diff_id, @prefix)`,
      params: { prefix: diffPrefix },
      types: { prefix: { type: "string" } },
    });
    const diffSeqData = asRecord(diffSeqRow?.toJSON()) || {};
    const diffSeq = Number(readNumber(diffSeqData.c) || 0) + 1;
    const diffId = `${diffPrefix}${String(diffSeq).padStart(3, "0")}`;

    await txLike.runUpdate({
      sql: `INSERT INTO hc_research_diffs (
              diff_id,
              object_id,
              from_snapshot_id,
              to_snapshot_id,
              changed_fields_json,
              change_summary,
              has_material_change,
              created_at
            ) VALUES (
              @diffId,
              @objectId,
              @fromSnapshotId,
              @toSnapshotId,
              @changedFieldsJson,
              @changeSummary,
              @hasMaterialChange,
              PENDING_COMMIT_TIMESTAMP()
            )`,
      params: {
        diffId,
        objectId,
        fromSnapshotId: previousSnapshotId,
        toSnapshotId: snapshotId,
        changedFieldsJson: toJsonString(changedFields),
        changeSummary: previousSnapshotId ? changeSummary : "First approved snapshot.",
        hasMaterialChange,
      },
      types: {
        diffId: { type: "string" },
        objectId: { type: "string" },
        fromSnapshotId: { type: "string" },
        toSnapshotId: { type: "string" },
        changedFieldsJson: { type: "string" },
        changeSummary: { type: "string" },
        hasMaterialChange: { type: "bool" },
      },
    });

    await txLike.commit();

    return {
      snapshotId,
      diffId,
      previousSnapshotId,
      changedFields,
      changedFieldNames,
      hasMaterialChange,
      changeSummary,
      normalizedFacts,
    };
  });

  const isFirstVersion = !txSummary.previousSnapshotId;

  return {
    object_id: objectId,
    snapshot_id: txSummary.snapshotId,
    diff_id: txSummary.diffId,
    category,
    state: stateCode,
    profession,
    approved_at: approvedAtIso,
    approved_by: approvedBy,
    is_first_version: isFirstVersion,
    has_material_change: isFirstVersion ? true : txSummary.hasMaterialChange,
    changed_field_count: txSummary.changedFieldNames.length,
    changed_fields: txSummary.changedFields,
    changed_field_names: txSummary.changedFieldNames,
    change_summary: isFirstVersion ? "First approved snapshot." : txSummary.changeSummary,
    normalized_facts: txSummary.normalizedFacts,
  };
}

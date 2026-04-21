import { createHash } from "node:crypto";
import { getRecruitingDb } from "@/lib/spanner-pool";

const recruitingDb = getRecruitingDb();

export const SHIFT_TYPE_ENUM = [
  "days",
  "nights",
  "rotating",
  "variable",
  "other",
] as const;

const SHIFT_TYPE_SET = new Set<string>(SHIFT_TYPE_ENUM);

type ShiftType = (typeof SHIFT_TYPE_ENUM)[number];

type CanonicalWriteStatus = "inserted" | "updated" | "no_change" | "failed_validation";

export interface MarginCaptureRowInput {
  [key: string]: unknown;
}

export interface MarginCaptureIngestInput {
  view_type?: string;
  source_kind?: string;
  source_url?: string | null;
  screenshot_id?: string | null;
  captured_at?: string | null;
  captured_by?: string | null;
  notes?: string | null;
  raw_capture_json?: unknown;
  rows: MarginCaptureRowInput[];
}

export interface MarginLedgerQueryInput {
  margin_object_id?: string;
  candidate_id?: string;
  candidate_name?: string;
  margin_id?: string;
  job_id?: string;
  facility_name?: string;
  profession?: string;
  specialty?: string;
  event_id?: string;
  view_type?: string;
  source_kind?: string;
  include_provenance?: boolean;
  limit?: number;
  event_limit?: number;
}

interface MarginObjectRecord {
  margin_object_id: string;
  record_phase: string;
  candidate_id: string | null;
  candidate_name: string | null;
  candidate_email: string | null;
  nova_profile_url: string | null;
  job_id: string | null;
  margin_id: string | null;
  facility_name: string | null;
  profession: string | null;
  specialty: string | null;
  shift_type: string | null;
  shift_start_hhmm: string | null;
  shift_end_hhmm: string | null;
  weekly_hours: number | null;
  start_date: string | null;
  end_date: string | null;
  target_margin_pct: string | null;
  actual_margin_pct: string | null;
  base_pay_rate_usd: string | null;
  weekly_stipends_usd: string | null;
  gross_weekly_pay_usd: string | null;
  gross_weekly_pay_computed_usd: string | null;
  is_local: boolean | null;
  is_compact: boolean | null;
  source_of_truth: string;
  current: boolean;
  effective_at: string | null;
  last_seen_at: string;
  created_at: string | null;
  updated_at: string | null;
}

interface MarginCaptureEventRecord {
  event_id: string;
  view_type: string | null;
  captured_at: string;
  source_kind: string;
  source_url: string | null;
  screenshot_id: string | null;
  rows_captured: number;
  captured_by: string | null;
  notes: string | null;
  created_at: string | null;
}

interface MarginCaptureLinkRecord {
  event_id: string;
  margin_object_id: string;
  position_index: number;
  raw_text: string | null;
  raw_json: Record<string, unknown> | null;
  confidence: number | null;
  source_record_type: string;
  canonical_write_status: string;
  validation_errors: ValidationIssue[];
  captured_at: string;
  created_at: string | null;
}

type ValidationIssue = {
  row_index: number;
  field: string;
  code: string;
  message: string;
  raw_value: string | null;
  severity: "error" | "warning";
};

type RecordPhase = "job" | "margin";

type NormalizedMarginRow = {
  marginObjectId: string;
  recordPhase: RecordPhase;
  candidateId: string | null;
  candidateName: string | null;
  candidateEmail: string | null;
  novaProfileUrl: string | null;
  jobId: string | null;
  marginId: string | null;
  facilityName: string | null;
  profession: string | null;
  specialty: string | null;
  shiftType: ShiftType | null;
  shiftStartHhmm: string | null;
  shiftEndHhmm: string | null;
  weeklyHours: number | null;
  startDate: string | null;
  endDate: string | null;
  targetMarginPct: number | null;
  actualMarginPct: number | null;
  basePayRateUsd: number | null;
  weeklyStipendsUsd: number | null;
  grossWeeklyPayUsd: number | null;
  grossWeeklyPayComputedUsd: number | null;
  isLocal: boolean | null;
  isCompact: boolean | null;
  sourceOfTruth: "browser_capture";
  rawText: string | null;
  rawJson: string;
  confidence: number | null;
  sourceRecordType: string;
};

type NormalizeMarginPayloadResult = {
  normalized: NormalizedMarginRow;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  canonicalWritable: boolean;
};

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
        record.numberValue ??
        record.floatValue ??
        record.boolValue;
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
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = readString(value);
  if (!normalized) return null;
  const cleaned = normalized.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = readString(value).toLowerCase();
  if (!normalized) return null;
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return null;
}

function normalizeNullableString(value: unknown): string | null {
  const normalized = readString(value).replace(/\s+/g, " ").trim();
  return normalized || null;
}

function toToken(value: string): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 64);
}

function toSpannerNumeric(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const rounded = value.toFixed(9).replace(/\.?0+$/, "");
  return rounded === "-0" ? "0" : rounded;
}

function normalizeLimit(value: number | undefined, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function toIsoTimestamp(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function toIsoDate(value: unknown): string | null {
  const iso = toIsoTimestamp(value);
  return iso ? iso.slice(0, 10) : null;
}

function parseCurrency(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = readString(value);
  if (!raw) return null;

  const isNegative = /^\(.*\)$/.test(raw);
  const cleaned = raw
    .replace(/[,$\s]/g, "")
    .replace(/^\((.*)\)$/, "$1")
    .replace(/USD/gi, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return isNegative ? -parsed : parsed;
}

function parsePercentDecimal(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Math.abs(value) <= 1) return value;
    return value / 100;
  }

  const raw = readString(value);
  if (!raw) return null;
  const hadPercentSign = raw.includes("%");
  const cleaned = raw.replace(/[,%\s]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  if (hadPercentSign || Math.abs(parsed) > 1) return parsed / 100;
  return parsed;
}

function normalizeShiftType(value: unknown): ShiftType | null {
  const normalized = readString(value).toLowerCase().replace(/[\s_-]+/g, " ");
  if (!normalized) return null;
  const alias: Record<string, ShiftType> = {
    day: "days",
    days: "days",
    "day shift": "days",
    nights: "nights",
    night: "nights",
    "night shift": "nights",
    rotating: "rotating",
    "rotating shift": "rotating",
    variable: "variable",
    var: "variable",
    other: "other",
  };
  const mapped = alias[normalized] || (SHIFT_TYPE_SET.has(normalized) ? (normalized as ShiftType) : null);
  return mapped || null;
}

function toHhMm(value: unknown): string | null {
  const raw = readString(value);
  if (!raw) return null;

  const amPm = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
  if (amPm) {
    let hour = Number(amPm[1]);
    const minute = Number(amPm[2] || "0");
    const meridiem = amPm[3].toLowerCase();
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return null;
    if (hour === 12) hour = 0;
    if (meridiem === "pm") hour += 12;
    if (hour < 0 || hour > 23) return null;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  const twentyFour = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFour) {
    const hour = Number(twentyFour[1]);
    const minute = Number(twentyFour[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  const spacedTwentyFour = raw.match(/^(\d{1,2})\s+(\d{2})$/);
  if (spacedTwentyFour) {
    const hour = Number(spacedTwentyFour[1]);
    const minute = Number(spacedTwentyFour[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  return null;
}

function getByPath(record: Record<string, unknown>, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = record;
  for (const segment of segments) {
    const object = asRecord(current);
    if (!object) return undefined;
    current = object[segment];
  }
  return current;
}

function pickFirst(record: Record<string, unknown>, paths: string[]): unknown {
  for (const path of paths) {
    const value = getByPath(record, path);
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && !value.trim()) continue;
    return value;
  }
  return undefined;
}

function addIssue(
  issues: ValidationIssue[],
  rowIndex: number,
  field: string,
  code: string,
  message: string,
  rawValue: unknown,
  severity: "error" | "warning",
) {
  issues.push({
    row_index: rowIndex,
    field,
    code,
    message,
    raw_value: normalizeNullableString(rawValue),
    severity,
  });
}

function buildMarginObjectIdentity(input: {
  candidateId: string | null;
  candidateName: string | null;
  marginId: string | null;
  jobId: string | null;
  facilityName: string | null;
  profession: string | null;
  rowIndex: number;
  recordPhase: RecordPhase;
}): { objectId: string; sourceRecordType: string; confidence: number } {
  // Job phase: no candidate, identity is purely job-based
  if (input.recordPhase === "job") {
    if (input.jobId) {
      return {
        objectId: `AYA.OBJ.JOB.${toToken(input.jobId)}`,
        sourceRecordType: "job_listing",
        confidence: 1,
      };
    }
    if (input.facilityName && input.profession) {
      return {
        objectId: `AYA.OBJ.JOB.${toToken(input.facilityName)}.${toToken(input.profession)}`,
        sourceRecordType: "job_facility_profession",
        confidence: 0.85,
      };
    }
    const fallbackJob = toToken(input.jobId || input.facilityName || `ROW_${input.rowIndex}`);
    return {
      objectId: `AYA.OBJ.JOB.RAW_ONLY.${fallbackJob}`,
      sourceRecordType: "fallback_job_raw_only",
      confidence: 0.5,
    };
  }

  // Margin phase: candidate + job/margin context
  if (input.candidateId && input.marginId) {
    return {
      objectId: `AYA.OBJ.MARGIN.${toToken(input.candidateId)}.${toToken(input.marginId)}`,
      sourceRecordType: "candidate_margin",
      confidence: 1,
    };
  }
  if (input.candidateId && input.jobId) {
    return {
      objectId: `AYA.OBJ.MARGIN.${toToken(input.candidateId)}.${toToken(input.jobId)}`,
      sourceRecordType: "candidate_job",
      confidence: 0.98,
    };
  }
  if (input.candidateName && input.facilityName && input.profession) {
    return {
      objectId: `AYA.OBJ.MARGIN.${toToken(input.candidateName)}.${toToken(`${input.facilityName}_${input.profession}`)}`,
      sourceRecordType: "name_facility_profession",
      confidence: 0.85,
    };
  }
  const fallbackCandidate = toToken(input.candidateId || input.candidateName || `ROW_${input.rowIndex}`);
  const fallbackMargin = toToken(input.marginId || input.jobId || input.facilityName || `ROW_${input.rowIndex}`);
  return {
    objectId: `AYA.OBJ.MARGIN.RAW_ONLY.${fallbackCandidate}_${fallbackMargin}`,
    sourceRecordType: "fallback_raw_only",
    confidence: 0.5,
  };
}

export function normalizeMarginPayload(input: MarginCaptureRowInput, rowIndex: number): NormalizeMarginPayloadResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const candidateId =
    normalizeNullableString(
      pickFirst(input, [
        "candidate_id",
        "candidateId",
        "candidate.id",
        "candidate.uuid",
        "overview_info.candidate_id",
        "nova_id",
        "novaId",
      ]),
    ) || null;

  const candidateName =
    normalizeNullableString(
      pickFirst(input, [
        "candidate_name",
        "candidateName",
        "candidate.full_name",
        "candidate.fullName",
        "candidate.display_name",
        "candidate.name",
        "overview_info.candidate_name",
        "traveler_name",
      ]),
    ) || null;

  const candidateEmail =
    normalizeNullableString(
      pickFirst(input, ["candidate_email", "candidateEmail", "candidate.email", "overview_info.email", "email"]),
    ) || null;

  const marginId =
    normalizeNullableString(
      pickFirst(input, ["margin_id", "marginId", "margin.id", "margin_calc_id"]),
    ) || null;

  const jobId =
    normalizeNullableString(
      pickFirst(input, ["job_id", "jobId", "job.id", "overview_info.job_id"]),
    ) || null;

  const facilityName =
    normalizeNullableString(
      pickFirst(input, [
        "facility_name",
        "facilityName",
        "facility.name",
        "job.facility_name",
        "job.facilityName",
        "overview_info.facility",
        "overview_info.location",
      ]),
    ) || null;

  const profession =
    normalizeNullableString(
      pickFirst(input, ["profession", "candidate.profession", "job.profession", "overview_info.profession"]),
    ) || null;
  const specialty =
    normalizeNullableString(
      pickFirst(input, ["specialty", "candidate.specialty", "job.specialty", "overview_info.specialty"]),
    ) || null;

  const shiftRaw = pickFirst(input, [
    "shift_type",
    "shiftType",
    "job.shift_type",
    "job.shiftType",
    "contract_shift_info.shift_time",
    "contract_shift_info.shift_type",
  ]);
  const shiftType = normalizeShiftType(shiftRaw);
  if (shiftRaw != null && !shiftType) {
    addIssue(
      warnings,
      rowIndex,
      "shift_type",
      "UNKNOWN_SHIFT_TYPE",
      `Shift type '${readString(shiftRaw)}' was not recognized and was normalized to null.`,
      shiftRaw,
      "warning",
    );
  }

  const shiftStartRaw = pickFirst(input, [
    "shift_start_time",
    "shiftStartTime",
    "job.shift_start_time",
    "job.shiftStartTime",
    "contract_shift_info.timeframe_start",
  ]);
  const shiftEndRaw = pickFirst(input, [
    "shift_end_time",
    "shiftEndTime",
    "job.shift_end_time",
    "job.shiftEndTime",
    "contract_shift_info.timeframe_end",
  ]);
  const shiftStartHhmm = toHhMm(shiftStartRaw);
  const shiftEndHhmm = toHhMm(shiftEndRaw);
  if (shiftStartRaw != null && !shiftStartHhmm) {
    addIssue(
      warnings,
      rowIndex,
      "shift_start_time",
      "INVALID_TIME",
      "shift_start_time could not be parsed to HH:mm and was normalized to null.",
      shiftStartRaw,
      "warning",
    );
  }
  if (shiftEndRaw != null && !shiftEndHhmm) {
    addIssue(
      warnings,
      rowIndex,
      "shift_end_time",
      "INVALID_TIME",
      "shift_end_time could not be parsed to HH:mm and was normalized to null.",
      shiftEndRaw,
      "warning",
    );
  }

  const weeklyHoursRaw = pickFirst(input, ["weekly_hours", "weeklyHours", "job.weekly_hours", "job.weeklyHours"]);
  const weeklyHoursNumber = readNumber(weeklyHoursRaw);
  const contractHours = readNumber(pickFirst(input, ["contract_shift_info.hours"]));
  const contractShiftsPerWeek = readNumber(pickFirst(input, ["contract_shift_info.number_of_shifts"]));
  const derivedWeeklyHours =
    contractHours != null && contractShiftsPerWeek != null
      ? Math.max(0, Math.floor(contractHours * contractShiftsPerWeek))
      : null;
  const weeklyHours =
    weeklyHoursNumber == null
      ? derivedWeeklyHours
      : Math.max(0, Math.floor(weeklyHoursNumber));
  if (weeklyHoursRaw != null && weeklyHoursNumber == null) {
    addIssue(
      warnings,
      rowIndex,
      "weekly_hours",
      "INVALID_NUMBER",
      "weekly_hours could not be parsed to a number and was normalized to null.",
      weeklyHoursRaw,
      "warning",
    );
  }

  const startDateRaw = pickFirst(input, [
    "start_date",
    "startDate",
    "job.start_date",
    "job.startDate",
    "contract_shift_info.start_date",
  ]);
  const endDateRaw = pickFirst(input, [
    "end_date",
    "endDate",
    "job.end_date",
    "job.endDate",
    "contract_shift_info.end_date",
  ]);
  const startDate = startDateRaw == null ? null : toIsoDate(startDateRaw);
  const endDate = endDateRaw == null ? null : toIsoDate(endDateRaw);
  if (startDateRaw != null && !startDate) {
    addIssue(
      warnings,
      rowIndex,
      "start_date",
      "INVALID_DATE",
      "start_date could not be parsed to ISO date and was normalized to null.",
      startDateRaw,
      "warning",
    );
  }
  if (endDateRaw != null && !endDate) {
    addIssue(
      warnings,
      rowIndex,
      "end_date",
      "INVALID_DATE",
      "end_date could not be parsed to ISO date and was normalized to null.",
      endDateRaw,
      "warning",
    );
  }

  const targetMarginRaw = pickFirst(input, [
    "target_margin_pct",
    "targetMarginPct",
    "target_margin",
    "margin.target_margin_pct",
    "margin.targetMarginPct",
    "margin.target_margin",
    "summary.target_margin_pct",
  ]);
  const actualMarginRaw = pickFirst(input, [
    "actual_margin_pct",
    "actualMarginPct",
    "actual_margin",
    "margin.actual_margin_pct",
    "margin.actualMarginPct",
    "margin.actual_margin",
    "summary.actual_margin_pct",
  ]);
  const targetMarginPct = parsePercentDecimal(targetMarginRaw);
  const actualMarginPct = parsePercentDecimal(actualMarginRaw);
  if (targetMarginRaw != null && targetMarginPct == null) {
    addIssue(
      warnings,
      rowIndex,
      "target_margin_pct",
      "INVALID_PERCENT",
      "target_margin_pct could not be parsed and was normalized to null.",
      targetMarginRaw,
      "warning",
    );
  }
  if (actualMarginRaw != null && actualMarginPct == null) {
    addIssue(
      warnings,
      rowIndex,
      "actual_margin_pct",
      "INVALID_PERCENT",
      "actual_margin_pct could not be parsed and was normalized to null.",
      actualMarginRaw,
      "warning",
    );
  }

  const basePayRaw = pickFirst(input, [
    "base_pay_rate_usd",
    "base_pay_rate",
    "basePayRate",
    "pay.base_pay_rate",
    "pay.base_pay_rate_usd",
    "pay.taxable_hourly_rate",
    "taxable_rate",
    "pay_billing.base_pay_rate",
  ]);
  const stipendRaw = pickFirst(input, [
    "weekly_stipends_usd",
    "weekly_stipends",
    "weeklyStipends",
    "pay.weekly_stipends",
    "pay.weekly_stipend_total",
    "pay.total_stipends",
    "pay_billing.weekly_stipends",
  ]);
  const grossRaw = pickFirst(input, [
    "gross_weekly_pay_usd",
    "gross_weekly_pay",
    "grossWeeklyPay",
    "pay.gross_weekly_pay",
    "summary.est_gross_pay.weekly",
  ]);

  const basePayRateUsd = parseCurrency(basePayRaw);
  const weeklyStipendsUsd = parseCurrency(stipendRaw);
  const grossWeeklyPayUsd = parseCurrency(grossRaw);
  if (basePayRaw != null && basePayRateUsd == null) {
    addIssue(
      warnings,
      rowIndex,
      "base_pay_rate_usd",
      "INVALID_CURRENCY",
      "base_pay_rate could not be parsed and was normalized to null.",
      basePayRaw,
      "warning",
    );
  }
  if (stipendRaw != null && weeklyStipendsUsd == null) {
    addIssue(
      warnings,
      rowIndex,
      "weekly_stipends_usd",
      "INVALID_CURRENCY",
      "weekly_stipends could not be parsed and was normalized to null.",
      stipendRaw,
      "warning",
    );
  }
  if (grossRaw != null && grossWeeklyPayUsd == null) {
    addIssue(
      warnings,
      rowIndex,
      "gross_weekly_pay_usd",
      "INVALID_CURRENCY",
      "gross_weekly_pay could not be parsed and was normalized to null.",
      grossRaw,
      "warning",
    );
  }

  const grossWeeklyPayComputedUsd =
    basePayRateUsd != null && weeklyHours != null && weeklyStipendsUsd != null
      ? basePayRateUsd * weeklyHours + weeklyStipendsUsd
      : null;

  const isLocalRaw = pickFirst(input, ["is_local", "isLocal", "local_candidate", "localCandidate"]);
  const isCompactRaw = pickFirst(input, ["is_compact", "isCompact", "compact_license", "compactLicense"]);
  const isLocal = readBoolean(isLocalRaw);
  const isCompact = readBoolean(isCompactRaw);
  if (isLocalRaw != null && isLocal == null) {
    addIssue(
      warnings,
      rowIndex,
      "is_local",
      "INVALID_BOOLEAN",
      "is_local value could not be parsed to boolean and was normalized to null.",
      isLocalRaw,
      "warning",
    );
  }
  if (isCompactRaw != null && isCompact == null) {
    addIssue(
      warnings,
      rowIndex,
      "is_compact",
      "INVALID_BOOLEAN",
      "is_compact value could not be parsed to boolean and was normalized to null.",
      isCompactRaw,
      "warning",
    );
  }

  // Determine record phase: candidate present = margin, absent = job
  const recordPhase: RecordPhase = (candidateId || candidateName) ? "margin" : "job";

  // Jobs only require job context (no candidate needed)
  // Margins require both candidate and job context
  if (recordPhase === "margin" && !marginId && !jobId && !facilityName) {
    addIssue(
      errors,
      rowIndex,
      "margin_context",
      "MISSING_REQUIRED_FIELD",
      "margin_id, job_id, or facility_name is required for margin records.",
      null,
      "error",
    );
  }
  if (recordPhase === "job" && !jobId && !facilityName) {
    addIssue(
      errors,
      rowIndex,
      "job_context",
      "MISSING_REQUIRED_FIELD",
      "job_id or facility_name is required for job listings.",
      null,
      "error",
    );
  }

  const identity = buildMarginObjectIdentity({
    candidateId,
    candidateName,
    marginId,
    jobId,
    facilityName,
    profession,
    rowIndex,
    recordPhase,
  });

  const canonicalWritable = errors.length === 0;
  const novaProfileUrl =
    normalizeNullableString(
      pickFirst(input, ["nova_profile_url", "novaProfileUrl", "candidate.nova_profile_url", "candidate.profile_url"]),
    ) || (candidateId ? `https://nova.ayahealthcare.com/#/recruiting/candidates/${encodeURIComponent(candidateId)}/new-profile/about` : null);

  const rawText =
    normalizeNullableString(
      pickFirst(input, ["raw_text"]),
    ) ||
    [
      candidateName || candidateId || "unknown_candidate",
      profession || "unknown_profession",
      marginId || jobId || "unknown_margin",
      actualMarginPct != null ? `${(actualMarginPct * 100).toFixed(2)}%` : "actual_margin_null",
    ].join(" | ");

  const normalized: NormalizedMarginRow = {
    marginObjectId: identity.objectId,
    recordPhase,
    candidateId,
    candidateName,
    candidateEmail,
    novaProfileUrl,
    jobId,
    marginId,
    facilityName,
    profession,
    specialty,
    shiftType,
    shiftStartHhmm,
    shiftEndHhmm,
    weeklyHours,
    startDate,
    endDate,
    targetMarginPct,
    actualMarginPct,
    basePayRateUsd,
    weeklyStipendsUsd,
    grossWeeklyPayUsd,
    grossWeeklyPayComputedUsd,
    isLocal,
    isCompact,
    sourceOfTruth: "browser_capture",
    rawText,
    rawJson: JSON.stringify(input),
    confidence: identity.confidence,
    sourceRecordType: identity.sourceRecordType,
  };

  return { normalized, errors, warnings, canonicalWritable };
}

function mapMarginObjectRecord(row: Record<string, unknown>): MarginObjectRecord {
  return {
    margin_object_id: readString(row.margin_object_id),
    record_phase: normalizeNullableString(row.record_phase) || "margin",
    candidate_id: normalizeNullableString(row.candidate_id),
    candidate_name: normalizeNullableString(row.candidate_name),
    candidate_email: normalizeNullableString(row.candidate_email),
    nova_profile_url: normalizeNullableString(row.nova_profile_url),
    job_id: normalizeNullableString(row.job_id),
    margin_id: normalizeNullableString(row.margin_id),
    facility_name: normalizeNullableString(row.facility_name),
    profession: normalizeNullableString(row.profession),
    specialty: normalizeNullableString(row.specialty),
    shift_type: normalizeNullableString(row.shift_type),
    shift_start_hhmm: normalizeNullableString(row.shift_start_hhmm),
    shift_end_hhmm: normalizeNullableString(row.shift_end_hhmm),
    weekly_hours: readNumber(row.weekly_hours),
    start_date: normalizeNullableString(row.start_date),
    end_date: normalizeNullableString(row.end_date),
    target_margin_pct: toSpannerNumeric(readNumber(row.target_margin_pct)),
    actual_margin_pct: toSpannerNumeric(readNumber(row.actual_margin_pct)),
    base_pay_rate_usd: toSpannerNumeric(readNumber(row.base_pay_rate_usd)),
    weekly_stipends_usd: toSpannerNumeric(readNumber(row.weekly_stipends_usd)),
    gross_weekly_pay_usd: toSpannerNumeric(readNumber(row.gross_weekly_pay_usd)),
    gross_weekly_pay_computed_usd: toSpannerNumeric(readNumber(row.gross_weekly_pay_computed_usd)),
    is_local: readBoolean(row.is_local),
    is_compact: readBoolean(row.is_compact),
    source_of_truth: readString(row.source_of_truth) || "browser_capture",
    current: Boolean(row.current_flag ?? row.current),
    effective_at: toIsoTimestamp(row.effective_at),
    last_seen_at: toIsoTimestamp(row.last_seen_at) || new Date().toISOString(),
    created_at: toIsoTimestamp(row.created_at),
    updated_at: toIsoTimestamp(row.updated_at),
  };
}

function mapEventRecord(row: Record<string, unknown>): MarginCaptureEventRecord {
  return {
    event_id: readString(row.event_id),
    view_type: normalizeNullableString(row.view_type),
    captured_at: toIsoTimestamp(row.captured_at) || new Date().toISOString(),
    source_kind: readString(row.source_kind) || "browser_agent",
    source_url: normalizeNullableString(row.source_url),
    screenshot_id: normalizeNullableString(row.screenshot_id),
    rows_captured: Number(readNumber(row.rows_captured) || 0),
    captured_by: normalizeNullableString(row.captured_by),
    notes: normalizeNullableString(row.notes),
    created_at: toIsoTimestamp(row.created_at),
  };
}

function mapLinkRecord(row: Record<string, unknown>): MarginCaptureLinkRecord {
  let parsedRawJson: Record<string, unknown> | null = asRecord(row.raw_json);
  if (!parsedRawJson) {
    const rawJsonString = readString(row.raw_json);
    if (rawJsonString) {
      try {
        parsedRawJson = asRecord(JSON.parse(rawJsonString));
      } catch {
        parsedRawJson = null;
      }
    }
  }

  let validationErrors: ValidationIssue[] = [];
  if (Array.isArray(row.validation_errors_json)) {
    validationErrors = row.validation_errors_json as ValidationIssue[];
  } else {
    const rawValidation = readString(row.validation_errors_json);
    if (rawValidation) {
      try {
        const parsed = JSON.parse(rawValidation);
        if (Array.isArray(parsed)) validationErrors = parsed as ValidationIssue[];
      } catch {
        validationErrors = [];
      }
    }
  }

  return {
    event_id: readString(row.event_id),
    margin_object_id: readString(row.margin_object_id),
    position_index: Number(readNumber(row.position_index) || 0),
    raw_text: normalizeNullableString(row.raw_text),
    raw_json: parsedRawJson,
    confidence: readNumber(row.confidence),
    source_record_type: readString(row.source_record_type) || "unknown",
    canonical_write_status: readString(row.canonical_write_status) || "unknown",
    validation_errors: validationErrors,
    captured_at: toIsoTimestamp(row.captured_at) || new Date().toISOString(),
    created_at: toIsoTimestamp(row.created_at),
  };
}

function buildEventPrefix(capturedAt: Date): string {
  const date = capturedAt.toISOString().slice(0, 10).replace(/-/g, "");
  return `AYA.EVT.MARGIN_CAPTURE.${date}.`;
}

function buildLlJobRecordId(externalJobId: string): string {
  const hex = createHash("sha1")
    .update(`AYA_LL_JOB|${externalJobId}`)
    .digest("hex")
    .slice(0, 32)
    .toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function buildLlJobDescription(row: NormalizedMarginRow): string {
  const role = row.specialty || row.profession || "Healthcare role";
  const facility = row.facilityName || "Unknown facility";
  const marginToken = row.marginId ? `margin ${row.marginId}` : null;
  const suffix = marginToken ? ` (${marginToken})` : "";
  return `${role} at ${facility}${suffix}`;
}

function canonicalFieldsChanged(existing: Record<string, unknown>, row: NormalizedMarginRow): boolean {
  const equal = (a: unknown, b: unknown) => normalizeNullableString(a) === normalizeNullableString(b);
  return (
    !equal(existing.candidate_id, row.candidateId) ||
    !equal(existing.candidate_name, row.candidateName) ||
    !equal(existing.candidate_email, row.candidateEmail) ||
    !equal(existing.nova_profile_url, row.novaProfileUrl) ||
    !equal(existing.job_id, row.jobId) ||
    !equal(existing.margin_id, row.marginId) ||
    !equal(existing.facility_name, row.facilityName) ||
    !equal(existing.profession, row.profession) ||
    !equal(existing.specialty, row.specialty) ||
    !equal(existing.shift_type, row.shiftType) ||
    !equal(existing.shift_start_hhmm, row.shiftStartHhmm) ||
    !equal(existing.shift_end_hhmm, row.shiftEndHhmm) ||
    readNumber(existing.weekly_hours) !== row.weeklyHours ||
    !equal(existing.start_date, row.startDate) ||
    !equal(existing.end_date, row.endDate) ||
    readNumber(existing.target_margin_pct) !== row.targetMarginPct ||
    readNumber(existing.actual_margin_pct) !== row.actualMarginPct ||
    readNumber(existing.base_pay_rate_usd) !== row.basePayRateUsd ||
    readNumber(existing.weekly_stipends_usd) !== row.weeklyStipendsUsd ||
    readNumber(existing.gross_weekly_pay_usd) !== row.grossWeeklyPayUsd ||
    readNumber(existing.gross_weekly_pay_computed_usd) !== row.grossWeeklyPayComputedUsd ||
    readBoolean(existing.is_local) !== row.isLocal ||
    readBoolean(existing.is_compact) !== row.isCompact ||
    !equal(existing.source_of_truth, row.sourceOfTruth)
  );
}

export async function ingestMarginLedgerCapture(input: MarginCaptureIngestInput) {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (rows.length === 0) {
    throw new Error("rows is required and must include at least one row");
  }

  const capturedAt = new Date(readString(input.captured_at) || Date.now());
  if (Number.isNaN(capturedAt.getTime())) {
    throw new Error("captured_at must be a valid date string");
  }

  const viewType = readString(input.view_type) || "nova_margin_list";
  const sourceKind = readString(input.source_kind) || "browser_agent";
  const sourceUrl = normalizeNullableString(input.source_url);
  const screenshotId = normalizeNullableString(input.screenshot_id);
  const capturedBy = readString(input.captured_by) || "browser_agent";
  const notes = normalizeNullableString(input.notes);

  const rawCaptureJson =
    input.raw_capture_json == null
      ? null
      : JSON.stringify(input.raw_capture_json);

  const normalizedResults = rows.map((row, index) => normalizeMarginPayload(row, index + 1));
  const invalidRows = normalizedResults
    .filter((entry) => !entry.canonicalWritable)
    .map((entry) => ({
      row_index: entry.errors[0]?.row_index || 0,
      errors: entry.errors,
      warnings: entry.warnings,
    }));

  const txResult = await recruitingDb.runTransactionAsync(async (tx: any) => {
    const eventPrefix = buildEventPrefix(capturedAt);
    const [seqRows] = await tx.run({
      sql: `SELECT COUNT(*) AS c
            FROM margin_capture_events
            WHERE STARTS_WITH(event_id, @eventPrefix)`,
      params: { eventPrefix },
      types: { eventPrefix: { type: "string" } },
    });
    const seqData = asRecord(seqRows[0]?.toJSON()) || {};
    const seq = Number(readNumber(seqData.c) || 0) + 1;
    const eventId = `${eventPrefix}${String(seq).padStart(3, "0")}`;

    await tx.runUpdate({
      sql: `INSERT INTO margin_capture_events (
              event_id, view_type, captured_at, source_kind, source_url, screenshot_id,
              rows_captured, captured_by, notes, raw_capture_json, created_at
            ) VALUES (
              @eventId, @viewType, @capturedAt, @sourceKind, @sourceUrl, @screenshotId,
              @rowsCaptured, @capturedBy, @notes,
              CASE WHEN @rawCaptureJson IS NULL THEN NULL ELSE PARSE_JSON(@rawCaptureJson) END,
              PENDING_COMMIT_TIMESTAMP()
            )`,
      params: {
        eventId,
        viewType,
        capturedAt,
        sourceKind,
        sourceUrl,
        screenshotId,
        rowsCaptured: rows.length,
        capturedBy,
        notes,
        rawCaptureJson,
      },
      types: {
        eventId: { type: "string" },
        viewType: { type: "string" },
        capturedAt: { type: "timestamp" },
        sourceKind: { type: "string" },
        sourceUrl: { type: "string" },
        screenshotId: { type: "string" },
        rowsCaptured: { type: "int64" },
        capturedBy: { type: "string" },
        notes: { type: "string" },
        rawCaptureJson: { type: "string" },
      },
    });

    let upserted = 0;
    let updated = 0;
    let noChange = 0;
    let failedValidation = 0;
    let jobsInserted = 0;
    let jobsUpdated = 0;

    for (let i = 0; i < normalizedResults.length; i += 1) {
      const normalizedResult = normalizedResults[i];
      const row = normalizedResult.normalized;
      let canonicalWriteStatus: CanonicalWriteStatus = "failed_validation";

      if (normalizedResult.canonicalWritable) {
        const [existingRows] = await tx.run({
          sql: `SELECT candidate_id, candidate_name, candidate_email, nova_profile_url,
                       job_id, margin_id, facility_name, profession, specialty, shift_type,
                       shift_start_hhmm, shift_end_hhmm, weekly_hours, start_date, end_date, target_margin_pct, actual_margin_pct,
                       base_pay_rate_usd, weekly_stipends_usd, gross_weekly_pay_usd,
                       gross_weekly_pay_computed_usd, is_local, is_compact, source_of_truth
                FROM margin_objects
                WHERE margin_object_id = @objectId
                LIMIT 1`,
          params: { objectId: row.marginObjectId },
          types: { objectId: { type: "string" } },
        });

        const existing = asRecord(existingRows[0]?.toJSON());

        if (!existing) {
          await tx.runUpdate({
            sql: `INSERT INTO margin_objects (
                    margin_object_id, record_phase, candidate_id, candidate_name, candidate_email, nova_profile_url,
                    job_id, margin_id, facility_name, profession, specialty, shift_type,
                    shift_start_hhmm, shift_end_hhmm, weekly_hours, start_date, end_date, target_margin_pct, actual_margin_pct,
                    base_pay_rate_usd, weekly_stipends_usd, gross_weekly_pay_usd,
                    gross_weekly_pay_computed_usd, is_local, is_compact, source_of_truth,
                    current_flag, effective_at, last_seen_at, created_at, updated_at
                  ) VALUES (
                    @objectId, @recordPhase, @candidateId, @candidateName, @candidateEmail, @novaProfileUrl,
                    @jobId, @marginId, @facilityName, @profession, @specialty, @shiftType,
                    @shiftStartHhmm, @shiftEndHhmm, @weeklyHours, @startDate, @endDate, @targetMarginPct, @actualMarginPct,
                    @basePayRateUsd, @weeklyStipendsUsd, @grossWeeklyPayUsd,
                    @grossWeeklyPayComputedUsd, @isLocal, @isCompact, @sourceOfTruth,
                    TRUE, @effectiveAt, @lastSeenAt, PENDING_COMMIT_TIMESTAMP(), PENDING_COMMIT_TIMESTAMP()
                  )`,
            params: {
              objectId: row.marginObjectId,
              recordPhase: row.recordPhase,
              candidateId: row.candidateId,
              candidateName: row.candidateName,
              candidateEmail: row.candidateEmail,
              novaProfileUrl: row.novaProfileUrl,
              jobId: row.jobId,
              marginId: row.marginId,
              facilityName: row.facilityName,
              profession: row.profession,
              specialty: row.specialty,
              shiftType: row.shiftType,
              shiftStartHhmm: row.shiftStartHhmm,
              shiftEndHhmm: row.shiftEndHhmm,
              weeklyHours: row.weeklyHours,
              startDate: row.startDate,
              endDate: row.endDate,
              targetMarginPct: toSpannerNumeric(row.targetMarginPct),
              actualMarginPct: toSpannerNumeric(row.actualMarginPct),
              basePayRateUsd: toSpannerNumeric(row.basePayRateUsd),
              weeklyStipendsUsd: toSpannerNumeric(row.weeklyStipendsUsd),
              grossWeeklyPayUsd: toSpannerNumeric(row.grossWeeklyPayUsd),
              grossWeeklyPayComputedUsd: toSpannerNumeric(row.grossWeeklyPayComputedUsd),
              isLocal: row.isLocal,
              isCompact: row.isCompact,
              sourceOfTruth: row.sourceOfTruth,
              effectiveAt: capturedAt,
              lastSeenAt: capturedAt,
            },
            types: {
              objectId: { type: "string" },
              recordPhase: { type: "string" },
              candidateId: { type: "string" },
              candidateName: { type: "string" },
              candidateEmail: { type: "string" },
              novaProfileUrl: { type: "string" },
              jobId: { type: "string" },
              marginId: { type: "string" },
              facilityName: { type: "string" },
              profession: { type: "string" },
              specialty: { type: "string" },
              shiftType: { type: "string" },
              shiftStartHhmm: { type: "string" },
              shiftEndHhmm: { type: "string" },
              weeklyHours: { type: "int64" },
              startDate: { type: "date" },
              endDate: { type: "date" },
              targetMarginPct: { type: "numeric" },
              actualMarginPct: { type: "numeric" },
              basePayRateUsd: { type: "numeric" },
              weeklyStipendsUsd: { type: "numeric" },
              grossWeeklyPayUsd: { type: "numeric" },
              grossWeeklyPayComputedUsd: { type: "numeric" },
              isLocal: { type: "bool" },
              isCompact: { type: "bool" },
              sourceOfTruth: { type: "string" },
              effectiveAt: { type: "timestamp" },
              lastSeenAt: { type: "timestamp" },
            },
          });
          canonicalWriteStatus = "inserted";
          upserted += 1;
        } else {
          const changed = canonicalFieldsChanged(existing, row);
          await tx.runUpdate({
            sql: `UPDATE margin_objects
                  SET record_phase = @recordPhase,
                      candidate_id = @candidateId,
                      candidate_name = @candidateName,
                      candidate_email = @candidateEmail,
                      nova_profile_url = @novaProfileUrl,
                      job_id = @jobId,
                      margin_id = @marginId,
                      facility_name = @facilityName,
                      profession = @profession,
                      specialty = @specialty,
                      shift_type = @shiftType,
                      shift_start_hhmm = @shiftStartHhmm,
                      shift_end_hhmm = @shiftEndHhmm,
                      weekly_hours = @weeklyHours,
                      start_date = @startDate,
                      end_date = @endDate,
                      target_margin_pct = @targetMarginPct,
                      actual_margin_pct = @actualMarginPct,
                      base_pay_rate_usd = @basePayRateUsd,
                      weekly_stipends_usd = @weeklyStipendsUsd,
                      gross_weekly_pay_usd = @grossWeeklyPayUsd,
                      gross_weekly_pay_computed_usd = @grossWeeklyPayComputedUsd,
                      is_local = @isLocal,
                      is_compact = @isCompact,
                      source_of_truth = @sourceOfTruth,
                      current_flag = TRUE,
                      effective_at = CASE WHEN @isChanged THEN @effectiveAt ELSE effective_at END,
                      last_seen_at = @lastSeenAt,
                      updated_at = PENDING_COMMIT_TIMESTAMP()
                  WHERE margin_object_id = @objectId`,
            params: {
              objectId: row.marginObjectId,
              recordPhase: row.recordPhase,
              candidateId: row.candidateId,
              candidateName: row.candidateName,
              candidateEmail: row.candidateEmail,
              novaProfileUrl: row.novaProfileUrl,
              jobId: row.jobId,
              marginId: row.marginId,
              facilityName: row.facilityName,
              profession: row.profession,
              specialty: row.specialty,
              shiftType: row.shiftType,
              shiftStartHhmm: row.shiftStartHhmm,
              shiftEndHhmm: row.shiftEndHhmm,
              weeklyHours: row.weeklyHours,
              startDate: row.startDate,
              endDate: row.endDate,
              targetMarginPct: toSpannerNumeric(row.targetMarginPct),
              actualMarginPct: toSpannerNumeric(row.actualMarginPct),
              basePayRateUsd: toSpannerNumeric(row.basePayRateUsd),
              weeklyStipendsUsd: toSpannerNumeric(row.weeklyStipendsUsd),
              grossWeeklyPayUsd: toSpannerNumeric(row.grossWeeklyPayUsd),
              grossWeeklyPayComputedUsd: toSpannerNumeric(row.grossWeeklyPayComputedUsd),
              isLocal: row.isLocal,
              isCompact: row.isCompact,
              sourceOfTruth: row.sourceOfTruth,
              isChanged: changed,
              effectiveAt: capturedAt,
              lastSeenAt: capturedAt,
            },
            types: {
              objectId: { type: "string" },
              recordPhase: { type: "string" },
              candidateId: { type: "string" },
              candidateName: { type: "string" },
              candidateEmail: { type: "string" },
              novaProfileUrl: { type: "string" },
              jobId: { type: "string" },
              marginId: { type: "string" },
              facilityName: { type: "string" },
              profession: { type: "string" },
              specialty: { type: "string" },
              shiftType: { type: "string" },
              shiftStartHhmm: { type: "string" },
              shiftEndHhmm: { type: "string" },
              weeklyHours: { type: "int64" },
              startDate: { type: "date" },
              endDate: { type: "date" },
              targetMarginPct: { type: "numeric" },
              actualMarginPct: { type: "numeric" },
              basePayRateUsd: { type: "numeric" },
              weeklyStipendsUsd: { type: "numeric" },
              grossWeeklyPayUsd: { type: "numeric" },
              grossWeeklyPayComputedUsd: { type: "numeric" },
              isLocal: { type: "bool" },
              isCompact: { type: "bool" },
              sourceOfTruth: { type: "string" },
              isChanged: { type: "bool" },
              effectiveAt: { type: "timestamp" },
              lastSeenAt: { type: "timestamp" },
            },
          });
          canonicalWriteStatus = changed ? "updated" : "no_change";
          if (changed) updated += 1;
          else noChange += 1;
        }

        if (row.jobId) {
          const [existingJobRows] = await tx.run({
            sql: `SELECT id, facility_id, vms_provider, description, open_positions
                  FROM ll_jobs
                  WHERE external_job_id = @externalJobId
                  LIMIT 1`,
            params: { externalJobId: row.jobId },
            types: { externalJobId: { type: "string" } },
          });

          const existingJob = asRecord(existingJobRows[0]?.toJSON());
          const defaultVmsProvider = "Aya Healthcare MSP";
          const inferredDescription = buildLlJobDescription(row);

          if (!existingJob) {
            await tx.runUpdate({
              sql: `INSERT INTO ll_jobs (
                      id,
                      external_job_id,
                      facility_id,
                      vms_provider,
                      description,
                      open_positions,
                      created_at,
                      updated_at
                    ) VALUES (
                      @id,
                      @externalJobId,
                      NULL,
                      @vmsProvider,
                      @description,
                      @openPositions,
                      PENDING_COMMIT_TIMESTAMP(),
                      PENDING_COMMIT_TIMESTAMP()
                    )`,
              params: {
                id: buildLlJobRecordId(row.jobId),
                externalJobId: row.jobId,
                vmsProvider: defaultVmsProvider,
                description: inferredDescription,
                openPositions: 1,
              },
              types: {
                id: { type: "string" },
                externalJobId: { type: "string" },
                vmsProvider: { type: "string" },
                description: { type: "string" },
                openPositions: { type: "int64" },
              },
            });
            jobsInserted += 1;
          } else {
            const nextVmsProvider = normalizeNullableString(existingJob.vms_provider) || defaultVmsProvider;
            const nextDescription = normalizeNullableString(existingJob.description) || inferredDescription;
            const existingOpenPositions = readNumber(existingJob.open_positions);
            const nextOpenPositions =
              existingOpenPositions && existingOpenPositions > 0
                ? Math.floor(existingOpenPositions)
                : 1;

            const jobChanged =
              normalizeNullableString(existingJob.vms_provider) !== nextVmsProvider ||
              normalizeNullableString(existingJob.description) !== nextDescription ||
              existingOpenPositions !== nextOpenPositions;

            if (jobChanged) {
              await tx.runUpdate({
                sql: `UPDATE ll_jobs
                      SET vms_provider = @vmsProvider,
                          description = @description,
                          open_positions = @openPositions,
                          updated_at = PENDING_COMMIT_TIMESTAMP()
                      WHERE external_job_id = @externalJobId`,
                params: {
                  externalJobId: row.jobId,
                  vmsProvider: nextVmsProvider,
                  description: nextDescription,
                  openPositions: nextOpenPositions,
                },
                types: {
                  externalJobId: { type: "string" },
                  vmsProvider: { type: "string" },
                  description: { type: "string" },
                  openPositions: { type: "int64" },
                },
              });
              jobsUpdated += 1;
            }
          }
        }
      } else {
        failedValidation += 1;
      }

      const validationJson = JSON.stringify([
        ...normalizedResult.errors,
        ...normalizedResult.warnings,
      ]);

      await tx.runUpdate({
        sql: `INSERT INTO margin_capture_links (
                event_id, margin_object_id, position_index, raw_text, raw_json,
                confidence, source_record_type, canonical_write_status, validation_errors_json,
                captured_at, created_at
              ) VALUES (
                @eventId, @objectId, @positionIndex, @rawText,
                CASE WHEN @rawJson IS NULL THEN NULL ELSE PARSE_JSON(@rawJson) END,
                @confidence, @sourceRecordType, @canonicalWriteStatus,
                CASE WHEN @validationJson IS NULL THEN NULL ELSE PARSE_JSON(@validationJson) END,
                @capturedAt, PENDING_COMMIT_TIMESTAMP()
              )`,
        params: {
          eventId,
          objectId: row.marginObjectId,
          positionIndex: i + 1,
          rawText: row.rawText,
          rawJson: row.rawJson,
          confidence: toSpannerNumeric(row.confidence),
          sourceRecordType: row.sourceRecordType,
          canonicalWriteStatus,
          validationJson,
          capturedAt,
        },
        types: {
          eventId: { type: "string" },
          objectId: { type: "string" },
          positionIndex: { type: "int64" },
          rawText: { type: "string" },
          rawJson: { type: "string" },
          confidence: { type: "numeric" },
          sourceRecordType: { type: "string" },
          canonicalWriteStatus: { type: "string" },
          validationJson: { type: "string" },
          capturedAt: { type: "timestamp" },
        },
      });
    }

    await tx.commit();
    return {
      eventId,
      upserted,
      updated,
      noChange,
      failedValidation,
      jobsInserted,
      jobsUpdated,
      linksInserted: normalizedResults.length,
    };
  });

  return {
    event_id: txResult.eventId,
    object_id_format: "AYA.OBJ.MARGIN.<CANDIDATE_KEY>.<MARGIN_ID_OR_JOB_ID>",
    event_id_format: "AYA.EVT.MARGIN_CAPTURE.<YYYYMMDD>.<SEQ>",
    rows_captured: rows.length,
    canonical_upserted: txResult.upserted,
    canonical_updated: txResult.updated,
    canonical_no_change: txResult.noChange,
    canonical_failed_validation: txResult.failedValidation,
    jobs_inserted: txResult.jobsInserted,
    jobs_updated: txResult.jobsUpdated,
    links_inserted: txResult.linksInserted,
    captured_at: capturedAt.toISOString(),
    normalization_rules: {
      currency_strings: "parsed to *_usd numeric fields",
      percent_strings: "parsed to decimal fractions",
      blank_strings: "normalized to null",
      yes_no_flags: "normalized to booleans",
      dates: "normalized to ISO YYYY-MM-DD",
      shift_type_enum: [...SHIFT_TYPE_ENUM],
    },
    invalid_rows: invalidRows,
  };
}

export async function queryMarginLedger(input: MarginLedgerQueryInput) {
  const marginObjectId = readString(input.margin_object_id);
  const candidateId = readString(input.candidate_id);
  const candidateName = readString(input.candidate_name);
  const marginId = readString(input.margin_id);
  const jobId = readString(input.job_id);
  const facilityName = readString(input.facility_name);
  const profession = readString(input.profession);
  const specialty = readString(input.specialty);
  const eventId = readString(input.event_id);
  const sourceKind = readString(input.source_kind);
  const viewType = readString(input.view_type);
  const includeProvenance = Boolean(input.include_provenance);
  const limit = normalizeLimit(input.limit, 100, 1, 1000);
  const eventLimit = normalizeLimit(input.event_limit, 50, 1, 500);

  const response: {
    filters: Record<string, unknown>;
    objects: MarginObjectRecord[];
    events: MarginCaptureEventRecord[];
    links: MarginCaptureLinkRecord[];
  } = {
    filters: {
      margin_object_id: marginObjectId || null,
      candidate_id: candidateId || null,
      candidate_name: candidateName || null,
      margin_id: marginId || null,
      job_id: jobId || null,
      facility_name: facilityName || null,
      profession: profession || null,
      specialty: specialty || null,
      event_id: eventId || null,
      source_kind: sourceKind || null,
      view_type: viewType || null,
      include_provenance: includeProvenance,
      limit,
      event_limit: eventLimit,
    },
    objects: [],
    events: [],
    links: [],
  };

  if (eventId) {
    const [eventRows] = await recruitingDb.run({
      sql: `SELECT event_id, view_type, captured_at, source_kind, source_url,
                   screenshot_id, rows_captured, captured_by, notes, created_at
            FROM margin_capture_events
            WHERE event_id = @eventId
            LIMIT 1`,
      params: { eventId },
      types: { eventId: { type: "string" } },
    });
    response.events = eventRows.map((row: any) => mapEventRecord(asRecord(row.toJSON()) || {}));

    const [linkRows] = await recruitingDb.run({
      sql: `SELECT event_id, margin_object_id, position_index, raw_text, raw_json, confidence,
                   source_record_type, canonical_write_status, validation_errors_json, captured_at, created_at
            FROM margin_capture_links
            WHERE event_id = @eventId
            ORDER BY position_index
            LIMIT @lim`,
      params: { eventId, lim: limit },
      types: {
        eventId: { type: "string" },
        lim: { type: "int64" },
      },
    });
    response.links = linkRows.map((row: any) => mapLinkRecord(asRecord(row.toJSON()) || {}));

    const objectIds = Array.from(new Set(response.links.map((link) => link.margin_object_id)));
    if (objectIds.length > 0) {
      const [objectRows] = await recruitingDb.run({
        sql: `SELECT margin_object_id, candidate_id, candidate_name, candidate_email, nova_profile_url,
                     job_id, margin_id, facility_name, profession, specialty, shift_type, shift_start_hhmm, shift_end_hhmm, weekly_hours,
                     start_date, end_date, target_margin_pct, actual_margin_pct, base_pay_rate_usd,
                     weekly_stipends_usd, gross_weekly_pay_usd, gross_weekly_pay_computed_usd,
                     is_local, is_compact, source_of_truth, current_flag, effective_at, last_seen_at,
                     created_at, updated_at
              FROM margin_objects
              WHERE margin_object_id IN UNNEST(@objectIds)
              LIMIT @lim`,
        params: { objectIds, lim: limit },
        types: {
          objectIds: { type: "array", child: { type: "string" } },
          lim: { type: "int64" },
        },
      });
      response.objects = objectRows.map((row: any) => mapMarginObjectRecord(asRecord(row.toJSON()) || {}));
    }
    return response;
  }

  const eventWhere: string[] = [];
  const eventParams: Record<string, unknown> = { lim: eventLimit };
  const eventTypes: Record<string, unknown> = { lim: { type: "int64" } };

  if (sourceKind) {
    eventWhere.push("source_kind = @sourceKind");
    eventParams.sourceKind = sourceKind;
    eventTypes.sourceKind = { type: "string" };
  }
  if (viewType) {
    eventWhere.push("view_type = @viewType");
    eventParams.viewType = viewType;
    eventTypes.viewType = { type: "string" };
  }

  const [eventRows] = await recruitingDb.run({
    sql: `SELECT event_id, view_type, captured_at, source_kind, source_url,
                 screenshot_id, rows_captured, captured_by, notes, created_at
          FROM margin_capture_events
          ${eventWhere.length ? `WHERE ${eventWhere.join(" AND ")}` : ""}
          ORDER BY captured_at DESC
          LIMIT @lim`,
    params: eventParams,
    types: eventTypes,
  });
  response.events = eventRows.map((row: any) => mapEventRecord(asRecord(row.toJSON()) || {}));

  const objectWhere: string[] = ["o.current_flag = TRUE", "o.record_phase = 'margin'"];
  const objectParams: Record<string, unknown> = { lim: limit };
  const objectTypes: Record<string, unknown> = { lim: { type: "int64" } };

  if (marginObjectId) {
    objectWhere.push("o.margin_object_id = @marginObjectId");
    objectParams.marginObjectId = marginObjectId;
    objectTypes.marginObjectId = { type: "string" };
  }
  if (candidateId) {
    objectWhere.push("o.candidate_id = @candidateId");
    objectParams.candidateId = candidateId;
    objectTypes.candidateId = { type: "string" };
  }
  if (candidateName) {
    objectWhere.push("LOWER(o.candidate_name) LIKE LOWER(@candidateName)");
    objectParams.candidateName = `%${candidateName}%`;
    objectTypes.candidateName = { type: "string" };
  }
  if (marginId) {
    objectWhere.push("o.margin_id = @marginId");
    objectParams.marginId = marginId;
    objectTypes.marginId = { type: "string" };
  }
  if (jobId) {
    objectWhere.push("o.job_id = @jobId");
    objectParams.jobId = jobId;
    objectTypes.jobId = { type: "string" };
  }
  if (facilityName) {
    objectWhere.push("LOWER(o.facility_name) LIKE LOWER(@facilityName)");
    objectParams.facilityName = `%${facilityName}%`;
    objectTypes.facilityName = { type: "string" };
  }
  if (profession) {
    objectWhere.push("LOWER(o.profession) LIKE LOWER(@profession)");
    objectParams.profession = `%${profession}%`;
    objectTypes.profession = { type: "string" };
  }
  if (specialty) {
    objectWhere.push("LOWER(o.specialty) LIKE LOWER(@specialty)");
    objectParams.specialty = `%${specialty}%`;
    objectTypes.specialty = { type: "string" };
  }

  const applyEventFilters = sourceKind || viewType;
  const sql = applyEventFilters
    ? `SELECT DISTINCT
          o.margin_object_id, o.candidate_id, o.candidate_name, o.candidate_email, o.nova_profile_url,
          o.job_id, o.margin_id, o.facility_name, o.profession, o.specialty, o.shift_type, o.shift_start_hhmm, o.shift_end_hhmm, o.weekly_hours,
          o.start_date, o.end_date, o.target_margin_pct, o.actual_margin_pct, o.base_pay_rate_usd,
          o.weekly_stipends_usd, o.gross_weekly_pay_usd, o.gross_weekly_pay_computed_usd, o.is_local,
          o.is_compact, o.source_of_truth, o.current_flag, o.effective_at, o.last_seen_at, o.created_at, o.updated_at
       FROM margin_capture_events e
       JOIN margin_capture_links l ON l.event_id = e.event_id
       JOIN margin_objects o ON o.margin_object_id = l.margin_object_id
       WHERE ${[
         ...eventWhere.map((clause) => `e.${clause}`),
         ...objectWhere,
       ].join(" AND ")}
       ORDER BY o.last_seen_at DESC
       LIMIT @lim`
    : `SELECT
          o.margin_object_id, o.candidate_id, o.candidate_name, o.candidate_email, o.nova_profile_url,
          o.job_id, o.margin_id, o.facility_name, o.profession, o.specialty, o.shift_type, o.shift_start_hhmm, o.shift_end_hhmm, o.weekly_hours,
          o.start_date, o.end_date, o.target_margin_pct, o.actual_margin_pct, o.base_pay_rate_usd,
          o.weekly_stipends_usd, o.gross_weekly_pay_usd, o.gross_weekly_pay_computed_usd, o.is_local,
          o.is_compact, o.source_of_truth, o.current_flag, o.effective_at, o.last_seen_at, o.created_at, o.updated_at
       FROM margin_objects o
       WHERE ${objectWhere.join(" AND ")}
       ORDER BY o.last_seen_at DESC
       LIMIT @lim`;

  const [objectRows] = await recruitingDb.run({
    sql,
    params: applyEventFilters ? { ...eventParams, ...objectParams } : objectParams,
    types: applyEventFilters ? { ...eventTypes, ...objectTypes } : objectTypes,
  });

  response.objects = objectRows.map((row: any) => mapMarginObjectRecord(asRecord(row.toJSON()) || {}));

  if (includeProvenance && response.objects.length > 0) {
    const objectIds = response.objects.map((object) => object.margin_object_id);
    const [linkRows] = await recruitingDb.run({
      sql: `SELECT event_id, margin_object_id, position_index, raw_text, raw_json, confidence,
                   source_record_type, canonical_write_status, validation_errors_json, captured_at, created_at
            FROM margin_capture_links
            WHERE margin_object_id IN UNNEST(@objectIds)
            ORDER BY captured_at DESC
            LIMIT @lim`,
      params: { objectIds, lim: limit * 2 },
      types: {
        objectIds: { type: "array", child: { type: "string" } },
        lim: { type: "int64" },
      },
    });
    response.links = linkRows.map((row: any) => mapLinkRecord(asRecord(row.toJSON()) || {}));
  }

  return response;
}

// ─── Job Board: Query unattached jobs ────────────────────────────────
export async function queryJobBoard(input: { limit?: number }) {
  const limit = normalizeLimit(input.limit, 100, 1, 500);

  const [rows] = await recruitingDb.run({
    sql: `SELECT margin_object_id, record_phase, candidate_id, candidate_name, candidate_email, nova_profile_url,
                 job_id, margin_id, facility_name, profession, specialty, shift_type, shift_start_hhmm, shift_end_hhmm, weekly_hours,
                 start_date, end_date, target_margin_pct, actual_margin_pct, base_pay_rate_usd,
                 weekly_stipends_usd, gross_weekly_pay_usd, gross_weekly_pay_computed_usd, is_local,
                 is_compact, source_of_truth, current_flag, effective_at, last_seen_at, created_at, updated_at
          FROM margin_objects
          WHERE record_phase = 'job' AND current_flag = TRUE
          ORDER BY created_at DESC
          LIMIT @lim`,
    params: { lim: limit },
    types: { lim: { type: "int64" } },
  });

  return {
    objects: rows.map((row: any) => mapMarginObjectRecord(asRecord(row.toJSON()) || {})),
  };
}

// ─── Attach Candidate to Job (versioned promotion) ──────────────────
export interface AttachCandidateInput {
  margin_object_id: string;
  candidate_id?: string | null;
  candidate_name?: string | null;
  candidate_email?: string | null;
  nova_profile_url?: string | null;
}

export async function attachCandidateToJob(input: AttachCandidateInput) {
  const marginObjectId = readString(input.margin_object_id);
  if (!marginObjectId) {
    throw new Error("margin_object_id is required");
  }

  const candidateId = normalizeNullableString(input.candidate_id) || null;
  const candidateName = normalizeNullableString(input.candidate_name) || null;
  if (!candidateId && !candidateName) {
    throw new Error("candidate_id or candidate_name is required to attach");
  }

  const candidateEmail = normalizeNullableString(input.candidate_email) || null;
  const novaProfileUrl =
    normalizeNullableString(input.nova_profile_url) ||
    (candidateId
      ? `https://nova.ayahealthcare.com/#/recruiting/candidates/${encodeURIComponent(candidateId)}/new-profile/about`
      : null);

  const now = new Date();

  const result = await recruitingDb.runTransactionAsync(async (tx: any) => {
    // 1. Fetch the existing job record
    const [existingRows] = await tx.run({
      sql: `SELECT margin_object_id, record_phase, candidate_id, candidate_name, candidate_email, nova_profile_url,
                   job_id, margin_id, facility_name, profession, specialty, shift_type, shift_start_hhmm, shift_end_hhmm, weekly_hours,
                   start_date, end_date, target_margin_pct, actual_margin_pct, base_pay_rate_usd,
                   weekly_stipends_usd, gross_weekly_pay_usd, gross_weekly_pay_computed_usd, is_local,
                   is_compact, source_of_truth, current_flag, effective_at, last_seen_at, created_at, updated_at
            FROM margin_objects
            WHERE margin_object_id = @objectId AND current_flag = TRUE
            LIMIT 1`,
      params: { objectId: marginObjectId },
      types: { objectId: { type: "string" } },
    });

    const existing = asRecord(existingRows[0]?.toJSON());
    if (!existing) {
      throw new Error(`Job record not found: ${marginObjectId}`);
    }

    if (readString(existing.record_phase) === "margin") {
      throw new Error(`Record is already a margin (already has candidate attached): ${marginObjectId}`);
    }

    // 2. Mark the old job row as non-current (preserves history)
    await tx.runUpdate({
      sql: `UPDATE margin_objects
            SET current_flag = FALSE,
                updated_at = PENDING_COMMIT_TIMESTAMP()
            WHERE margin_object_id = @objectId AND current_flag = TRUE`,
      params: { objectId: marginObjectId },
      types: { objectId: { type: "string" } },
    });

    // 3. Build new margin identity with candidate context
    const jobId = normalizeNullableString(existing.job_id) || null;
    const marginId = normalizeNullableString(existing.margin_id) || null;
    const facilityName = normalizeNullableString(existing.facility_name) || null;
    const profession = normalizeNullableString(existing.profession) || null;

    const identity = buildMarginObjectIdentity({
      candidateId,
      candidateName,
      marginId,
      jobId,
      facilityName,
      profession,
      rowIndex: 0,
      recordPhase: "margin",
    });

    // 4. Insert new margin row (versioned promotion)
    await tx.runUpdate({
      sql: `INSERT INTO margin_objects (
              margin_object_id, record_phase, candidate_id, candidate_name, candidate_email, nova_profile_url,
              job_id, margin_id, facility_name, profession, specialty, shift_type,
              shift_start_hhmm, shift_end_hhmm, weekly_hours, start_date, end_date, target_margin_pct, actual_margin_pct,
              base_pay_rate_usd, weekly_stipends_usd, gross_weekly_pay_usd,
              gross_weekly_pay_computed_usd, is_local, is_compact, source_of_truth,
              current_flag, effective_at, last_seen_at, created_at, updated_at
            ) VALUES (
              @newObjectId, 'margin', @candidateId, @candidateName, @candidateEmail, @novaProfileUrl,
              @jobId, @marginId, @facilityName, @profession, @specialty, @shiftType,
              @shiftStartHhmm, @shiftEndHhmm, @weeklyHours, @startDate, @endDate, @targetMarginPct, @actualMarginPct,
              @basePayRateUsd, @weeklyStipendsUsd, @grossWeeklyPayUsd,
              @grossWeeklyPayComputedUsd, @isLocal, @isCompact, @sourceOfTruth,
              TRUE, @effectiveAt, @lastSeenAt, PENDING_COMMIT_TIMESTAMP(), PENDING_COMMIT_TIMESTAMP()
            )`,
      params: {
        newObjectId: identity.objectId,
        candidateId,
        candidateName,
        candidateEmail,
        novaProfileUrl,
        jobId,
        marginId,
        facilityName,
        profession: profession,
        specialty: normalizeNullableString(existing.specialty),
        shiftType: normalizeNullableString(existing.shift_type),
        shiftStartHhmm: normalizeNullableString(existing.shift_start_hhmm),
        shiftEndHhmm: normalizeNullableString(existing.shift_end_hhmm),
        weeklyHours: readNumber(existing.weekly_hours),
        startDate: normalizeNullableString(existing.start_date),
        endDate: normalizeNullableString(existing.end_date),
        targetMarginPct: toSpannerNumeric(readNumber(existing.target_margin_pct)),
        actualMarginPct: toSpannerNumeric(readNumber(existing.actual_margin_pct)),
        basePayRateUsd: toSpannerNumeric(readNumber(existing.base_pay_rate_usd)),
        weeklyStipendsUsd: toSpannerNumeric(readNumber(existing.weekly_stipends_usd)),
        grossWeeklyPayUsd: toSpannerNumeric(readNumber(existing.gross_weekly_pay_usd)),
        grossWeeklyPayComputedUsd: toSpannerNumeric(readNumber(existing.gross_weekly_pay_computed_usd)),
        isLocal: readBoolean(existing.is_local),
        isCompact: readBoolean(existing.is_compact),
        sourceOfTruth: readString(existing.source_of_truth) || "browser_capture",
        effectiveAt: now,
        lastSeenAt: now,
      },
      types: {
        newObjectId: { type: "string" },
        candidateId: { type: "string" },
        candidateName: { type: "string" },
        candidateEmail: { type: "string" },
        novaProfileUrl: { type: "string" },
        jobId: { type: "string" },
        marginId: { type: "string" },
        facilityName: { type: "string" },
        profession: { type: "string" },
        specialty: { type: "string" },
        shiftType: { type: "string" },
        shiftStartHhmm: { type: "string" },
        shiftEndHhmm: { type: "string" },
        weeklyHours: { type: "int64" },
        startDate: { type: "date" },
        endDate: { type: "date" },
        targetMarginPct: { type: "numeric" },
        actualMarginPct: { type: "numeric" },
        basePayRateUsd: { type: "numeric" },
        weeklyStipendsUsd: { type: "numeric" },
        grossWeeklyPayUsd: { type: "numeric" },
        grossWeeklyPayComputedUsd: { type: "numeric" },
        isLocal: { type: "bool" },
        isCompact: { type: "bool" },
        sourceOfTruth: { type: "string" },
        effectiveAt: { type: "timestamp" },
        lastSeenAt: { type: "timestamp" },
      },
    });

    return {
      previous_object_id: marginObjectId,
      new_object_id: identity.objectId,
      record_phase: "margin" as const,
      candidate_id: candidateId,
      candidate_name: candidateName,
    };
  });

  return result;
}

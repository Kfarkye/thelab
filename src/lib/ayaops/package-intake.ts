import type { MarginCaptureRowInput } from "@/lib/ayaops/margin-ledger";

export type PackageSourceType = "image_upload" | "pasted_text" | "manual" | "ai_parsed";

export type ExtractedPackage = {
  facility_name: string | null;
  profession: string | null;
  specialty: string | null;
  title: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  pay_min: number | null;
  pay_max: number | null;
  start_date: string | null;
  end_date: string | null;
  duration_weeks: number | null;
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
  flags: string[];
};

export type PackageFieldConfidence = {
  facility_name: number;
  specialty: number;
  dates: number;
  pay: number;
  shift: number;
};

export type PackageParseResult = {
  extracted_package: ExtractedPackage;
  confidence: PackageFieldConfidence;
  missing_fields: string[];
  needs_review: boolean;
};

export const PACKAGE_PARSE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    extracted_package: {
      type: "object",
      properties: {
        facility_name: { type: "string" },
        profession: { type: "string" },
        specialty: { type: "string" },
        title: { type: "string" },
        city: { type: "string" },
        state: { type: "string" },
        zip: { type: "string" },
        lat: { type: "number" },
        lng: { type: "number" },
        pay_min: { type: "number" },
        pay_max: { type: "number" },
        start_date: { type: "string" },
        end_date: { type: "string" },
        duration_weeks: { type: "number" },
        shift_label: { type: "string" },
        shift_start: { type: "string" },
        shift_end: { type: "string" },
        weekly_hours: { type: "number" },
        schedule: { type: "string" },
        weekly_gross: { type: "number" },
        taxable_hourly_rate: { type: "number" },
        weekly_stipends: { type: "number" },
        meals_stipend: { type: "number" },
        housing_stipend: { type: "number" },
        job_description: { type: "string" },
        requirements: { type: "array", items: { type: "string" } },
        notes: { type: "array", items: { type: "string" } },
        flags: { type: "array", items: { type: "string" } },
      },
    },
    confidence: {
      type: "object",
      properties: {
        facility_name: { type: "number" },
        specialty: { type: "number" },
        dates: { type: "number" },
        pay: { type: "number" },
        shift: { type: "number" },
      },
    },
    missing_fields: { type: "array", items: { type: "string" } },
    needs_review: { type: "boolean" },
  },
  required: ["extracted_package", "missing_fields", "needs_review"],
} as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /^(null|n\/a|na|none|--|pending)$/i.test(trimmed)) return null;
  return trimmed;
}

function cleanArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => cleanString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function cleanNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function cleanConfidence(value: unknown): number {
  const parsed = cleanNumber(value);
  if (parsed == null) return 0;
  return Math.max(0, Math.min(1, parsed));
}

function normalizeDate(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function normalizeTime(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  const direct = text.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (direct) return `${direct[1].padStart(2, "0")}:${direct[2]}`;
  const twelveHour = text.match(/^(\d{1,2})(?::([0-5]\d))?\s*(a|am|p|pm)$/i);
  if (!twelveHour) return text;
  let hour = Number(twelveHour[1]);
  const minute = twelveHour[2] || "00";
  const meridiem = twelveHour[3].toLowerCase();
  if (meridiem.startsWith("p") && hour < 12) hour += 12;
  if (meridiem.startsWith("a") && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function inferMissingFields(pkg: ExtractedPackage): string[] {
  const missing: string[] = [];
  if (!pkg.facility_name) missing.push("facility_name");
  if (!pkg.specialty && !pkg.profession && !pkg.title) missing.push("specialty");
  if (!pkg.city) missing.push("city");
  if (!pkg.state) missing.push("state");
  if (!pkg.start_date || !pkg.end_date) missing.push("dates");
  if (pkg.weekly_gross == null) missing.push("weekly_gross");
  if (pkg.taxable_hourly_rate == null) missing.push("taxable_hourly_rate");
  if (pkg.weekly_stipends == null) missing.push("weekly_stipends");
  if (!pkg.schedule && pkg.weekly_hours == null) missing.push("schedule");
  if (!pkg.job_description) missing.push("job_description");
  if (pkg.requirements.length === 0) missing.push("requirements");
  return missing;
}

export function normalizePackageParseResult(value: unknown): PackageParseResult {
  const root = asRecord(value);
  const rawPackage = asRecord(root.extracted_package || root.package || root);
  const rawConfidence = asRecord(root.confidence);
  const extractedPackage: ExtractedPackage = {
    facility_name: cleanString(rawPackage.facility_name),
    profession: cleanString(rawPackage.profession),
    specialty: cleanString(rawPackage.specialty),
    title: cleanString(rawPackage.title),
    city: cleanString(rawPackage.city),
    state: cleanString(rawPackage.state),
    zip: cleanString(rawPackage.zip),
    lat: cleanNumber(rawPackage.lat),
    lng: cleanNumber(rawPackage.lng),
    pay_min: cleanNumber(rawPackage.pay_min),
    pay_max: cleanNumber(rawPackage.pay_max),
    start_date: normalizeDate(rawPackage.start_date),
    end_date: normalizeDate(rawPackage.end_date),
    duration_weeks: cleanNumber(rawPackage.duration_weeks),
    shift_label: cleanString(rawPackage.shift_label),
    shift_start: normalizeTime(rawPackage.shift_start),
    shift_end: normalizeTime(rawPackage.shift_end),
    weekly_hours: cleanNumber(rawPackage.weekly_hours),
    schedule: cleanString(rawPackage.schedule),
    weekly_gross: cleanNumber(rawPackage.weekly_gross),
    taxable_hourly_rate: cleanNumber(rawPackage.taxable_hourly_rate),
    weekly_stipends: cleanNumber(rawPackage.weekly_stipends),
    meals_stipend: cleanNumber(rawPackage.meals_stipend),
    housing_stipend: cleanNumber(rawPackage.housing_stipend),
    job_description: cleanString(rawPackage.job_description),
    requirements: cleanArray(rawPackage.requirements),
    notes: cleanArray(rawPackage.notes),
    flags: cleanArray(rawPackage.flags),
  };
  const inferredMissing = inferMissingFields(extractedPackage);
  const providedMissing = cleanArray(root.missing_fields);
  const missingFields = Array.from(new Set([...providedMissing, ...inferredMissing]));

  return {
    extracted_package: extractedPackage,
    confidence: {
      facility_name: cleanConfidence(rawConfidence.facility_name),
      specialty: cleanConfidence(rawConfidence.specialty),
      dates: cleanConfidence(rawConfidence.dates),
      pay: cleanConfidence(rawConfidence.pay),
      shift: cleanConfidence(rawConfidence.shift),
    },
    missing_fields: missingFields,
    needs_review: typeof root.needs_review === "boolean" ? root.needs_review : true,
  };
}

function shiftTypeFromLabel(label: string | null): string | null {
  if (!label) return null;
  if (/night/i.test(label)) return "nights";
  if (/rotat/i.test(label)) return "rotating";
  if (/var/i.test(label)) return "variable";
  if (/day/i.test(label)) return "days";
  return "other";
}

export function buildPackageIngestRow(pkg: ExtractedPackage): MarginCaptureRowInput {
  const role = pkg.specialty || pkg.title || pkg.profession || null;
  const location = [pkg.city, pkg.state].filter(Boolean).join(", ");
  return {
    record_phase: "job",
    facility_name: pkg.facility_name,
    profession: pkg.profession || role,
    specialty: pkg.specialty || pkg.title || null,
    start_date: pkg.start_date,
    end_date: pkg.end_date,
    shift_type: shiftTypeFromLabel(pkg.shift_label),
    shift_start_time: pkg.shift_start,
    shift_end_time: pkg.shift_end,
    weekly_hours: pkg.weekly_hours,
    schedule: pkg.schedule,
    gross_weekly_pay_usd: pkg.weekly_gross,
    base_pay_rate_usd: pkg.taxable_hourly_rate,
    weekly_stipends_usd: pkg.weekly_stipends,
    meals_stipend_usd: pkg.meals_stipend,
    housing_stipend_usd: pkg.housing_stipend,
    pay_min: pkg.pay_min,
    pay_max: pkg.pay_max,
    duration_weeks: pkg.duration_weeks,
    job_description: pkg.job_description,
    requirements: pkg.requirements,
    notes: pkg.notes,
    flags: pkg.flags,
    location: location || null,
    city: pkg.city,
    state: pkg.state,
    zip: pkg.zip,
    lat: pkg.lat,
    lng: pkg.lng,
    raw_text: [
      role ? `${role} Assignment` : "Pay Package",
      pkg.facility_name ? `Facility: ${pkg.facility_name}` : null,
      pkg.start_date || pkg.end_date ? `Dates: ${pkg.start_date || "?"} to ${pkg.end_date || "?"}` : null,
      pkg.schedule || pkg.weekly_hours ? `Schedule: ${pkg.schedule || ""}${pkg.weekly_hours ? `, ${pkg.weekly_hours} hrs/week` : ""}` : null,
      pkg.shift_label || pkg.shift_start || pkg.shift_end ? `Shift: ${pkg.shift_label || ""} ${pkg.shift_start || ""}-${pkg.shift_end || ""}` : null,
      pkg.weekly_gross != null ? `Weekly Gross: $${pkg.weekly_gross}` : null,
      pkg.taxable_hourly_rate != null ? `Base Rate: $${pkg.taxable_hourly_rate}/hr` : null,
      pkg.weekly_stipends != null ? `Stipends: $${pkg.weekly_stipends}/wk` : null,
    ].filter(Boolean).join("\n"),
  };
}

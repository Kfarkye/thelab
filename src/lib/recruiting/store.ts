import { createHash } from "node:crypto";
import { getDb } from "@/lib/spanner-pool";
import { normalizeSpecialty, packageDurationWeeks } from "./engine";
import type { CandidateObject, PackageObject } from "./types";

const recruitingDb = getDb("recruitingdb");

function readString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => readString(entry))
      .filter((entry): entry is string => Boolean(entry));
  }
  const text = readString(value);
  if (!text) return [];
  return text
    .split(/[,;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeDate(value: unknown): string | null {
  const text = readString(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function prefixed(prefix: string, value: string): string {
  return value.startsWith(`${prefix}.`) ? value : `${prefix}.${value}`;
}

function parseSourceJson(value: unknown): Record<string, unknown> {
  const text = readString(value);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function packageIdFromRecord(input: {
  rawId?: string | null;
  jobId?: string | null;
  startDate?: string | null;
  facility?: string | null;
  specialty?: string | null;
}): string {
  const raw = readString(input.rawId);
  if (raw?.startsWith("AYA.PKG.")) return raw;
  const jobToken = readString(input.jobId) || createHash("sha1")
    .update([input.facility, input.specialty, raw].filter(Boolean).join("|"))
    .digest("hex")
    .slice(0, 10);
  const dateToken = (input.startDate || new Date().toISOString().slice(0, 10)).replace(/-/g, "");
  return `AYA.PKG.${jobToken}.${dateToken}.001`;
}

export function packageFromUnknown(value: unknown): PackageObject {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const source = parseSourceJson(input.source_raw_json);
  const facility = readString(input.facilityName || input.facility_name || input.facility);
  const specialty = readString(input.specialty || input.title || input.profession);
  const startDate = normalizeDate(input.assignmentStart || input.start_date || input.startDate);
  const endDate = normalizeDate(input.assignmentEnd || input.end_date || input.endDate);
  const weeklyGross = readNumber(input.weeklyGross || input.weekly_gross || input.gross_weekly_pay_usd);
  const basePay = readNumber(input.basePayRate || input.taxable_hourly_rate || input.base_pay_rate_usd);
  const stipend = readNumber(input.weeklyStipends || input.weekly_stipends || input.weekly_stipends_usd);
  const payValues = [weeklyGross, basePay, stipend].filter(
    (entry): entry is number => typeof entry === "number",
  );
  const state = readString(input.facilityState || input.state || input.location_state || source.state);
  const city = readString(input.facilityCity || input.city || input.location_city || source.city);
  const requirements = readList(input.requirements || input.jobRequirements || source.requirements);
  const notes = readList(input.notes || input.jobNotes || source.notes);
  const flags = readList(input.flags || source.flags);

  return {
    package_id: packageIdFromRecord({
      rawId: readString(input.payPackageId || input.package_id || input.marginObjectId || input.id),
      jobId: readString(input.jobId || input.job_id),
      startDate,
      facility,
      specialty,
    }),
    record_phase:
      input.recordPhase === "margin" || input.record_phase === "margin_created"
        ? "margin_created"
        : input.candidateName || input.candidate_id
          ? "candidate_attached"
          : "unattached",
    facility,
    specialty,
    normalized_specialty: specialty ? normalizeSpecialty(specialty) : null,
    location: {
      city,
      state,
      zip: readString(input.zip || input.location_zip || source.zip),
      lat: readNumber(input.lat || input.latitude || source.lat),
      lng: readNumber(input.lng || input.longitude || source.lng),
    },
    pay_range: {
      min: payValues.length ? Math.min(...payValues) : null,
      max: payValues.length ? Math.max(...payValues) : null,
    },
    weekly_gross: weeklyGross,
    shift: readString(input.shift || input.shiftType || input.shift_type),
    start_date: startDate,
    duration_weeks: readNumber(input.durationWeeks || input.duration_weeks) || packageDurationWeeks(startDate, endDate),
    job_description: readString(input.jobDescription || input.job_description || source.job_description),
    requirements,
    flags: [...flags, ...notes.map((note) => `Note: ${note}`)],
  };
}

export async function loadCandidatePool(input: {
  normalizedSpecialty?: string | null;
  state?: string | null;
  limit?: number;
}): Promise<CandidateObject[]> {
  const limit = Math.max(1, Math.min(Number(input.limit || 200), 500));
  const params: Record<string, unknown> = { lim: limit };
  const types: Record<string, unknown> = { lim: { type: "int64" } };
  const where: string[] = [];

  if (input.normalizedSpecialty) {
    where.push("(LOWER(COALESCE(c.specialty, '')) LIKE LOWER(@specialtyPattern) OR LOWER(COALESCE(c.profession, '')) LIKE LOWER(@specialtyPattern))");
    params.specialtyPattern = `%${input.normalizedSpecialty}%`;
    types.specialtyPattern = { type: "string" };
  }

  const [rows] = await recruitingDb.run({
    sql: `SELECT c.id, c.nova_id, c.first_name, c.last_name, c.specialty, c.profession,
                 c.home_state, c.compliance_risk_level, c.source,
                 (
                   SELECT MIN(SAFE_CAST(a1.start_date AS DATE))
                   FROM hc_assignments a1
                   WHERE a1.candidate_id = c.id
                     AND SAFE_CAST(a1.start_date AS DATE) >= CURRENT_DATE('America/Los_Angeles')
                 ) AS available_date
          FROM hc_candidates c
          ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY c.specialty, c.last_name
          LIMIT @lim`,
    params,
    types,
  });

  return rows.map((row: any) => {
    const data = row.toJSON();
    const id = readString(data.id) || "";
    const novaId = readString(data.nova_id);
    const name = [readString(data.first_name), readString(data.last_name)].filter(Boolean).join(" ").trim() || "Unknown Candidate";
    const specialty = readString(data.specialty) || readString(data.profession);
    const risk = String(data.compliance_risk_level || "").toLowerCase();
    const bucket: CandidateObject["bucket"] =
      /exclude|do not|dnu/.test(risk)
        ? "excluded"
        : /protect|hold|risk/.test(risk)
          ? "protected"
          : "claimable";

    return {
      candidate_id: prefixed("AYA.CAND", id),
      candidate_name: name,
      nova_url: novaId
        ? `https://nova.ayahealthcare.com/#/recruiting/candidates/${encodeURIComponent(novaId)}/new-profile/about`
        : "",
      specialty,
      normalized_specialty: specialty ? normalizeSpecialty(specialty) : null,
      home_city: null,
      home_state: readString(data.home_state),
      home_lat: null,
      home_lng: null,
      license_states: readList(data.home_state).map((entry) => entry.toUpperCase()),
      available_date: normalizeDate(data.available_date),
      bucket,
    };
  });
}

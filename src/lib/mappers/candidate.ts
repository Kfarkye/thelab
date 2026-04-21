// ── DB row → CandidateRecord mapper ─────────────────────────────
// Server-side only. Converts raw Spanner row to canonical object.

import type { CandidateRecord } from "@/lib/types/candidate";
import {
  normalizeSpecialty,
  normalizeAssignmentStatus,
  normalizeComplianceRisk,
} from "@/lib/normalize/candidate";

const NOVA_BASE = "https://nova.ayahealthcare.com/#/recruiting/candidates";

export function mapCandidateRow(row: Record<string, unknown>): CandidateRecord {
  const firstName = String(row.first_name || "").trim();
  const lastName = String(row.last_name || "").trim();
  const novaId = row.nova_id ? String(row.nova_id) : undefined;
  const rawSpecialty = row.specialty ? String(row.specialty) : undefined;
  const weeklyGross = row.weekly_gross ? Number(row.weekly_gross) : undefined;
  const hourlyRate = row.hourly_rate ? Number(row.hourly_rate) : undefined;
  const startDate = row.start_date ? String(row.start_date) : undefined;
  const endDate = row.end_date ? String(row.end_date) : undefined;

  const dbStatus = normalizeAssignmentStatus(
    row.assignment_status ? String(row.assignment_status) : undefined
  );

  // Derive current status from dates when DB status may be stale
  const derivedCurrentStatus = deriveCurrentStatus(dbStatus, startDate, endDate);

  return {
    id: String(row.id || ""),
    name: [firstName, lastName].filter(Boolean).join(" "),
    specialty: normalizeSpecialty(rawSpecialty),
    rawSpecialty,
    profession: row.profession ? String(row.profession) : undefined,
    facilityName: row.facility_name ? String(row.facility_name) : undefined,
    facilityCity: row.facility_city ? String(row.facility_city) : undefined,
    facilityState: row.facility_state ? String(row.facility_state) : undefined,
    assignmentStatus: dbStatus,
    derivedCurrentStatus,
    isStale: !!(derivedCurrentStatus && dbStatus && derivedCurrentStatus !== dbStatus),
    assignmentStart: startDate,
    assignmentEnd: endDate,
    homeState: row.home_state ? String(row.home_state) : undefined,
    weeklyGross: weeklyGross && isFinite(weeklyGross) ? weeklyGross : undefined,
    hourlyRate: hourlyRate && isFinite(hourlyRate) ? hourlyRate : undefined,
    complianceRisk: normalizeComplianceRisk(
      row.compliance_risk_level ? String(row.compliance_risk_level) : undefined
    ),
    source: row.source ? String(row.source) : undefined,
    novaId,
    novaUrl: novaId ? `${NOVA_BASE}/${novaId}/new-profile/about` : undefined,
    vmsPlatform: row.vms_platform ? String(row.vms_platform) : undefined,
    facilityBeds: row.facility_beds ? Number(row.facility_beds) : undefined,
    rcThreadUrl: row.rc_thread_url ? String(row.rc_thread_url) : undefined,
    outlookThreadUrl: row.outlook_thread_url ? String(row.outlook_thread_url) : undefined,
  };
}

// ── Date-derived status ─────────────────────────────────────────
// Reconciles raw DB status with reality based on today's date.
function deriveCurrentStatus(
  dbStatus?: string,
  startDate?: string,
  endDate?: string,
): string | undefined {
  // Preserve explicit non-timeline workflow states from DB.
  if (dbStatus && !["On Assignment", "Starting Soon"].includes(dbStatus)) {
    return dbStatus;
  }

  if (!startDate) return dbStatus;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : null;

  if (end && today > end) {
    return "Completed";
  }
  if (today >= start) {
    return "On Assignment";
  }
  // Start date is still in the future
  return dbStatus || "Starting Soon";
}

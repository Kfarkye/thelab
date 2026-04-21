import { createHash } from "node:crypto";
import { getRecruitingDb } from "@/lib/spanner-pool";

const NOVA_SESSION_TOKEN = process.env.NOVA_SESSION_TOKEN || "";
const NOVA_OFFERS_ENDPOINT = process.env.NOVA_OFFERS_ENDPOINT || "";
const NOVA_PROFILE_BASE =
  process.env.NOVA_PROFILE_BASE_URL ||
  "https://nova.ayahealthcare.com/#/recruiting/candidates";
const OFFER_SYNC_CACHE_TTL_MS = 5 * 60 * 1000;
const RAW_RESPONSE_JSON_MAX_CHARS = 900_000;

const recruitingDb = getRecruitingDb();

export const OFFER_STATUS_ENUM = [
  "new",
  "under_review",
  "extended",
  "verbally_accepted",
  "submitted",
  "declined",
  "rescinded",
  "contract_requested",
  "completed",
  "unknown",
] as const;

type OfferStatus = (typeof OFFER_STATUS_ENUM)[number];

const OFFER_STATUS_SET = new Set<string>([...OFFER_STATUS_ENUM]);

type OfferObjectRecord = {
  offer_id: string;
  candidate_id: string | null;
  candidate_name: string | null;
  candidate_email: string | null;
  nova_profile_url: string | null;
  job_id: string | null;
  margin_id: string | null;
  facility_name: string | null;
  profession: string | null;
  specialty: string | null;
  contract_type: string | null;
  offer_status: OfferStatus;
  verbally_accepted: boolean | null;
  assigned_recruiter: string | null;
  source_of_truth: string;
  current: boolean;
  effective_at: string | null;
  last_seen_at: string;
  created_at: string | null;
  updated_at: string | null;
};

type OfferCaptureEventRecord = {
  event_id: string;
  view_type: string | null;
  captured_at: string;
  source_kind: string;
  source_url: string | null;
  resource_type: string | null;
  request_method: string | null;
  endpoint_path: string | null;
  response_hash: string | null;
  rows_captured: number;
  captured_by: string | null;
  notes: string | null;
  created_at: string | null;
};

type OfferCaptureLinkRecord = {
  event_id: string;
  offer_id: string;
  position_index: number;
  raw_text: string | null;
  raw_json: Record<string, unknown> | null;
  confidence: number | null;
  screen_section: string | null;
  source_record_type: string;
  captured_at: string;
  created_at: string | null;
};

type NormalizedOfferRow = {
  offerId: string;
  candidateId: string | null;
  candidateName: string | null;
  candidateEmail: string | null;
  novaProfileUrl: string | null;
  jobId: string | null;
  marginId: string | null;
  facilityName: string | null;
  profession: string | null;
  specialty: string | null;
  contractType: string | null;
  offerStatus: OfferStatus;
  verballyAccepted: boolean | null;
  assignedRecruiter: string | null;
  sourceOfTruth: "nova_api";
  rawText: string | null;
  rawJson: string;
  confidence: number;
  screenSection: string | null;
  sourceRecordType: string;
};

interface OfferSyncCacheEntry {
  expiresAtMs: number;
  value: OfferLedgerSyncResult;
}

const offerSyncCache = new Map<string, OfferSyncCacheEntry>();

export interface OfferLedgerSyncInput {
  force_refresh?: boolean;
  view_type?: string;
  source_kind?: string;
  source_url?: string | null;
  endpoint_path?: string | null;
  request_method?: string;
  resource_type?: string;
  captured_by?: string | null;
  notes?: string | null;
  include_raw_response?: boolean;
}

export interface OfferLedgerSyncResult {
  event_id: string;
  fetched_count: number;
  upserted_count: number;
  updated_count: number;
  link_count: number;
  rows_seen_no_change: number;
  cache_hit: boolean;
  source_kind: string;
  endpoint_path: string;
  captured_at: string;
}

export interface OfferLedgerQueryInput {
  offer_id?: string;
  candidate_id?: string;
  candidate_name?: string;
  facility_name?: string;
  profession?: string;
  specialty?: string;
  offer_status?: string;
  event_id?: string;
  source_kind?: string;
  view_type?: string;
  include_provenance?: boolean;
  limit?: number;
  event_limit?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
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
        record.floatValue;
      if (nested !== undefined) return readString(nested);
    }
  }
  return "";
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = readString(value).toLowerCase();
  if (!normalized) return null;
  if (["true", "1", "yes", "y", "accepted", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = readString(value).replace(/[$,\s]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function toSpannerNumeric(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return String(value);
}

function normalizeLimit(value: number | undefined, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function toToken(value: string): string {
  const cleaned = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return cleaned.slice(0, 64);
}

function normalizeOfferStatus(raw: unknown, verballyAccepted: boolean | null): OfferStatus {
  const normalized = readString(raw).toLowerCase().replace(/[\s-]+/g, "_");
  if (verballyAccepted) return "verbally_accepted";
  if (!normalized) return "unknown";
  if (OFFER_STATUS_SET.has(normalized)) return normalized as OfferStatus;

  const aliasMap: Record<string, OfferStatus> = {
    review: "under_review",
    pending_review: "under_review",
    offer_extended: "extended",
    offered: "extended",
    verbal_accept: "verbally_accepted",
    verballyaccepted: "verbally_accepted",
    in_pipeline: "submitted",
    rejected: "declined",
    withdrawn: "declined",
    cancelled: "rescinded",
    contract_request: "contract_requested",
    paperwork_requested: "contract_requested",
    closed: "completed",
    filled: "completed",
  };

  return aliasMap[normalized] || "unknown";
}

function parseCandidateName(record: Record<string, unknown>): string | null {
  const direct = readString(
    record.candidate_name ||
      record.candidateName ||
      record.traveler_name ||
      record.travelerName ||
      record.name,
  );
  if (direct) return direct;
  const candidate = asRecord(record.candidate);
  if (!candidate) return null;
  const full = readString(candidate.full_name || candidate.fullName || candidate.name);
  if (full) return full;
  const first = readString(candidate.first_name || candidate.firstName);
  const last = readString(candidate.last_name || candidate.lastName);
  const joined = [first, last].filter(Boolean).join(" ").trim();
  return joined || null;
}

function parseNovaProfileUrl(
  record: Record<string, unknown>,
  candidateId: string | null,
): string | null {
  const direct = readString(
    record.nova_profile_url ||
      record.novaProfileUrl ||
      record.profile_url ||
      record.profileUrl,
  );
  if (direct) return direct;
  if (!candidateId) return null;
  return `${NOVA_PROFILE_BASE}/${encodeURIComponent(candidateId)}/new-profile/about`;
}

function buildOfferIdentity(input: {
  candidateId: string | null;
  candidateName: string | null;
  jobId: string | null;
  marginId: string | null;
  facilityName: string | null;
  profession: string | null;
  rowIndex: number;
}): { offerId: string; confidence: number; sourceRecordType: string } {
  if (input.candidateId && input.jobId) {
    return {
      offerId: `AYA.OBJ.OFFER.${toToken(input.candidateId)}.${toToken(input.jobId)}`,
      confidence: 1,
      sourceRecordType: "candidate_job",
    };
  }
  if (input.candidateId && input.marginId) {
    return {
      offerId: `AYA.OBJ.OFFER.${toToken(input.candidateId)}.${toToken(input.marginId)}`,
      confidence: 0.98,
      sourceRecordType: "candidate_margin",
    };
  }
  if (input.candidateName && input.facilityName && input.profession) {
    const candidateKey = toToken(input.candidateName);
    const offerKey = toToken(`${input.facilityName}_${input.profession}`);
    return {
      offerId: `AYA.OBJ.OFFER.${candidateKey}.${offerKey}`,
      confidence: 0.85,
      sourceRecordType: "name_facility_profession",
    };
  }

  const fallbackCandidate = toToken(input.candidateId || input.candidateName || `UNKNOWN_${input.rowIndex}`);
  const fallbackOffer = toToken(input.jobId || input.marginId || input.facilityName || `ROW_${input.rowIndex}`);
  return {
    offerId: `AYA.OBJ.OFFER.${fallbackCandidate}.${fallbackOffer}`,
    confidence: 0.5,
    sourceRecordType: "fallback",
  };
}

function extractOfferArray(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.map((entry) => asRecord(entry)).filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }
  const root = asRecord(payload);
  if (!root) return [];

  const candidateArrays: unknown[] = [
    root.offers,
    root.deals,
    root.results,
    root.items,
    asRecord(root.data)?.offers,
    asRecord(root.data)?.deals,
    asRecord(root.data)?.results,
    asRecord(root.data)?.items,
    asRecord(root.payload)?.offers,
    asRecord(root.payload)?.deals,
  ];

  for (const candidate of candidateArrays) {
    if (Array.isArray(candidate)) {
      return candidate
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry));
    }
  }

  for (const value of Object.values(root)) {
    if (Array.isArray(value)) {
      const rows = value
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry));
      if (rows.length > 0) return rows;
    }
  }

  return [];
}

function normalizeOfferRow(record: Record<string, unknown>, rowIndex: number): NormalizedOfferRow {
  const candidate = asRecord(record.candidate) || {};
  const job = asRecord(record.job) || {};
  const facility = asRecord(record.facility) || {};
  const margin = asRecord(record.margin) || {};

  const candidateId =
    readString(record.candidate_id || record.candidateId || candidate.id) || null;
  const candidateName = parseCandidateName(record);
  const candidateEmail =
    readString(record.candidate_email || record.candidateEmail || candidate.email) || null;
  const jobId = readString(record.job_id || record.jobId || job.id) || null;
  const marginId = readString(record.margin_id || record.marginId || margin.id) || null;
  const facilityName =
    readString(record.facility_name || record.facilityName || facility.name || job.facility_name) || null;
  const profession =
    readString(record.profession || candidate.profession || job.profession) || null;
  const specialty =
    readString(record.specialty || candidate.specialty || job.specialty) || null;
  const contractType =
    readString(
      record.contract_type ||
        record.contractType ||
        record.assignment_type ||
        record.assignmentType ||
        job.contract_type,
    ) || null;
  const verballyAccepted = readBoolean(
    record.verbally_accepted ||
      record.verballyAccepted ||
      record.accepted_verbally ||
      record.acceptedVerbally,
  );
  const offerStatus = normalizeOfferStatus(
    record.offer_status || record.offerStatus || record.status || record.workflow_status,
    verballyAccepted,
  );
  const assignedRecruiter =
    readString(
      record.assigned_recruiter ||
        record.assignedRecruiter ||
        record.recruiter_name ||
        asRecord(record.recruiter)?.name,
    ) || null;
  const novaProfileUrl = parseNovaProfileUrl(record, candidateId);

  const identity = buildOfferIdentity({
    candidateId,
    candidateName,
    jobId,
    marginId,
    facilityName,
    profession,
    rowIndex,
  });

  const rawText = [
    candidateName || candidateId || "unknown candidate",
    offerStatus,
    facilityName || "unknown facility",
    jobId || marginId || "no_job",
  ].join(" | ");

  return {
    offerId: identity.offerId,
    candidateId,
    candidateName,
    candidateEmail,
    novaProfileUrl,
    jobId,
    marginId,
    facilityName,
    profession,
    specialty,
    contractType,
    offerStatus,
    verballyAccepted,
    assignedRecruiter,
    sourceOfTruth: "nova_api",
    rawText,
    rawJson: JSON.stringify(record),
    confidence: identity.confidence,
    screenSection: null,
    sourceRecordType: identity.sourceRecordType,
  };
}

function buildEventPrefix(capturedAt: Date): string {
  const date = capturedAt.toISOString().slice(0, 10).replace(/-/g, "");
  return `AYA.EVT.OFFER_CAPTURE.${date}.`;
}

function mapOfferObjectRecord(row: Record<string, unknown>): OfferObjectRecord {
  return {
    offer_id: readString(row.offer_id),
    candidate_id: readString(row.candidate_id) || null,
    candidate_name: readString(row.candidate_name) || null,
    candidate_email: readString(row.candidate_email) || null,
    nova_profile_url: readString(row.nova_profile_url) || null,
    job_id: readString(row.job_id) || null,
    margin_id: readString(row.margin_id) || null,
    facility_name: readString(row.facility_name) || null,
    profession: readString(row.profession) || null,
    specialty: readString(row.specialty) || null,
    contract_type: readString(row.contract_type) || null,
    offer_status: normalizeOfferStatus(row.offer_status, readBoolean(row.verbally_accepted)),
    verbally_accepted: readBoolean(row.verbally_accepted),
    assigned_recruiter: readString(row.assigned_recruiter) || null,
    source_of_truth: readString(row.source_of_truth) || "nova_api",
    current: Boolean(row.current_flag ?? row.current),
    effective_at: toIso(row.effective_at),
    last_seen_at: toIso(row.last_seen_at) || new Date().toISOString(),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

function mapEventRecord(row: Record<string, unknown>): OfferCaptureEventRecord {
  return {
    event_id: readString(row.event_id),
    view_type: readString(row.view_type) || null,
    captured_at: toIso(row.captured_at) || new Date().toISOString(),
    source_kind: readString(row.source_kind) || "nova_api",
    source_url: readString(row.source_url) || null,
    resource_type: readString(row.resource_type) || null,
    request_method: readString(row.request_method) || null,
    endpoint_path: readString(row.endpoint_path) || null,
    response_hash: readString(row.response_hash) || null,
    rows_captured: Number(readNumber(row.rows_captured) || 0),
    captured_by: readString(row.captured_by) || null,
    notes: readString(row.notes) || null,
    created_at: toIso(row.created_at),
  };
}

function mapLinkRecord(row: Record<string, unknown>): OfferCaptureLinkRecord {
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
  return {
    event_id: readString(row.event_id),
    offer_id: readString(row.offer_id),
    position_index: Number(readNumber(row.position_index) || 0),
    raw_text: readString(row.raw_text) || null,
    raw_json: parsedRawJson,
    confidence: readNumber(row.confidence),
    screen_section: readString(row.screen_section) || null,
    source_record_type: readString(row.source_record_type) || "unknown",
    captured_at: toIso(row.captured_at) || new Date().toISOString(),
    created_at: toIso(row.created_at),
  };
}

function nullSafeEqual(a: string | null, b: string | null): boolean {
  return (a || null) === (b || null);
}

function boolEqual(a: boolean | null, b: boolean | null): boolean {
  return (a == null ? null : Boolean(a)) === (b == null ? null : Boolean(b));
}

async function fetchNovaOfferPayload(endpoint: string, method: string) {
  if (!NOVA_SESSION_TOKEN) {
    throw new Error("NOVA_TOKEN_NOT_CONFIGURED: Set NOVA_SESSION_TOKEN to sync offers.");
  }
  if (!endpoint) {
    throw new Error("NOVA_OFFERS_ENDPOINT_NOT_CONFIGURED: Set NOVA_OFFERS_ENDPOINT to sync offers.");
  }

  const response = await fetch(endpoint, {
    method,
    headers: {
      Authorization: `Bearer ${NOVA_SESSION_TOKEN}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(45_000),
  });

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(
      `NOVA_FETCH_FAILED: ${response.status} ${response.statusText} while fetching offers.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch (error) {
    throw new Error(
      `NOVA_PAYLOAD_PARSE_FAILED: Failed to parse Nova offers JSON (${error instanceof Error ? error.message : "unknown"})`,
    );
  }

  return {
    parsed,
    rawBody,
    responseHash: createHash("sha256").update(rawBody).digest("hex"),
  };
}

export async function syncOfferLedger(input: OfferLedgerSyncInput = {}): Promise<OfferLedgerSyncResult> {
  const forceRefresh = Boolean(input.force_refresh);
  const cacheKey = "default";
  const nowMs = Date.now();
  const cached = offerSyncCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAtMs > nowMs) {
    return {
      ...cached.value,
      cache_hit: true,
    };
  }

  const method = readString(input.request_method).toUpperCase() || "GET";
  const endpoint = readString(input.endpoint_path) || NOVA_OFFERS_ENDPOINT;
  const sourceKind = readString(input.source_kind) || "nova_api";
  const sourceUrl = readString(input.source_url) || endpoint;
  const viewType = readString(input.view_type) || "offer_list";
  const capturedBy = readString(input.captured_by) || "ayaops_agent";
  const notes = readString(input.notes) || null;
  const resourceType = readString(input.resource_type) || "offers";
  const includeRawResponse = input.include_raw_response !== false;

  const fetchedAt = new Date();
  const { parsed, rawBody, responseHash } = await fetchNovaOfferPayload(endpoint, method);
  const records = extractOfferArray(parsed);
  const normalizedRows = records.map((record, index) => normalizeOfferRow(record, index + 1));
  const rawResponseJson =
    includeRawResponse && rawBody.length <= RAW_RESPONSE_JSON_MAX_CHARS
      ? rawBody
      : null;

  const result = await recruitingDb.runTransactionAsync(async (tx: any) => {
    const eventPrefix = buildEventPrefix(fetchedAt);
    const [seqRows] = await tx.run({
      sql: `SELECT COUNT(*) AS c
            FROM offer_capture_events
            WHERE STARTS_WITH(event_id, @eventPrefix)`,
      params: { eventPrefix },
      types: { eventPrefix: { type: "string" } },
    });
    const seqData = asRecord(seqRows[0]?.toJSON()) || {};
    const seq = Number(readNumber(seqData.c) || 0) + 1;
    const eventId = `${eventPrefix}${String(seq).padStart(3, "0")}`;

    await tx.runUpdate({
      sql: `INSERT INTO offer_capture_events (
              event_id, view_type, captured_at, source_kind, source_url, resource_type, request_method,
              endpoint_path, response_hash, rows_captured, captured_by, notes, raw_response_json, created_at
            ) VALUES (
              @eventId, @viewType, @capturedAt, @sourceKind, @sourceUrl, @resourceType, @requestMethod,
              @endpointPath, @responseHash, @rowsCaptured, @capturedBy, @notes,
              CASE WHEN @rawResponseJson IS NULL THEN NULL ELSE PARSE_JSON(@rawResponseJson) END,
              PENDING_COMMIT_TIMESTAMP()
            )`,
      params: {
        eventId,
        viewType,
        capturedAt: fetchedAt,
        sourceKind,
        sourceUrl,
        resourceType,
        requestMethod: method,
        endpointPath: endpoint,
        responseHash,
        rowsCaptured: normalizedRows.length,
        capturedBy,
        notes,
        rawResponseJson,
      },
      types: {
        eventId: { type: "string" },
        viewType: { type: "string" },
        capturedAt: { type: "timestamp" },
        sourceKind: { type: "string" },
        sourceUrl: { type: "string" },
        resourceType: { type: "string" },
        requestMethod: { type: "string" },
        endpointPath: { type: "string" },
        responseHash: { type: "string" },
        rowsCaptured: { type: "int64" },
        capturedBy: { type: "string" },
        notes: { type: "string" },
        rawResponseJson: { type: "string" },
      },
    });

    await tx.runUpdate({
      sql: `UPDATE offer_objects
            SET current_flag = FALSE
            WHERE source_of_truth = 'nova_api'
              AND current_flag = TRUE`,
      params: {},
    });

    let upsertedCount = 0;
    let updatedCount = 0;
    let noChangeCount = 0;

    for (let i = 0; i < normalizedRows.length; i += 1) {
      const row = normalizedRows[i];
      const [existingRows] = await tx.run({
        sql: `SELECT candidate_id, candidate_name, candidate_email, nova_profile_url,
                     job_id, margin_id, facility_name, profession, specialty, contract_type,
                     offer_status, verbally_accepted, assigned_recruiter, source_of_truth, effective_at
              FROM offer_objects
              WHERE offer_id = @offerId
              LIMIT 1`,
        params: { offerId: row.offerId },
        types: { offerId: { type: "string" } },
      });
      const existing = asRecord(existingRows[0]?.toJSON());

      if (!existing) {
        await tx.runUpdate({
          sql: `INSERT INTO offer_objects (
                  offer_id, candidate_id, candidate_name, candidate_email, nova_profile_url,
                  job_id, margin_id, facility_name, profession, specialty, contract_type,
                  offer_status, verbally_accepted, assigned_recruiter, source_of_truth,
                  current_flag, effective_at, last_seen_at, created_at, updated_at
                ) VALUES (
                  @offerId, @candidateId, @candidateName, @candidateEmail, @novaProfileUrl,
                  @jobId, @marginId, @facilityName, @profession, @specialty, @contractType,
                  @offerStatus, @verballyAccepted, @assignedRecruiter, @sourceOfTruth,
                  TRUE, @effectiveAt, @lastSeenAt, PENDING_COMMIT_TIMESTAMP(), PENDING_COMMIT_TIMESTAMP()
                )`,
          params: {
            offerId: row.offerId,
            candidateId: row.candidateId,
            candidateName: row.candidateName,
            candidateEmail: row.candidateEmail,
            novaProfileUrl: row.novaProfileUrl,
            jobId: row.jobId,
            marginId: row.marginId,
            facilityName: row.facilityName,
            profession: row.profession,
            specialty: row.specialty,
            contractType: row.contractType,
            offerStatus: row.offerStatus,
            verballyAccepted: row.verballyAccepted,
            assignedRecruiter: row.assignedRecruiter,
            sourceOfTruth: row.sourceOfTruth,
            effectiveAt: fetchedAt,
            lastSeenAt: fetchedAt,
          },
          types: {
            offerId: { type: "string" },
            candidateId: { type: "string" },
            candidateName: { type: "string" },
            candidateEmail: { type: "string" },
            novaProfileUrl: { type: "string" },
            jobId: { type: "string" },
            marginId: { type: "string" },
            facilityName: { type: "string" },
            profession: { type: "string" },
            specialty: { type: "string" },
            contractType: { type: "string" },
            offerStatus: { type: "string" },
            verballyAccepted: { type: "bool" },
            assignedRecruiter: { type: "string" },
            sourceOfTruth: { type: "string" },
            effectiveAt: { type: "timestamp" },
            lastSeenAt: { type: "timestamp" },
          },
        });
        upsertedCount += 1;
      } else {
        const changed =
          !nullSafeEqual(readString(existing.candidate_id) || null, row.candidateId) ||
          !nullSafeEqual(readString(existing.candidate_name) || null, row.candidateName) ||
          !nullSafeEqual(readString(existing.candidate_email) || null, row.candidateEmail) ||
          !nullSafeEqual(readString(existing.nova_profile_url) || null, row.novaProfileUrl) ||
          !nullSafeEqual(readString(existing.job_id) || null, row.jobId) ||
          !nullSafeEqual(readString(existing.margin_id) || null, row.marginId) ||
          !nullSafeEqual(readString(existing.facility_name) || null, row.facilityName) ||
          !nullSafeEqual(readString(existing.profession) || null, row.profession) ||
          !nullSafeEqual(readString(existing.specialty) || null, row.specialty) ||
          !nullSafeEqual(readString(existing.contract_type) || null, row.contractType) ||
          normalizeOfferStatus(existing.offer_status, readBoolean(existing.verbally_accepted)) !== row.offerStatus ||
          !boolEqual(readBoolean(existing.verbally_accepted), row.verballyAccepted) ||
          !nullSafeEqual(readString(existing.assigned_recruiter) || null, row.assignedRecruiter) ||
          !nullSafeEqual(readString(existing.source_of_truth) || null, row.sourceOfTruth);

        await tx.runUpdate({
          sql: `UPDATE offer_objects
                SET candidate_id = @candidateId,
                    candidate_name = @candidateName,
                    candidate_email = @candidateEmail,
                    nova_profile_url = @novaProfileUrl,
                    job_id = @jobId,
                    margin_id = @marginId,
                    facility_name = @facilityName,
                    profession = @profession,
                    specialty = @specialty,
                    contract_type = @contractType,
                    offer_status = @offerStatus,
                    verbally_accepted = @verballyAccepted,
                    assigned_recruiter = @assignedRecruiter,
                    source_of_truth = @sourceOfTruth,
                    current_flag = TRUE,
                    effective_at = CASE WHEN @isChanged THEN @effectiveAt ELSE effective_at END,
                    last_seen_at = @lastSeenAt,
                    updated_at = PENDING_COMMIT_TIMESTAMP()
                WHERE offer_id = @offerId`,
          params: {
            offerId: row.offerId,
            candidateId: row.candidateId,
            candidateName: row.candidateName,
            candidateEmail: row.candidateEmail,
            novaProfileUrl: row.novaProfileUrl,
            jobId: row.jobId,
            marginId: row.marginId,
            facilityName: row.facilityName,
            profession: row.profession,
            specialty: row.specialty,
            contractType: row.contractType,
            offerStatus: row.offerStatus,
            verballyAccepted: row.verballyAccepted,
            assignedRecruiter: row.assignedRecruiter,
            sourceOfTruth: row.sourceOfTruth,
            effectiveAt: fetchedAt,
            lastSeenAt: fetchedAt,
            isChanged: changed,
          },
          types: {
            offerId: { type: "string" },
            candidateId: { type: "string" },
            candidateName: { type: "string" },
            candidateEmail: { type: "string" },
            novaProfileUrl: { type: "string" },
            jobId: { type: "string" },
            marginId: { type: "string" },
            facilityName: { type: "string" },
            profession: { type: "string" },
            specialty: { type: "string" },
            contractType: { type: "string" },
            offerStatus: { type: "string" },
            verballyAccepted: { type: "bool" },
            assignedRecruiter: { type: "string" },
            sourceOfTruth: { type: "string" },
            effectiveAt: { type: "timestamp" },
            lastSeenAt: { type: "timestamp" },
            isChanged: { type: "bool" },
          },
        });

        if (changed) updatedCount += 1;
        else noChangeCount += 1;
      }

      await tx.runUpdate({
        sql: `INSERT INTO offer_capture_links (
                event_id, offer_id, position_index, raw_text, raw_json, confidence,
                screen_section, source_record_type, captured_at, created_at
              ) VALUES (
                @eventId, @offerId, @positionIndex, @rawText,
                CASE WHEN @rawJson IS NULL THEN NULL ELSE PARSE_JSON(@rawJson) END,
                @confidence, @screenSection, @sourceRecordType, @capturedAt, PENDING_COMMIT_TIMESTAMP()
              )`,
        params: {
          eventId,
          offerId: row.offerId,
          positionIndex: i + 1,
          rawText: row.rawText,
          rawJson: row.rawJson,
          confidence: toSpannerNumeric(row.confidence),
          screenSection: row.screenSection,
          sourceRecordType: row.sourceRecordType,
          capturedAt: fetchedAt,
        },
        types: {
          eventId: { type: "string" },
          offerId: { type: "string" },
          positionIndex: { type: "int64" },
          rawText: { type: "string" },
          rawJson: { type: "string" },
          confidence: { type: "numeric" },
          screenSection: { type: "string" },
          sourceRecordType: { type: "string" },
          capturedAt: { type: "timestamp" },
        },
      });
    }

    await tx.commit();
    return {
      eventId,
      fetchedCount: normalizedRows.length,
      upsertedCount,
      updatedCount,
      noChangeCount,
      linkCount: normalizedRows.length,
    };
  });

  const response: OfferLedgerSyncResult = {
    event_id: result.eventId,
    fetched_count: result.fetchedCount,
    upserted_count: result.upsertedCount,
    updated_count: result.updatedCount,
    link_count: result.linkCount,
    rows_seen_no_change: result.noChangeCount,
    cache_hit: false,
    source_kind: sourceKind,
    endpoint_path: endpoint,
    captured_at: fetchedAt.toISOString(),
  };

  offerSyncCache.set(cacheKey, {
    expiresAtMs: nowMs + OFFER_SYNC_CACHE_TTL_MS,
    value: response,
  });

  return response;
}

export async function queryOfferLedger(input: OfferLedgerQueryInput) {
  const offerId = readString(input.offer_id);
  const candidateId = readString(input.candidate_id);
  const candidateName = readString(input.candidate_name);
  const facilityName = readString(input.facility_name);
  const profession = readString(input.profession);
  const specialty = readString(input.specialty);
  const offerStatusInput = readString(input.offer_status).toLowerCase().replace(/[\s-]+/g, "_");
  const offerStatus = offerStatusInput
    ? normalizeOfferStatus(offerStatusInput, null)
    : "";
  const eventId = readString(input.event_id);
  const sourceKind = readString(input.source_kind);
  const viewType = readString(input.view_type);
  const includeProvenance = Boolean(input.include_provenance);
  const limit = normalizeLimit(input.limit, 100, 1, 1000);
  const eventLimit = normalizeLimit(input.event_limit, 50, 1, 500);

  const response: {
    filters: Record<string, unknown>;
    offers: OfferObjectRecord[];
    events: OfferCaptureEventRecord[];
    links: OfferCaptureLinkRecord[];
  } = {
    filters: {
      offer_id: offerId || null,
      candidate_id: candidateId || null,
      candidate_name: candidateName || null,
      facility_name: facilityName || null,
      profession: profession || null,
      specialty: specialty || null,
      offer_status: offerStatus || null,
      event_id: eventId || null,
      source_kind: sourceKind || null,
      view_type: viewType || null,
      include_provenance: includeProvenance,
      limit,
      event_limit: eventLimit,
    },
    offers: [],
    events: [],
    links: [],
  };

  if (eventId) {
    const [eventRows] = await recruitingDb.run({
      sql: `SELECT event_id, view_type, captured_at, source_kind, source_url, resource_type,
                   request_method, endpoint_path, response_hash, rows_captured, captured_by, notes, created_at
            FROM offer_capture_events
            WHERE event_id = @eventId
            LIMIT 1`,
      params: { eventId },
      types: { eventId: { type: "string" } },
    });
    response.events = eventRows.map((row: any) => mapEventRecord(asRecord(row.toJSON()) || {}));

    const [linkRows] = await recruitingDb.run({
      sql: `SELECT event_id, offer_id, position_index, raw_text, raw_json, confidence,
                   screen_section, source_record_type, captured_at, created_at
            FROM offer_capture_links
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

    const offerIds = Array.from(new Set(response.links.map((link) => link.offer_id)));
    if (offerIds.length > 0) {
      const [offerRows] = await recruitingDb.run({
        sql: `SELECT offer_id, candidate_id, candidate_name, candidate_email, nova_profile_url,
                     job_id, margin_id, facility_name, profession, specialty, contract_type, offer_status,
                     verbally_accepted, assigned_recruiter, source_of_truth, current_flag,
                     effective_at, last_seen_at, created_at, updated_at
              FROM offer_objects
              WHERE offer_id IN UNNEST(@offerIds)
              LIMIT @lim`,
        params: { offerIds, lim: limit },
        types: {
          offerIds: { type: "array", child: { type: "string" } },
          lim: { type: "int64" },
        },
      });
      response.offers = offerRows.map((row: any) => mapOfferObjectRecord(asRecord(row.toJSON()) || {}));
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
    sql: `SELECT event_id, view_type, captured_at, source_kind, source_url, resource_type,
                 request_method, endpoint_path, response_hash, rows_captured, captured_by, notes, created_at
          FROM offer_capture_events
          ${eventWhere.length > 0 ? `WHERE ${eventWhere.join(" AND ")}` : ""}
          ORDER BY captured_at DESC
          LIMIT @lim`,
    params: eventParams,
    types: eventTypes,
  });
  response.events = eventRows.map((row: any) => mapEventRecord(asRecord(row.toJSON()) || {}));

  const objectWhere: string[] = ["o.current_flag = TRUE"];
  const objectParams: Record<string, unknown> = { lim: limit };
  const objectTypes: Record<string, unknown> = { lim: { type: "int64" } };

  if (offerId) {
    objectWhere.push("o.offer_id = @offerId");
    objectParams.offerId = offerId;
    objectTypes.offerId = { type: "string" };
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
  if (offerStatus) {
    objectWhere.push("o.offer_status = @offerStatus");
    objectParams.offerStatus = offerStatus;
    objectTypes.offerStatus = { type: "string" };
  }

  const applyEventFilters = sourceKind || viewType;
  const sql = applyEventFilters
    ? `SELECT DISTINCT
          o.offer_id, o.candidate_id, o.candidate_name, o.candidate_email, o.nova_profile_url,
          o.job_id, o.margin_id, o.facility_name, o.profession, o.specialty, o.contract_type,
          o.offer_status, o.verbally_accepted, o.assigned_recruiter, o.source_of_truth, o.current_flag,
          o.effective_at, o.last_seen_at, o.created_at, o.updated_at
       FROM offer_capture_events e
       JOIN offer_capture_links l ON l.event_id = e.event_id
       JOIN offer_objects o ON o.offer_id = l.offer_id
       WHERE ${[
         ...eventWhere.map((clause) => `e.${clause}`),
         ...objectWhere,
       ].join(" AND ")}
       ORDER BY o.last_seen_at DESC
       LIMIT @lim`
    : `SELECT
          o.offer_id, o.candidate_id, o.candidate_name, o.candidate_email, o.nova_profile_url,
          o.job_id, o.margin_id, o.facility_name, o.profession, o.specialty, o.contract_type,
          o.offer_status, o.verbally_accepted, o.assigned_recruiter, o.source_of_truth, o.current_flag,
          o.effective_at, o.last_seen_at, o.created_at, o.updated_at
       FROM offer_objects o
       WHERE ${objectWhere.join(" AND ")}
       ORDER BY o.last_seen_at DESC
       LIMIT @lim`;

  const [offerRows] = await recruitingDb.run({
    sql,
    params: applyEventFilters ? { ...eventParams, ...objectParams } : objectParams,
    types: applyEventFilters ? { ...eventTypes, ...objectTypes } : objectTypes,
  });

  response.offers = offerRows.map((row: any) => mapOfferObjectRecord(asRecord(row.toJSON()) || {}));

  if (includeProvenance && response.offers.length > 0) {
    const offerIds = response.offers.map((offer) => offer.offer_id);
    const [linkRows] = await recruitingDb.run({
      sql: `SELECT event_id, offer_id, position_index, raw_text, raw_json, confidence,
                   screen_section, source_record_type, captured_at, created_at
            FROM offer_capture_links
            WHERE offer_id IN UNNEST(@offerIds)
            ORDER BY captured_at DESC
            LIMIT @lim`,
      params: { offerIds, lim: limit * 2 },
      types: {
        offerIds: { type: "array", child: { type: "string" } },
        lim: { type: "int64" },
      },
    });
    response.links = linkRows.map((row: any) => mapLinkRecord(asRecord(row.toJSON()) || {}));
  }

  return response;
}

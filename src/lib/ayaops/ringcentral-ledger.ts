import { createHash } from "node:crypto";
import { getRecruitingDb } from "@/lib/spanner-pool";

const recruitingDb = getRecruitingDb();

type CandidateLinkStatus = "linked" | "unresolved" | "ambiguous";
type CanonicalWriteStatus = "inserted" | "updated" | "no_change";

export interface RingCentralVisibleMessageInput {
  order?: number | string;
  direction?: string;
  sender?: string;
  timestamp_if_visible?: string;
  exact_text?: string;
  truncated?: boolean | string | number;
  [key: string]: unknown;
}

export interface RingCentralThreadIngestInput {
  candidate_id?: string | null;
  candidate_name?: string | null;
  thread_source?: string | null;
  source?: string | null;
  source_url?: string | null;
  captured_at?: string | null;
  participants?: unknown;
  visible_messages?: RingCentralVisibleMessageInput[];
  latest_inbound_message?: string | null;
  latest_outbound_message?: string | null;
  latest_message_at?: string | null;
  unknowns?: unknown;
  [key: string]: unknown;
}

export interface RingCentralThreadIngestResult {
  outcome: "saved";
  thread_id: string;
  event_id: string;
  candidate_link_status: CandidateLinkStatus;
  candidate_id: string | null;
  candidate_name: string | null;
  message_count: number;
  latest_inbound_message: string | null;
  latest_outbound_message: string | null;
  write_status: CanonicalWriteStatus;
  unresolved_flag: boolean;
  reason: string | null;
  rows_captured: number;
}

type NormalizedVisibleMessage = {
  order: number;
  direction: string | null;
  sender: string | null;
  timestampIfVisible: string | null;
  exactText: string | null;
  truncated: boolean | null;
};

type CandidateResolution = {
  linkStatus: CandidateLinkStatus;
  candidateId: string | null;
  candidateName: string | null;
  confidence: number | null;
  reason: string | null;
};

type TxLike = {
  run: (...args: unknown[]) => Promise<unknown>;
};

type RowLike = {
  toJSON: () => Record<string, unknown>;
};

type SqlQuery = {
  sql: string;
  params?: Record<string, unknown>;
  types?: Record<string, unknown>;
};

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

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const entry of value) {
    const normalized = normalizeNullableString(entry);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function normalizeVisibleMessages(value: unknown): NormalizedVisibleMessage[] {
  if (!Array.isArray(value)) return [];

  const messages = value
    .map((entry, index) => {
      const record = asRecord(entry) || {};
      const orderRaw = readNumber(record.order);
      const order =
        typeof orderRaw === "number" && Number.isFinite(orderRaw)
          ? Math.max(1, Math.floor(orderRaw))
          : index + 1;
      const direction = normalizeNullableString(record.direction)?.toLowerCase() || null;
      const normalizedDirection =
        direction && ["inbound", "outbound"].includes(direction) ? direction : direction;
      return {
        order,
        direction: normalizedDirection,
        sender: normalizeNullableString(record.sender),
        timestampIfVisible: normalizeNullableString(
          record.timestamp_if_visible ?? record.timestampIfVisible,
        ),
        exactText: normalizeNullableString(record.exact_text ?? record.exactText),
        truncated: readBoolean(record.truncated),
      } as NormalizedVisibleMessage;
    })
    .sort((a, b) => a.order - b.order);

  const seenOrder = new Set<number>();
  const deduped: NormalizedVisibleMessage[] = [];
  for (const message of messages) {
    let nextOrder = message.order;
    while (seenOrder.has(nextOrder)) nextOrder += 1;
    seenOrder.add(nextOrder);
    deduped.push({ ...message, order: nextOrder });
  }
  return deduped;
}

function toIsoTimestamp(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function toToken(value: string, limit = 64): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, limit);
}

function normalizeCandidateInputId(value: unknown): string | null {
  const raw = normalizeNullableString(value);
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (["unknown", "null", "n/a", "na", "none", "missing"].includes(normalized)) {
    return null;
  }
  return raw;
}

function normalizeThreadSource(value: unknown): string {
  const source = normalizeNullableString(value);
  if (!source) return "RingCentral SMS";
  return source;
}

function normalizeJsonComparable(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch {
      return value;
    }
  }
  return JSON.stringify(value);
}

function buildParticipantKey(participants: string[]): string {
  const tokens = participants
    .map((entry) => toToken(entry, 80))
    .filter(Boolean)
    .sort();
  return tokens.length > 0 ? tokens.join("|") : "UNKNOWN_PARTICIPANTS";
}

function buildVisibleMessageSummary(messages: NormalizedVisibleMessage[]): string {
  const condensed = messages.map((message) => ({
    order: message.order,
    direction: message.direction,
    sender: message.sender,
    text: message.exactText,
  }));
  return JSON.stringify(condensed);
}

function buildUnresolvedIdentityHash(
  threadSource: string,
  participantKey: string,
  messages: NormalizedVisibleMessage[],
  latestInbound: string | null,
  latestOutbound: string | null,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        threadSource: threadSource.toLowerCase(),
        participantKey,
        messageSummary: buildVisibleMessageSummary(messages),
        latestInbound,
        latestOutbound,
      }),
    )
    .digest("hex")
    .toUpperCase();
}

function buildThreadIdForCandidate(
  candidateId: string,
  threadSource: string,
  participantKey: string,
): string {
  const candidateToken = toToken(candidateId, 80) || "UNKNOWN_CANDIDATE";
  const suffix = createHash("sha1")
    .update(`${threadSource.toLowerCase()}|${participantKey}`)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
  return `AYA.OBJ.RC_THREAD.${candidateToken}.${suffix}`;
}

function buildThreadIdUnresolved(unresolvedIdentityHash: string): string {
  return `AYA.OBJ.RC_THREAD.UNRESOLVED.${unresolvedIdentityHash.slice(0, 24)}`;
}

function buildEventPrefix(capturedAt: Date): string {
  const date = capturedAt.toISOString().slice(0, 10).replace(/-/g, "");
  return `AYA.EVT.RC_THREAD_CAPTURE.${date}.`;
}

function canonicalFieldsChanged(
  existing: Record<string, unknown>,
  nextValues: {
    candidateId: string | null;
    candidateName: string | null;
    threadSource: string;
    participantsJson: string;
    latestInbound: string | null;
    latestOutbound: string | null;
    latestMessageAt: string | null;
    unresolvedFlag: boolean;
    sourceUrl: string | null;
    unknownsJson: string;
    unresolvedIdentityHash: string;
  },
): boolean {
  return (
    normalizeNullableString(existing.candidate_id) !== nextValues.candidateId ||
    normalizeNullableString(existing.candidate_name) !== nextValues.candidateName ||
    normalizeNullableString(existing.thread_source) !== nextValues.threadSource ||
    normalizeJsonComparable(existing.participants_json) !== nextValues.participantsJson ||
    normalizeNullableString(existing.latest_inbound_message) !== nextValues.latestInbound ||
    normalizeNullableString(existing.latest_outbound_message) !== nextValues.latestOutbound ||
    toIsoTimestamp(existing.latest_message_at) !== nextValues.latestMessageAt ||
    readBoolean(existing.unresolved_flag) !== nextValues.unresolvedFlag ||
    normalizeNullableString(existing.source_url) !== nextValues.sourceUrl ||
    normalizeJsonComparable(existing.unknowns_json) !== nextValues.unknownsJson ||
    normalizeNullableString(existing.unresolved_identity_hash) !== nextValues.unresolvedIdentityHash
  );
}

async function resolveCandidate(
  tx: TxLike,
  candidateInput: string | null,
  candidateName: string | null,
): Promise<CandidateResolution> {
  const linkedFromRows = (
    rows: Array<{ toJSON: () => Record<string, unknown> }>,
    confidence: number,
    ambiguousReason: string,
    unresolvedReason: string,
  ): CandidateResolution => {
    if (rows.length === 1) {
      const row = asRecord(rows[0].toJSON()) || {};
      const first = readString(row.first_name);
      const last = readString(row.last_name);
      const resolvedName = [first, last].filter(Boolean).join(" ") || candidateName;
      return {
        linkStatus: "linked",
        candidateId: readString(row.id) || null,
        candidateName: resolvedName || null,
        confidence,
        reason: null,
      };
    }
    if (rows.length > 1) {
      return {
        linkStatus: "ambiguous",
        candidateId: null,
        candidateName,
        confidence: null,
        reason: ambiguousReason,
      };
    }
    return {
      linkStatus: "unresolved",
      candidateId: null,
      candidateName,
      confidence: null,
      reason: unresolvedReason,
    };
  };

  if (candidateInput) {
    const rows = await runRows(tx, {
      sql: `SELECT id, first_name, last_name
            FROM hc_candidates
            WHERE id = @candidateInput
               OR CAST(nova_id AS STRING) = @candidateInput
            LIMIT 3`,
      params: { candidateInput },
      types: { candidateInput: { type: "string" } },
    });
    return linkedFromRows(rows, 1, "candidate_id_ambiguous", "candidate_id_not_found");
  }

  if (candidateName) {
    const normalized = candidateName.toLowerCase().replace(/\s+/g, " ").trim();
    if (normalized) {
      if (normalized.includes(" ")) {
        const rows = await runRows(tx, {
          sql: `SELECT id, first_name, last_name
                FROM hc_candidates
                WHERE LOWER(CONCAT(first_name, ' ', last_name)) = @fullName
                LIMIT 3`,
          params: { fullName: normalized },
          types: { fullName: { type: "string" } },
        });
        return linkedFromRows(rows, 0.9, "candidate_name_ambiguous", "candidate_name_not_found");
      }

      const rows = await runRows(tx, {
        sql: `SELECT id, first_name, last_name
              FROM hc_candidates
              WHERE LOWER(first_name) = @firstName
              LIMIT 3`,
        params: { firstName: normalized },
        types: { firstName: { type: "string" } },
      });
      return linkedFromRows(rows, 0.7, "candidate_name_ambiguous", "candidate_name_not_found");
    }
  }

  return {
    linkStatus: "unresolved",
    candidateId: null,
    candidateName,
    confidence: null,
    reason: "candidate_id_missing",
  };
}

export async function ingestRingCentralThreadCapture(
  input: RingCentralThreadIngestInput,
): Promise<RingCentralThreadIngestResult> {
  const payload = asRecord(input) || {};

  const capturedAt = new Date(readString(payload.captured_at || payload.capturedAt) || Date.now());
  if (Number.isNaN(capturedAt.getTime())) {
    throw new Error("captured_at must be a valid date string");
  }

  const threadSource = normalizeThreadSource(payload.thread_source || payload.threadSource || payload.source);
  const sourceName = normalizeThreadSource(payload.source_name || payload.sourceName || threadSource);
  const sourceKind = normalizeNullableString(payload.source_kind || payload.sourceKind) || "ringcentral_sms";
  const sourceUrl = normalizeNullableString(payload.source_url || payload.sourceUrl);

  const candidateInput = normalizeCandidateInputId(payload.candidate_id || payload.candidateId);
  const candidateNameInput = normalizeNullableString(payload.candidate_name || payload.candidateName);
  const participants = normalizeStringArray(payload.participants);
  const visibleMessages = normalizeVisibleMessages(payload.visible_messages || payload.visibleMessages);

  let latestInbound =
    normalizeNullableString(payload.latest_inbound_message || payload.latestInboundMessage) || null;
  let latestOutbound =
    normalizeNullableString(payload.latest_outbound_message || payload.latestOutboundMessage) || null;

  if (!latestInbound || !latestOutbound) {
    const ordered = [...visibleMessages].sort((a, b) => a.order - b.order);
    for (let i = ordered.length - 1; i >= 0; i -= 1) {
      const message = ordered[i];
      if (!latestInbound && message.direction === "inbound" && message.exactText) {
        latestInbound = message.exactText;
      }
      if (!latestOutbound && message.direction === "outbound" && message.exactText) {
        latestOutbound = message.exactText;
      }
      if (latestInbound && latestOutbound) break;
    }
  }

  const latestMessageAt =
    toIsoTimestamp(payload.latest_message_at || payload.latestMessageAt) || null;
  const unknowns = normalizeStringArray(payload.unknowns);

  const unresolvedIdentityHash = buildUnresolvedIdentityHash(
    threadSource,
    buildParticipantKey(participants),
    visibleMessages,
    latestInbound,
    latestOutbound,
  );

  const rawPayloadJson = JSON.stringify(payload);

  const txResult = await recruitingDb.runTransactionAsync(async (tx: any) => {
    const txLike = tx as unknown as TxLike;
    const candidateResolution = await resolveCandidate(txLike, candidateInput, candidateNameInput);

    const participantKey = buildParticipantKey(participants);
    const fallbackThreadId = buildThreadIdUnresolved(unresolvedIdentityHash);
    const preferredThreadId = candidateResolution.candidateId
      ? buildThreadIdForCandidate(candidateResolution.candidateId, threadSource, participantKey)
      : fallbackThreadId;

    const identityRows = await runRows(txLike, {
      sql: `SELECT thread_id, candidate_id, candidate_name, thread_source, participants_json,
                   latest_inbound_message, latest_outbound_message, latest_message_at,
                   unresolved_flag, source_url, unknowns_json, unresolved_identity_hash
            FROM rc_thread_objects
            WHERE unresolved_identity_hash = @identityHash
            LIMIT 2`,
      params: { identityHash: unresolvedIdentityHash },
      types: { identityHash: { type: "string" } },
    });

    const existingByIdentity = asRecord(identityRows[0]?.toJSON()) || null;
    const threadId = readString(existingByIdentity?.thread_id) || preferredThreadId;

    const existingRows = await runRows(txLike, {
      sql: `SELECT candidate_id, candidate_name, thread_source, participants_json,
                   latest_inbound_message, latest_outbound_message, latest_message_at,
                   unresolved_flag, source_url, unknowns_json, unresolved_identity_hash
            FROM rc_thread_objects
            WHERE thread_id = @threadId
            LIMIT 1`,
      params: { threadId },
      types: { threadId: { type: "string" } },
    });

    const existing = asRecord(existingRows[0]?.toJSON()) || null;

    const effectiveCandidateId =
      candidateResolution.candidateId || normalizeNullableString(existing?.candidate_id) || null;
    const effectiveCandidateName =
      candidateResolution.candidateName ||
      candidateNameInput ||
      normalizeNullableString(existing?.candidate_name) ||
      null;
    const unresolvedFlag = !effectiveCandidateId;

    const participantsJson = JSON.stringify(participants);
    const unknownsJson = JSON.stringify(unknowns);

    const nextValues = {
      candidateId: effectiveCandidateId,
      candidateName: effectiveCandidateName,
      threadSource,
      participantsJson,
      latestInbound,
      latestOutbound,
      latestMessageAt,
      unresolvedFlag,
      sourceUrl,
      unknownsJson,
      unresolvedIdentityHash,
    };

    let writeStatus: CanonicalWriteStatus = "inserted";

    if (!existing) {
      await tx.runUpdate({
        sql: `INSERT INTO rc_thread_objects (
                thread_id, candidate_id, candidate_name, thread_source, participants_json,
                latest_inbound_message, latest_outbound_message, latest_message_at,
                unresolved_flag, unresolved_identity_hash, source_url, unknowns_json,
                first_seen_at, last_seen_at, created_at, updated_at
              ) VALUES (
                @threadId, @candidateId, @candidateName, @threadSource,
                PARSE_JSON(@participantsJson),
                @latestInbound, @latestOutbound, @latestMessageAt,
                @unresolvedFlag, @unresolvedIdentityHash, @sourceUrl,
                PARSE_JSON(@unknownsJson),
                @capturedAt, @capturedAt, PENDING_COMMIT_TIMESTAMP(), PENDING_COMMIT_TIMESTAMP()
              )`,
        params: {
          threadId,
          candidateId: effectiveCandidateId,
          candidateName: effectiveCandidateName,
          threadSource,
          participantsJson,
          latestInbound,
          latestOutbound,
          latestMessageAt,
          unresolvedFlag,
          unresolvedIdentityHash,
          sourceUrl,
          unknownsJson,
          capturedAt,
        },
        types: {
          threadId: { type: "string" },
          candidateId: { type: "string" },
          candidateName: { type: "string" },
          threadSource: { type: "string" },
          participantsJson: { type: "string" },
          latestInbound: { type: "string" },
          latestOutbound: { type: "string" },
          latestMessageAt: { type: "timestamp" },
          unresolvedFlag: { type: "bool" },
          unresolvedIdentityHash: { type: "string" },
          sourceUrl: { type: "string" },
          unknownsJson: { type: "string" },
          capturedAt: { type: "timestamp" },
        },
      });
      writeStatus = "inserted";
    } else {
      const changed = canonicalFieldsChanged(existing, nextValues);
      await tx.runUpdate({
        sql: `UPDATE rc_thread_objects
              SET candidate_id = @candidateId,
                  candidate_name = @candidateName,
                  thread_source = @threadSource,
                  participants_json = PARSE_JSON(@participantsJson),
                  latest_inbound_message = @latestInbound,
                  latest_outbound_message = @latestOutbound,
                  latest_message_at = @latestMessageAt,
                  unresolved_flag = @unresolvedFlag,
                  unresolved_identity_hash = @unresolvedIdentityHash,
                  source_url = @sourceUrl,
                  unknowns_json = PARSE_JSON(@unknownsJson),
                  last_seen_at = @capturedAt,
                  updated_at = PENDING_COMMIT_TIMESTAMP()
              WHERE thread_id = @threadId`,
        params: {
          threadId,
          candidateId: effectiveCandidateId,
          candidateName: effectiveCandidateName,
          threadSource,
          participantsJson,
          latestInbound,
          latestOutbound,
          latestMessageAt,
          unresolvedFlag,
          unresolvedIdentityHash,
          sourceUrl,
          unknownsJson,
          capturedAt,
        },
        types: {
          threadId: { type: "string" },
          candidateId: { type: "string" },
          candidateName: { type: "string" },
          threadSource: { type: "string" },
          participantsJson: { type: "string" },
          latestInbound: { type: "string" },
          latestOutbound: { type: "string" },
          latestMessageAt: { type: "timestamp" },
          unresolvedFlag: { type: "bool" },
          unresolvedIdentityHash: { type: "string" },
          sourceUrl: { type: "string" },
          unknownsJson: { type: "string" },
          capturedAt: { type: "timestamp" },
        },
      });
      writeStatus = changed ? "updated" : "no_change";
    }

    const eventPrefix = buildEventPrefix(capturedAt);
    const seqRows = await runRows(txLike, {
      sql: `SELECT COUNT(*) AS c
            FROM rc_thread_capture_events
            WHERE STARTS_WITH(event_id, @eventPrefix)`,
      params: { eventPrefix },
      types: { eventPrefix: { type: "string" } },
    });
    const seqData = asRecord(seqRows[0]?.toJSON()) || {};
    const seq = Number(readNumber(seqData.c) || 0) + 1;
    const eventId = `${eventPrefix}${String(seq).padStart(3, "0")}`;

    const validationErrors = candidateResolution.reason
      ? [
          {
            type: "candidate_link",
            status: candidateResolution.linkStatus,
            reason: candidateResolution.reason,
          },
        ]
      : [];

    const validationErrorsJson =
      validationErrors.length > 0 ? JSON.stringify(validationErrors) : null;

    await tx.runUpdate({
      sql: `INSERT INTO rc_thread_capture_events (
              event_id, thread_id, captured_at, ingested_at,
              raw_payload_json, rows_captured, source_name, source_kind,
              validation_errors_json
            ) VALUES (
              @eventId, @threadId, @capturedAt, PENDING_COMMIT_TIMESTAMP(),
              PARSE_JSON(@rawPayloadJson), @rowsCaptured, @sourceName, @sourceKind,
              CASE WHEN @validationErrorsJson IS NULL THEN NULL ELSE PARSE_JSON(@validationErrorsJson) END
            )`,
      params: {
        eventId,
        threadId,
        capturedAt,
        rawPayloadJson,
        rowsCaptured: visibleMessages.length,
        sourceName,
        sourceKind,
        validationErrorsJson,
      },
      types: {
        eventId: { type: "string" },
        threadId: { type: "string" },
        capturedAt: { type: "timestamp" },
        rawPayloadJson: { type: "string" },
        rowsCaptured: { type: "int64" },
        sourceName: { type: "string" },
        sourceKind: { type: "string" },
        validationErrorsJson: { type: "string" },
      },
    });

    await tx.runUpdate({
      sql: `INSERT INTO rc_thread_capture_links (
              event_id, object_type, object_id, write_status, confidence, notes, created_at
            ) VALUES (
              @eventId, @objectType, @objectId, @writeStatus, @confidence, @notes,
              PENDING_COMMIT_TIMESTAMP()
            )`,
      params: {
        eventId,
        objectType: "rc_thread_object",
        objectId: threadId,
        writeStatus,
        confidence: candidateResolution.confidence != null ? String(candidateResolution.confidence) : null,
        notes: candidateResolution.reason,
      },
      types: {
        eventId: { type: "string" },
        objectType: { type: "string" },
        objectId: { type: "string" },
        writeStatus: { type: "string" },
        confidence: { type: "numeric" },
        notes: { type: "string" },
      },
    });

    for (const message of visibleMessages) {
      await tx.runUpdate({
        sql: `INSERT INTO rc_thread_messages (
                thread_id, event_id, message_order, direction, sender,
                timestamp_if_visible, exact_text, truncated, created_at
              ) VALUES (
                @threadId, @eventId, @messageOrder, @direction, @sender,
                @timestampIfVisible, @exactText, @truncated,
                PENDING_COMMIT_TIMESTAMP()
              )`,
        params: {
          threadId,
          eventId,
          messageOrder: message.order,
          direction: message.direction,
          sender: message.sender,
          timestampIfVisible: message.timestampIfVisible,
          exactText: message.exactText,
          truncated: message.truncated,
        },
        types: {
          threadId: { type: "string" },
          eventId: { type: "string" },
          messageOrder: { type: "int64" },
          direction: { type: "string" },
          sender: { type: "string" },
          timestampIfVisible: { type: "string" },
          exactText: { type: "string" },
          truncated: { type: "bool" },
        },
      });
    }

    await tx.commit();

    return {
      eventId,
      threadId,
      writeStatus,
      candidateLinkStatus: candidateResolution.linkStatus,
      candidateId: effectiveCandidateId,
      candidateName: effectiveCandidateName,
      messageCount: visibleMessages.length,
      latestInbound,
      latestOutbound,
      unresolvedFlag,
      reason: candidateResolution.reason,
      rowsCaptured: visibleMessages.length,
    };
  });

  return {
    outcome: "saved",
    thread_id: txResult.threadId,
    event_id: txResult.eventId,
    candidate_link_status: txResult.candidateLinkStatus,
    candidate_id: txResult.candidateId,
    candidate_name: txResult.candidateName,
    message_count: txResult.messageCount,
    latest_inbound_message: txResult.latestInbound,
    latest_outbound_message: txResult.latestOutbound,
    write_status: txResult.writeStatus,
    unresolved_flag: txResult.unresolvedFlag,
    reason: txResult.reason,
    rows_captured: txResult.rowsCaptured,
  };
}

export function isLikelyRingCentralThreadPayload(record: Record<string, unknown> | null): boolean {
  if (!record) return false;

  const source = readString(record.source || record.thread_source || record.threadSource).toLowerCase();
  if (source.includes("ringcentral")) return true;

  const hasParticipants = Array.isArray(record.participants);
  const hasMessages =
    Array.isArray(record.visible_messages) || Array.isArray(record.visibleMessages);
  const hasLatestText =
    Boolean(readString(record.latest_inbound_message || record.latestInboundMessage)) ||
    Boolean(readString(record.latest_outbound_message || record.latestOutboundMessage));

  return hasParticipants && hasMessages && hasLatestText;
}

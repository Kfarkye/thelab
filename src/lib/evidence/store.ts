import { GoogleAuth } from "google-auth-library";
import { getCredentialDb } from "@/lib/spanner-pool";
const EVIDENCE_BUCKET = process.env.EVIDENCE_BUCKET || "workflowos-a0fbf-evidence";

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/devstorage.read_write"],
});

function getEvidenceDb() {
  return getCredentialDb();
}

export interface SavedImageRecord {
  imageId: string;
  storagePath: string;
  thumbnailPath: string | null;
  candidateId: string | null;
  candidateName: string | null;
  sourceType: string;
  screenType: string | null;
  mode: string | null;
  mimeType: string;
  createdAt: string;
  uploadedBy: string | null;
  conversationId: string | null;
  isPinned: boolean;
  tags: string[];
  lastUsedAt: string | null;
  previewUrl: string;
  suggestions?: { candidateId: string; candidateName: string } | null;
}

export interface SaveImageInput {
  imageDataUrl: string;
  candidateId?: string | null;
  sourceType?: string;
  screenType?: string | null;
  mode?: string | null;
  uploadedBy?: string | null;
  conversationId?: string | null;
  tags?: string[];
  isPinned?: boolean;
}

export interface ListSavedImagesInput {
  limit?: number;
  mode?: string | null;
  candidateId?: string | null;
  conversationId?: string | null;
}

type SpannerJson = Record<string, unknown>;

let evidenceTableCheckPromise: Promise<void> | null = null;

function ensureEvidenceTableExists(): Promise<void> {
  if (evidenceTableCheckPromise) {
    return evidenceTableCheckPromise;
  }

  evidenceTableCheckPromise = (async () => {
    const db = getEvidenceDb();
    try {
      const [rows] = await db.run({
        sql: `SELECT table_name
              FROM information_schema.tables
              WHERE table_name = 'saved_images'
              LIMIT 1`,
      });

      if (rows.length === 0) {
        throw new Error(
          "Saved images table does not exist. Run create_saved_images_table.sql against credentialdb."
        );
      }
    } catch (error) {
      evidenceTableCheckPromise = null;
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("Saved images table preflight failed");
    }
  })();

  return evidenceTableCheckPromise;
}

function ensureBucketConfigured() {
  if (!EVIDENCE_BUCKET) {
    throw new Error("EVIDENCE_BUCKET is not configured");
  }
}

function sanitizeToken(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32) || "temp";
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function parseTags(tagsJson: unknown): string[] {
  if (typeof tagsJson !== "string" || !tagsJson) return [];
  try {
    const parsed = JSON.parse(tagsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => String(v)).filter(Boolean);
  } catch {
    return [];
  }
}

function toSavedImageRecord(
  row: SpannerJson,
  candidateNames: Map<string, string>
): SavedImageRecord {
  const imageId = String(row.image_id || "");
  const candidateId = row.candidate_id ? String(row.candidate_id) : null;
  const createdAt = toIsoString(row.created_at);
  const lastUsedAt = row.last_used_at ? toIsoString(row.last_used_at) : null;

  return {
    imageId,
    storagePath: String(row.storage_path || ""),
    thumbnailPath: row.thumbnail_path ? String(row.thumbnail_path) : null,
    candidateId,
    candidateName: candidateId ? candidateNames.get(candidateId) || null : null,
    sourceType: String(row.source_type || "unknown"),
    screenType: row.screen_type ? String(row.screen_type) : null,
    mode: row.mode ? String(row.mode) : null,
    mimeType: String(row.mime_type || "image/png"),
    createdAt,
    uploadedBy: row.uploaded_by ? String(row.uploaded_by) : null,
    conversationId: row.conversation_id ? String(row.conversation_id) : null,
    isPinned: Boolean(row.is_pinned),
    tags: parseTags(row.tags_json),
    lastUsedAt,
    previewUrl: `https://storage.googleapis.com/${EVIDENCE_BUCKET}/${String(row.storage_path || "")}`,
  };
}

function parseDataUrl(imageDataUrl: string): { mimeType: string; bytes: Buffer } {
  const match = imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid image data URL");
  }
  const mimeType = match[1];
  const base64Data = match[2];
  const bytes = Buffer.from(base64Data, "base64");
  if (!bytes.length) throw new Error("Decoded image is empty");
  return { mimeType, bytes };
}

function extensionFromMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "application/pdf") return "pdf";
  return "img";
}

function buildImageId(sourceType: string, candidateId?: string | null): string {
  const source = sanitizeToken(sourceType.toUpperCase() || "NOVA");
  const candidateToken = sanitizeToken(candidateId || "temp");
  const ts = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `AYA.OBJ.IMAGE.${source}.${candidateToken}.${ts}`;
}

function buildStoragePath(imageId: string, ext: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return `nova/${day}/${imageId}.${ext}`;
}

async function getAccessToken(): Promise<string> {
  const client = await auth.getClient();
  const tokenResult = await client.getAccessToken();
  const token = typeof tokenResult === "string" ? tokenResult : tokenResult?.token;
  if (!token) throw new Error("Unable to acquire Google access token");
  return token;
}

async function uploadToGcs(storagePath: string, mimeType: string, bytes: Buffer) {
  ensureBucketConfigured();
  const token = await getAccessToken();
  const url =
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(EVIDENCE_BUCKET)}` +
    `/o?uploadType=media&name=${encodeURIComponent(storagePath)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": mimeType,
    },
    body: new Uint8Array(bytes),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GCS upload failed (${res.status}): ${body}`);
  }
}

async function downloadFromGcs(storagePath: string): Promise<Buffer> {
  ensureBucketConfigured();
  const token = await getAccessToken();
  const url =
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(EVIDENCE_BUCKET)}` +
    `/o/${encodeURIComponent(storagePath)}?alt=media`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GCS download failed (${res.status}): ${body}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function deleteFromGcs(storagePath: string): Promise<void> {
  ensureBucketConfigured();
  const token = await getAccessToken();
  const url =
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(EVIDENCE_BUCKET)}` +
    `/o/${encodeURIComponent(storagePath)}`;

  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    console.warn(`Failed to delete orphaned evidence object (${res.status}): ${body}`);
  }
}

async function fetchCandidateNames(candidateIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(candidateIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  try {
    const db = getEvidenceDb();
    const [rows] = await db.run({
      sql: `SELECT id, first_name, last_name
            FROM hc_candidates
            WHERE id IN UNNEST(@ids)`,
      params: { ids: uniqueIds },
      types: {
        ids: { type: "array", child: { type: "string" } },
      },
    });

    const map = new Map<string, string>();
    for (const row of rows) {
      const data = row.toJSON() as SpannerJson;
      const first = data.first_name ? String(data.first_name).trim() : "";
      const last = data.last_name ? String(data.last_name).trim() : "";
      map.set(String(data.id), [first, last].filter(Boolean).join(" ") || String(data.id));
    }
    return map;
  } catch (error) {
    console.warn("Could not fetch candidate names for evidence rows:", error);
    return new Map();
  }
}

export async function saveEvidenceImage(input: SaveImageInput): Promise<SavedImageRecord> {
  await ensureEvidenceTableExists();
  const sourceType = input.sourceType || "nova";
  const { mimeType, bytes } = parseDataUrl(input.imageDataUrl);
  const imageId = buildImageId(sourceType, input.candidateId);
  const ext = extensionFromMimeType(mimeType);
  const storagePath = buildStoragePath(imageId, ext);
  const tags = input.tags || [];
  const tagsJson = JSON.stringify(tags);

  await uploadToGcs(storagePath, mimeType, bytes);

  const db = getEvidenceDb();
  try {
    await db.runTransactionAsync(async (tx: any) => {
      await tx.runUpdate({
        sql: `INSERT INTO saved_images (
                image_id, storage_path, thumbnail_path, candidate_id, source_type, screen_type,
                mode, mime_type, uploaded_by, conversation_id, is_pinned, tags_json, created_at
              ) VALUES (
                @imageId, @storagePath, @thumbnailPath, @candidateId, @sourceType, @screenType,
                @mode, @mimeType, @uploadedBy, @conversationId, @isPinned, @tagsJson, PENDING_COMMIT_TIMESTAMP()
              )`,
        params: {
          imageId,
          storagePath,
          thumbnailPath: null,
          candidateId: input.candidateId || null,
          sourceType,
          screenType: input.screenType || null,
          mode: input.mode || null,
          mimeType,
          uploadedBy: input.uploadedBy || null,
          conversationId: input.conversationId || null,
          isPinned: Boolean(input.isPinned),
          tagsJson,
        },
        types: {
          imageId: { type: "string" },
          storagePath: { type: "string" },
          thumbnailPath: { type: "string" },
          candidateId: { type: "string" },
          sourceType: { type: "string" },
          screenType: { type: "string" },
          mode: { type: "string" },
          mimeType: { type: "string" },
          uploadedBy: { type: "string" },
          conversationId: { type: "string" },
          isPinned: { type: "bool" },
          tagsJson: { type: "string" },
        },
      });
      await tx.commit();
    });
  } catch (error) {
    await deleteFromGcs(storagePath);
    throw error;
  }

  return {
    imageId,
    storagePath,
    thumbnailPath: null,
    candidateId: input.candidateId || null,
    candidateName: null,
    sourceType,
    screenType: input.screenType || null,
    mode: input.mode || null,
    mimeType,
    createdAt: new Date().toISOString(),
    uploadedBy: input.uploadedBy || null,
    conversationId: input.conversationId || null,
    isPinned: Boolean(input.isPinned),
    tags,
    lastUsedAt: null,
    previewUrl: `https://storage.googleapis.com/${EVIDENCE_BUCKET}/${storagePath}`,
  };
}

export async function listSavedImages(input: ListSavedImagesInput = {}): Promise<SavedImageRecord[]> {
  await ensureEvidenceTableExists();
  const db = getEvidenceDb();
  const limit = Math.min(Math.max(input.limit || 10, 1), 50);

  let sql = `SELECT image_id, storage_path, thumbnail_path, candidate_id, source_type, screen_type,
                    mode, mime_type, uploaded_by, conversation_id, is_pinned, tags_json,
                    last_used_at, created_at
             FROM saved_images`;
  const where: string[] = [];
  const params: Record<string, unknown> = { lim: limit };
  const types: Record<string, { type: string; child?: { type: string } }> = {
    lim: { type: "int64" },
  };

  if (input.mode) {
    where.push("mode = @mode");
    params.mode = input.mode;
    types.mode = { type: "string" };
  }
  if (input.candidateId) {
    where.push("candidate_id = @candidateId");
    params.candidateId = input.candidateId;
    types.candidateId = { type: "string" };
  }
  if (input.conversationId) {
    where.push("conversation_id = @conversationId");
    params.conversationId = input.conversationId;
    types.conversationId = { type: "string" };
  }

  if (where.length > 0) {
    sql += ` WHERE ${where.join(" AND ")}`;
  }

  sql += " ORDER BY is_pinned DESC, created_at DESC LIMIT @lim";

  const [rows] = await db.run({ sql, params, types });
  const jsonRows = rows.map((r: any) => r.toJSON() as SpannerJson);
  const candidateIds = jsonRows
    .map((row: any) => (row.candidate_id ? String(row.candidate_id) : ""))
    .filter(Boolean);
  const candidateNames = await fetchCandidateNames(candidateIds);
  return jsonRows.map((row: any) => toSavedImageRecord(row, candidateNames));
}

export async function getSavedImageById(imageId: string): Promise<SavedImageRecord | null> {
  await ensureEvidenceTableExists();
  const db = getEvidenceDb();
  const [rows] = await db.run({
    sql: `SELECT image_id, storage_path, thumbnail_path, candidate_id, source_type, screen_type,
                 mode, mime_type, uploaded_by, conversation_id, is_pinned, tags_json,
                 last_used_at, created_at
          FROM saved_images
          WHERE image_id = @imageId
          LIMIT 1`,
    params: { imageId },
    types: { imageId: { type: "string" } },
  });

  if (rows.length === 0) return null;
  const data = rows[0].toJSON() as SpannerJson;
  const candidateId = data.candidate_id ? String(data.candidate_id) : "";
  const names = await fetchCandidateNames(candidateId ? [candidateId] : []);
  return toSavedImageRecord(data, names);
}

export async function setSavedImagePin(imageId: string, isPinned: boolean): Promise<void> {
  await ensureEvidenceTableExists();
  const db = getEvidenceDb();
  await db.runTransactionAsync(async (tx: any) => {
    await tx.runUpdate({
      sql: `UPDATE saved_images
            SET is_pinned = @isPinned
            WHERE image_id = @imageId`,
      params: { imageId, isPinned },
      types: {
        imageId: { type: "string" },
        isPinned: { type: "bool" },
      },
    });
    await tx.commit();
  });
}

export async function linkSavedImageCandidate(imageId: string, candidateId: string): Promise<void> {
  await ensureEvidenceTableExists();
  const db = getEvidenceDb();
  await db.runTransactionAsync(async (tx: any) => {
    await tx.runUpdate({
      sql: `UPDATE saved_images
            SET candidate_id = @candidateId
            WHERE image_id = @imageId`,
      params: { imageId, candidateId },
      types: {
        imageId: { type: "string" },
        candidateId: { type: "string" },
      },
    });
    await tx.commit();
  });
}

export async function markSavedImageUsed(imageId: string): Promise<void> {
  await ensureEvidenceTableExists();
  const db = getEvidenceDb();
  await db.runTransactionAsync(async (tx: any) => {
    await tx.runUpdate({
      sql: `UPDATE saved_images
            SET last_used_at = PENDING_COMMIT_TIMESTAMP()
            WHERE image_id = @imageId`,
      params: { imageId },
      types: { imageId: { type: "string" } },
    });
    await tx.commit();
  });
}

export async function getSavedImageContent(
  imageId: string
): Promise<{ bytes: Buffer; mimeType: string }> {
  const record = await getSavedImageById(imageId);
  if (!record) throw new Error("Image record not found");
  const bytes = await downloadFromGcs(record.storagePath);
  return { bytes, mimeType: record.mimeType };
}

export async function getEvidenceInlineData(
  imageId: string
): Promise<{ mimeType: string; data: string }> {
  const { bytes, mimeType } = await getSavedImageContent(imageId);
  return {
    mimeType,
    data: bytes.toString("base64"),
  };
}

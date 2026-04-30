import { ImageAnnotatorClient } from "@google-cloud/vision";
import { getCredentialDb } from "@/lib/spanner-pool";
import { requireEnv } from "@/lib/env";

const vision = new ImageAnnotatorClient();

export interface ExtractionResult {
  fullText: string;
  entities: any;
}

export interface SuggestionResult {
  candidateId: string;
  candidateName: string;
  reason: string;
}

export async function extractImageText(bytes: Buffer): Promise<ExtractionResult | null> {
  try {
    const [result] = await vision.documentTextDetection(bytes);
    const fullText = result.fullTextAnnotation?.text || "";
    return { fullText, entities: {} };
  } catch (error) {
    console.error(JSON.stringify({
      severity: "ERROR",
      module: "evidence",
      event: "vision_extraction_failed",
      message: error instanceof Error ? error.message : String(error)
    }));
    throw error;
  }
}

export async function saveScreenshotExtraction(
  imageId: string,
  actorId: string,
  storagePath: string,
  extraction: ExtractionResult | null,
  ocrStatus: string,
  visionError: string | null,
  matchStatus: string,
  suggestion: SuggestionResult | null
) {
  const db = getCredentialDb();
  await db.runTransactionAsync(async (tx: any) => {
    await tx.runUpdate({
      sql: `INSERT INTO screenshot_extractions (
              screenshot_id, actor_id, gcs_uri, full_text, detected_entities, 
              ocr_status, vision_error, candidate_match_status, 
              suggested_candidate_id, suggested_candidate_name, suggested_candidate_reason,
              extracted_at, matched_at
            ) VALUES (
              @screenshotId, @actorId, @gcsUri, @fullText, @detectedEntities,
              @ocrStatus, @visionError, @matchStatus,
              @suggestedCandidateId, @suggestedCandidateName, @suggestedCandidateReason,
              PENDING_COMMIT_TIMESTAMP(), PENDING_COMMIT_TIMESTAMP()
            )`,
      params: {
        screenshotId: imageId,
        actorId,
        gcsUri: `gs://${requireEnv("EVIDENCE_BUCKET")}/${storagePath}`,
        fullText: extraction?.fullText || null,
        detectedEntities: JSON.stringify(extraction?.entities || {}),
        ocrStatus,
        visionError: visionError || null,
        matchStatus,
        suggestedCandidateId: suggestion?.candidateId || null,
        suggestedCandidateName: suggestion?.candidateName || null,
        suggestedCandidateReason: suggestion?.reason || null
      },
      types: {
        screenshotId: { type: "string" },
        actorId: { type: "string" },
        gcsUri: { type: "string" },
        fullText: { type: "string" },
        detectedEntities: { type: "string" },
        ocrStatus: { type: "string" },
        visionError: { type: "string" },
        matchStatus: { type: "string" },
        suggestedCandidateId: { type: "string" },
        suggestedCandidateName: { type: "string" },
        suggestedCandidateReason: { type: "string" },
      },
    });
    await tx.commit();
  });
}

// Strict exact-match logic for candidates to simulate the suggested candidate name
export async function getScreenshotExtraction(imageId: string): Promise<ExtractionResult | null> {
  const db = getCredentialDb();
  const [rows] = await db.run({
    sql: `SELECT full_text, detected_entities FROM screenshot_extractions WHERE screenshot_id = @imageId LIMIT 1`,
    params: { imageId },
    types: { imageId: { type: "string" } },
  });
  if (rows.length === 0) return null;
  const data = rows[0].toJSON() as any;
  return {
    fullText: String(data.full_text || ""),
    entities: data.detected_entities ? JSON.parse(String(data.detected_entities)) : {},
  };
}

export async function suggestCandidateFromText(text: string): Promise<{ status: string, suggestion: SuggestionResult | null }> {
  if (!text) return { status: 'no_text', suggestion: null };

  // Extract ALL potential emails from OCR text
  const emailMatches = text.match(/[\w.-]+@[\w.-]+\.\w+/g);
  if (!emailMatches || emailMatches.length === 0) {
    return { status: 'no_email_found', suggestion: null };
  }

  // Fail closed if the document contains multiple distinct emails
  const uniqueEmails = Array.from(new Set(emailMatches.map(e => e.toLowerCase())));
  if (uniqueEmails.length !== 1) {
    console.warn(JSON.stringify({
      severity: "WARNING",
      module: "evidence",
      event: "ambiguous_candidate_match",
      message: `Found ${uniqueEmails.length} unique emails. Failing closed.`
    }));
    return { status: 'ambiguous_emails', suggestion: null };
  }

  const email = uniqueEmails[0];

  if (email) {
    const { getRecruitingDb } = await import("@/lib/spanner-pool");
    const db = getRecruitingDb();
    const [rows] = await db.run({
      sql: `SELECT candidate_id, display_name FROM Candidates WHERE LOWER(email) = @email LIMIT 2`,
      params: { email },
      types: { email: { type: "string" } }
    });
    // Fail closed on ambiguity: only return if exactly one match is found
    if (rows.length === 1) {
      const row = (rows[0] as any).toJSON();
      return {
        status: 'exact_email_match',
        suggestion: {
          candidateId: String(row.candidate_id),
          candidateName: String(row.display_name),
          reason: 'Exact email match from OCR'
        }
      };
    } else if (rows.length > 1) {
      return { status: 'ambiguous_db_match', suggestion: null };
    } else {
      return { status: 'email_not_in_db', suggestion: null };
    }
  }

  return { status: 'unknown', suggestion: null };
}

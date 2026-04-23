// ── Template Resolver ────────────────────────────────────────────
// Resolves templates by ID or search term.
// PRIMARY: Spanner email_templates table (read/write, live-editable)
// FALLBACK: Static template-catalog.ts (seed source, read-only)

import { getRecruitingDb } from "@/lib/spanner-pool";
import {
  OUTREACH_EMAIL_TEMPLATES,
  OPS_EMAIL_TEMPLATES,
  RESPONSE_EMAIL_TEMPLATES,
  type EmailTemplate,
} from "@/lib/ayaops/template-catalog";
import { buildTemplateLinks } from "./links";
import type { HubResponse } from "./candidate-resolver";

// ── Spanner row shape ───────────────────────────────────────────
interface TemplateRow {
  id: string;
  name: string;
  category: string;
  message_type: string;
  internal_only: boolean;
  subject_template: string;
  body_template: string;
  to_default: string | null;
  cc_default: string | null;
  required_fields: string;
  signature: string | null;
  version: number;
  is_active: boolean;
  updated_at: string;
}

// ── Static fallback pool (used when Spanner is unreachable) ─────
const ALL_STATIC_TEMPLATES: EmailTemplate[] = [
  ...OUTREACH_EMAIL_TEMPLATES,
  ...OPS_EMAIL_TEMPLATES,
  ...RESPONSE_EMAIL_TEMPLATES,
];

// ── Normalize for fuzzy search ──────────────────────────────────
function normalizeForSearch(input: string): string {
  return input
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Score a DB row against query ────────────────────────────────
function scoreDbMatch(row: TemplateRow, query: string): number {
  const normalizedQuery = normalizeForSearch(query);
  const normalizedId = normalizeForSearch(row.id);
  const normalizedName = normalizeForSearch(row.name);

  if (normalizedId === normalizedQuery) return 1.0;
  if (normalizedId.includes(normalizedQuery)) return 0.9;
  if (normalizedName.includes(normalizedQuery)) return 0.8;

  const queryWords = normalizedQuery.split(" ");
  const idWords = normalizedId.split(" ");
  const matchedWords = queryWords.filter((qw) =>
    idWords.some((iw) => iw.includes(qw) || qw.includes(iw))
  );
  if (matchedWords.length > 0) {
    return 0.5 + (matchedWords.length / queryWords.length) * 0.3;
  }

  return 0;
}

// ── Build hub response from a DB row ────────────────────────────
function buildResolvedResponse(row: TemplateRow): HubResponse {
  let requiredFields: string[] = [];
  try {
    requiredFields = JSON.parse(row.required_fields || "[]");
  } catch { /* safe default */ }

  const bodyWithSignature = row.signature
    ? `${row.body_template}\n\n${row.signature}`
    : row.body_template;

  return {
    type: "template",
    id: row.id,
    status: "resolved",
    summary: `${row.name} | ${row.message_type} | Required: [${requiredFields.join(", ")}]`,
    data: {
      id: row.id,
      name: row.name,
      category: row.category,
      messageType: row.message_type,
      internalOnly: row.internal_only,
      requiredFields,
      version: row.version,
      source: "spanner",
      blueprint: {
        subject: row.subject_template,
        body: bodyWithSignature,
        to: row.to_default || undefined,
        cc: row.cc_default || undefined,
      },
    },
    links: buildTemplateLinks(row.id, row.category || "outreach"),
  };
}

// ── Main resolver ───────────────────────────────────────────────
export async function resolveTemplate(identifier: string): Promise<HubResponse> {
  // Try Spanner first
  try {
    const db = getRecruitingDb();
    const [rows] = await db.run({
      sql: `SELECT id, name, category, message_type, internal_only,
                   subject_template, body_template, to_default, cc_default,
                   required_fields, signature, version, is_active, updated_at
            FROM email_templates
            WHERE is_active = true
            ORDER BY name`,
    });

    if (rows.length > 0) {
      const templates: TemplateRow[] = rows.map((r: any) => {
        const j = r.toJSON();
        return {
          id: String(j.id),
          name: String(j.name),
          category: String(j.category),
          message_type: String(j.message_type),
          internal_only: Boolean(j.internal_only),
          subject_template: String(j.subject_template),
          body_template: String(j.body_template),
          to_default: j.to_default ? String(j.to_default) : null,
          cc_default: j.cc_default ? String(j.cc_default) : null,
          required_fields: String(j.required_fields || "[]"),
          signature: j.signature ? String(j.signature) : null,
          version: Number(j.version || 1),
          is_active: Boolean(j.is_active),
          updated_at: j.updated_at ? String(j.updated_at) : "",
        };
      });

      const scored = templates
        .map((t) => ({ row: t, score: scoreDbMatch(t, identifier) }))
        .filter((e) => e.score > 0)
        .sort((a, b) => b.score - a.score);

      if (scored.length === 0) {
        // No match — return catalog listing
        return {
          type: "template",
          status: "not_found",
          summary: `No template matched "${identifier}". Available templates listed below.`,
          data: {
            source: "spanner",
            available: templates.map((t) => ({
              id: t.id,
              name: t.name,
              category: t.category,
              messageType: t.message_type,
              requiredFields: JSON.parse(t.required_fields || "[]"),
            })),
          },
          links: {},
        };
      }

      const best = scored[0];
      if (best.score >= 0.8) {
        return buildResolvedResponse(best.row);
      }

      // Ambiguous — return top matches
      const topMatches = scored.slice(0, 5);
      if (topMatches.length === 1) {
        return buildResolvedResponse(topMatches[0].row);
      }

      return {
        type: "template",
        status: "ambiguous",
        summary: `Multiple templates matched "${identifier}". Please clarify.`,
        data: null,
        links: {},
        alternatives: topMatches.map((entry) => ({
          name: entry.row.name,
          id: entry.row.id,
          nova_id: null,
          status: entry.row.category,
          specialty: entry.row.message_type,
          confidence: entry.score,
        })),
      };
    }
  } catch (err) {
    console.warn(`[template-resolver] Spanner read failed, falling back to static catalog:`, err);
  }

  // ── FALLBACK: Static catalog ──────────────────────────────────
  return resolveFromStaticCatalog(identifier);
}

// ── Static catalog fallback ─────────────────────────────────────
function resolveFromStaticCatalog(identifier: string): HubResponse {
  const scoreStaticMatch = (template: EmailTemplate, query: string): number => {
    const normalizedQuery = normalizeForSearch(query);
    const normalizedId = normalizeForSearch(template.id);
    const normalizedName = normalizeForSearch(template.name);

    if (normalizedId === normalizedQuery) return 1.0;
    if (normalizedId.includes(normalizedQuery)) return 0.9;
    if (normalizedName.includes(normalizedQuery)) return 0.8;

    const queryWords = normalizedQuery.split(" ");
    const idWords = normalizedId.split(" ");
    const matchedWords = queryWords.filter((qw) =>
      idWords.some((iw) => iw.includes(qw) || qw.includes(iw))
    );
    if (matchedWords.length > 0) {
      return 0.5 + (matchedWords.length / queryWords.length) * 0.3;
    }
    return 0;
  };

  const scores = ALL_STATIC_TEMPLATES.map((template) => ({
    template,
    score: scoreStaticMatch(template, identifier),
  }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scores.length === 0) {
    return {
      type: "template",
      status: "not_found",
      summary: `No template matched "${identifier}". Available templates listed below.`,
      data: {
        source: "static_fallback",
        available: ALL_STATIC_TEMPLATES.map((t) => ({
          id: t.id,
          name: t.name,
          category: t.category || "uncategorized",
          messageType: t.messageType || "email",
          requiredFields: t.requiredFields || [],
        })),
      },
      links: {},
    };
  }

  const best = scores[0];
  if (best.score >= 0.8) {
    const t = best.template;
    const blueprint = (typeof t.generateContent === 'function')
      ? t.generateContent({ name: "[CandidateName]", email: "[Email]", facility: "[Facility]", city: "[City]", state: "[State]", shiftType: "[Shift]", weeklyHours: 36, startDate: null, endDate: null, taxableRate: 0, weeklyStipend: 0, grossWeeklyPay: 0, specialty: "[Specialty]", jobId: null, candidateId: null, actualMargin: 0 })
      : null;

    return {
      type: "template",
      id: t.id,
      status: "resolved",
      summary: `${t.name} | ${t.messageType || "email"} | Required: [${(t.requiredFields || []).join(", ")}]`,
      data: {
        id: t.id,
        name: t.name,
        category: t.category || "uncategorized",
        messageType: t.messageType || "email",
        internalOnly: t.internalOnly || false,
        requiredFields: t.requiredFields || [],
        source: "static_fallback",
        blueprint,
      },
      links: buildTemplateLinks(t.id, t.category || "outreach"),
    };
  }

  return {
    type: "template",
    status: "ambiguous",
    summary: `Multiple templates matched "${identifier}". Please clarify.`,
    data: null,
    links: {},
    alternatives: scores.slice(0, 5).map((entry) => ({
      name: entry.template.name,
      id: entry.template.id,
      nova_id: null,
      status: entry.template.category || "outreach",
      specialty: entry.template.messageType || "email",
      confidence: entry.score,
    })),
  };
}

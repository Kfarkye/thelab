// ── Template Resolver ────────────────────────────────────────────
// Resolves templates by ID or search term against the template catalog.

import {
  OUTREACH_EMAIL_TEMPLATES,
  OPS_EMAIL_TEMPLATES,
  RESPONSE_EMAIL_TEMPLATES,
  type EmailTemplate,
} from "@/lib/ayaops/template-catalog";
import { buildTemplateLinks } from "./links";
import type { HubResponse } from "./candidate-resolver";

// Merge all template pools for search
const ALL_TEMPLATES: EmailTemplate[] = [
  ...OUTREACH_EMAIL_TEMPLATES,
  ...OPS_EMAIL_TEMPLATES,
  ...RESPONSE_EMAIL_TEMPLATES,
];

function normalizeForSearch(input: string): string {
  return input
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreMatch(template: EmailTemplate, query: string): number {
  const normalizedQuery = normalizeForSearch(query);
  const normalizedId = normalizeForSearch(template.id);
  const normalizedName = normalizeForSearch(template.name);

  // Exact ID match
  if (normalizedId === normalizedQuery) return 1.0;

  // ID contains query
  if (normalizedId.includes(normalizedQuery)) return 0.9;

  // Name contains query
  if (normalizedName.includes(normalizedQuery)) return 0.8;

  // Partial word match on ID segments
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

export async function resolveTemplate(identifier: string): Promise<HubResponse> {
  const scores = ALL_TEMPLATES.map((template) => ({
    template,
    score: scoreMatch(template, identifier),
  }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scores.length === 0) {
    // Return all available templates as a catalog
    return {
      type: "template",
      status: "not_found",
      summary: `No template matched "${identifier}". Available templates listed below.`,
      data: {
        available: ALL_TEMPLATES.map((t) => ({
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

  // If the best match is strong (> 0.8), resolve directly
  if (best.score >= 0.8) {
    const t = best.template;
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
      },
      links: buildTemplateLinks(t.id, t.category || "outreach"),
    };
  }

  // Multiple fuzzy matches — return top candidates
  const topMatches = scores.slice(0, 5);
  if (topMatches.length === 1) {
    const t = topMatches[0].template;
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
    alternatives: topMatches.map((entry) => ({
      name: entry.template.name,
      id: entry.template.id,
      nova_id: null,
      status: entry.template.category || "outreach",
      specialty: entry.template.messageType || "email",
      confidence: entry.score,
    })),
  };
}

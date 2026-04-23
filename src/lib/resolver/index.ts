// ── URL Hub: Universal Resource Resolver ──────────────────────────
// Core router that maps entity + identifier to the correct resolver.
// This is the single entry point for all `access_hub` tool calls.

import { resolveCandidate, type HubResponse } from "./candidate-resolver";
import { resolveTemplate } from "./template-resolver";
import { resolveFacility } from "./facility-resolver";
import { resolveJob } from "./job-resolver";

// Entity namespace normalization: handle singular/plural/casing
const ENTITY_ALIASES: Record<string, string> = {
  candidate: "candidates",
  candidates: "candidates",
  template: "templates",
  templates: "templates",
  facility: "facilities",
  facilities: "facilities",
  job: "jobs",
  jobs: "jobs",
};

/**
 * Parse a hub path into entity + identifier.
 * Handles:
 *   "candidates/Fontaine"
 *   "candidate/fontaine"
 *   "templates/initial-outreach"
 *   "Fontaine" (defaults to candidates)
 */
function parsePath(rawPath: string): { entity: string; identifier: string } {
  const trimmed = (rawPath || "").trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) {
    return { entity: "candidates", identifier: "" };
  }

  const slashIndex = trimmed.indexOf("/");
  if (slashIndex === -1) {
    // No slash — could be a bare name. Default to candidates.
    return { entity: "candidates", identifier: trimmed };
  }

  const entityRaw = trimmed.substring(0, slashIndex).toLowerCase();
  const identifier = trimmed.substring(slashIndex + 1).trim();
  const entity = ENTITY_ALIASES[entityRaw];

  if (!entity) {
    // Unknown entity prefix — treat the whole thing as a candidate search
    return { entity: "candidates", identifier: trimmed };
  }

  return { entity, identifier };
}

/**
 * Universal resolve function.
 * Routes to the correct entity resolver based on the path.
 */
export async function resolve(rawPath: string): Promise<HubResponse> {
  const { entity, identifier } = parsePath(rawPath);

  if (!identifier) {
    return {
      type: entity,
      status: "error",
      summary: `No identifier provided. Use: ${entity}/{name_or_id}`,
      data: null,
      links: {},
    };
  }

  switch (entity) {
    case "candidates":
      return resolveCandidate(identifier);

    case "templates":
      return resolveTemplate(identifier);

    case "facilities":
      return resolveFacility(identifier);

    case "jobs":
      return resolveJob(identifier);

    default:
      return {
        type: "unknown",
        status: "error",
        summary: `Unknown entity type: "${entity}". Valid: candidates, templates, facilities, jobs.`,
        data: null,
        links: {},
      };
  }
}

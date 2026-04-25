// ── URL Hub: Universal Resource Resolver ──────────────────────────
// Core router that maps entity + identifier to the correct resolver.
// This is the single entry point for all `access_hub` tool calls.

import {
  resolveCandidate,
  resolveCandidateCollection,
  type HubResponse,
} from "./candidate-resolver";
import { resolveTemplate } from "./template-resolver";
import { resolveFacility } from "./facility-resolver";
import { resolveJob } from "./job-resolver";
import { resolveGame } from "./game-resolver";
import { resolvePick } from "./pick-resolver";

// Entity namespace normalization: handle singular/plural/casing
const ENTITY_ALIASES: Record<string, string> = {
  candidate: "candidates",
  candidates: "candidates",
  dietitian: "candidates",
  dietitians: "candidates",
  template: "templates",
  templates: "templates",
  facility: "facilities",
  facilities: "facilities",
  job: "jobs",
  jobs: "jobs",
  game: "games",
  games: "games",
  match: "games",
  matches: "games",
  pick: "picks",
  picks: "picks",
};

const CANDIDATE_COLLECTION_IDENTIFIERS = new Set(["", "all", "list", "roster"]);
const STATUS_COLLECTION_IDENTIFIERS = new Set([
  "working",
  "active",
  "prestart",
  "pending_start",
  "pending",
  "pipeline",
  "in_pipeline",
  "submitted",
  "completed",
  "cancelled",
  "canceled",
]);

function looksLikeCandidateCollectionIdentifier(identifier: string): boolean {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) return true;
  if (CANDIDATE_COLLECTION_IDENTIFIERS.has(normalized)) return true;
  if (STATUS_COLLECTION_IDENTIFIERS.has(normalized)) return true;

  if (
    /\b(all|list|roster|show|find|get|pull|bring up|who|which|how many|top)\b/.test(normalized) &&
    /\b(candidates?|dietitians?|nurses?|travelers?|prestarts?|working|cold|replied|contracts?|submittals?)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  if (
    /\b(candidates?|dietitians?|nurses?|travelers?|prestarts?)\b/.test(normalized) ||
    /\bworking\b.*\bcandidates?\b/.test(normalized)
  ) {
    return true;
  }

  return false;
}

function stripCandidateLookupPreamble(identifier: string): string {
  const trimmed = identifier.trim();
  if (!trimmed) return "";

  const stripped = trimmed
    .replace(
      /^(show|find|get|pull up|pull|bring up|lookup|look up|open|check)\s+/i,
      "",
    )
    .replace(/^(candidate|candidates)\s+/i, "")
    .trim();

  return stripped || trimmed;
}

/**
 * Parse a hub path into entity + identifier.
 * Handles:
 *   "candidates/Fontaine"
 *   "candidate/fontaine"
 *   "templates/initial-outreach"
 *   "Fontaine" (defaults to candidates)
 */
function parsePath(rawPath: string): {
  entity: string;
  identifier: string;
  entityHint: string;
  query: URLSearchParams;
} {
  const raw = (rawPath || "").trim().replace(/^\/+|\/+$/g, "");
  const queryStart = raw.indexOf("?");
  const pathOnly = queryStart >= 0 ? raw.slice(0, queryStart) : raw;
  const queryString = queryStart >= 0 ? raw.slice(queryStart + 1) : "";
  const query = new URLSearchParams(queryString);
  const trimmed = pathOnly.trim();
  if (!trimmed) {
    return { entity: "candidates", identifier: "", entityHint: "candidates", query };
  }

  const slashIndex = trimmed.indexOf("/");
  if (slashIndex === -1) {
    const entityRaw = trimmed.toLowerCase();
    const entity = ENTITY_ALIASES[entityRaw];
    if (entity) {
      return { entity, identifier: "", entityHint: entityRaw, query };
    }
    // No slash and unknown entity token, treat as candidate identifier.
    return {
      entity: "candidates",
      identifier: stripCandidateLookupPreamble(trimmed),
      entityHint: "candidates",
      query,
    };
  }

  const entityRaw = trimmed.substring(0, slashIndex).toLowerCase();
  const identifier = trimmed.substring(slashIndex + 1).trim();
  const entity = ENTITY_ALIASES[entityRaw];

  if (!entity) {
    // Unknown entity prefix — treat the whole thing as a candidate search
    return {
      entity: "candidates",
      identifier: stripCandidateLookupPreamble(trimmed),
      entityHint: "candidates",
      query,
    };
  }

  return { entity, identifier, entityHint: entityRaw, query };
}

/**
 * Universal resolve function.
 * Routes to the correct entity resolver based on the path.
 */
export async function resolve(rawPath: string): Promise<HubResponse> {
  const { entity, identifier, entityHint, query } = parsePath(rawPath);
  const shouldResolveCandidateCollection =
    entity === "candidates" &&
    (query.size > 0 ||
      looksLikeCandidateCollectionIdentifier(identifier) ||
      (entityHint === "dietitian" || entityHint === "dietitians") ||
      STATUS_COLLECTION_IDENTIFIERS.has(identifier.toLowerCase()));

  if (shouldResolveCandidateCollection) {
    return resolveCandidateCollection({
      identifier,
      query,
      entityHint,
    });
  }

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
      return resolveCandidate(stripCandidateLookupPreamble(identifier));

    case "templates":
      return resolveTemplate(identifier);

    case "facilities":
      return resolveFacility(identifier);

    case "jobs":
      return resolveJob(identifier);

    case "games":
      return resolveGame(identifier);

    case "picks":
      return resolvePick(identifier);

    default:
      return {
        type: "unknown",
        status: "error",
        summary: `Unknown entity type: "${entity}". Valid: candidates, templates, facilities, jobs, games, picks.`,
        data: null,
        links: {},
      };
  }
}

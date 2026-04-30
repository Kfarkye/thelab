export const MAX_ARTIFACT_CODE_SIZE = 120_000;
export const MAX_ARTIFACT_PREVIEW_SIZE = 250_000;

export type ArtifactIntent = {
  intent: "generate_artifact";
  artifact_type: "react" | "html" | "email" | "page";
  description: string;
  destination_hint: string | null;
};

const ARTIFACT_TYPES = new Set(["react", "html", "email", "page"]);
const BANNED_VOCAB = ["maximize", "optimize", "leverage", "streamline", "seamlessly", "harness", "innovative"];
const BANNED_FONTS = ["Inter", "Roboto", "Poppins", "Arial"];
const ALLOWED_DESTINATIONS = [
  /^src\/components\/generated\/[a-zA-Z0-9_-]+\.tsx$/,
  /^src\/app\/generated\/[a-zA-Z0-9_-]+\/page\.tsx$/,
  /^src\/emails\/generated\/[a-zA-Z0-9_-]+\.tsx$/,
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

export function parseArtifactIntent(input: unknown): ArtifactIntent {
  const obj = asRecord(input);
  if (obj.intent !== "generate_artifact") throw new Error("INVALID_INTENT");

  const artifactType = readString(obj.artifact_type) || "react";
  if (!ARTIFACT_TYPES.has(artifactType)) throw new Error("INVALID_TYPE");

  const description = readString(obj.description);
  if (description.length < 10) throw new Error("DESCRIPTION_TOO_THIN_FOR_GROUNDING");

  return {
    intent: "generate_artifact",
    artifact_type: artifactType as ArtifactIntent["artifact_type"],
    description,
    destination_hint: readString(obj.destination_hint) || null,
  };
}

export function validateArtifactDestination(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..")) throw new Error("PATH_TRAVERSAL");
  if (!ALLOWED_DESTINATIONS.some((pattern) => pattern.test(normalized))) {
    throw new Error("UNAUTHORIZED_DESTINATION");
  }
  return normalized;
}

export function evaluateArtifactGovernance(input: {
  code: string;
  html: string;
  proposedDestination?: string | null;
}): string[] {
  const violations: string[] = [];
  const content = `${input.code}\n${input.html}`;

  for (const word of BANNED_VOCAB) {
    if (new RegExp(`\\b${word}\\b`, "i").test(content)) {
      violations.push(`BANNED_VOCAB:${word}`);
    }
  }

  for (const font of BANNED_FONTS) {
    if (new RegExp(`\\b${font}\\b`, "i").test(content)) {
      violations.push(`BANNED_FONT_SMELL:${font}`);
    }
  }

  if (/\bdark:/i.test(content) || /\b(bg-black|text-white)\b/i.test(content)) {
    violations.push("CONSUMER_SURFACE_LIGHT_MODE_VIOLATION");
  }

  if (content.includes("data:image/") || content.includes("base64,") || content.includes("clip-path")) {
    violations.push("SYNTHETIC_ASSET_VIOLATION");
  }

  if (content.includes("Search failed") || content.includes("/api/search")) {
    violations.push("UNGROUNDED_SEARCH_SURFACE");
  }

  if (input.proposedDestination) {
    try {
      validateArtifactDestination(input.proposedDestination);
    } catch (error) {
      violations.push(error instanceof Error ? error.message : "INVALID_DESTINATION");
    }
  }

  return violations;
}

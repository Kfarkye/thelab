import { Octokit } from "@octokit/rest";
import { GITHUB_TOKEN } from "@/lib/env";

export type GovernanceRule = {
  verdict: string;
  details: string;
  status: string;
  [key: string]: unknown;
};

export interface CachedConstitution {
  version: string;
  timestamp: string;
  fetchedAt: number;
  rules: GovernanceRule[];
}

const CONSTITUTION_TTL_MS = 5 * 60 * 1000;
const DEFAULT_OWNER = "Kfarkye";
const DEFAULT_REPO = "thelab";
const DEFAULT_PATH = "docs/ledger/recruiter-voice.json";

let cachedConstitution: CachedConstitution | null = null;
const ALLOWED_PATHS = ["architecture-ledger/rules.json", "docs/ledger/recruiter-voice.json"];
const STRICT_BLOCKLIST = [".env", "private_keys", "secrets", "package.json"];

function isConstitutionFresh(cache: CachedConstitution): boolean {
  return Date.now() - cache.fetchedAt < CONSTITUTION_TTL_MS;
}

function assertPathIsAllowed(path: string): void {
  if (STRICT_BLOCKLIST.some((blockedPath) => path.includes(blockedPath))) {
    throw new Error(`Security Violation: Path ${path} is in the strict blocklist.`);
  }
  if (!ALLOWED_PATHS.includes(path)) {
    throw new Error(`Security Violation: Path ${path} is not in the allowlist.`);
  }
}

function extractAcceptedRules(rawContent: string): GovernanceRule[] {
  const parsed = JSON.parse(rawContent) as unknown;
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries.filter((entry): entry is GovernanceRule => {
    if (!entry || typeof entry !== "object") return false;
    const status = (entry as { status?: unknown }).status;
    return typeof status === "string" && status.toLowerCase() === "accepted";
  });
}

export function invalidateConstitutionCache(): void {
  cachedConstitution = null;
}

export async function getCachedConstitution(
  owner = DEFAULT_OWNER,
  repo = DEFAULT_REPO,
  path = DEFAULT_PATH,
): Promise<CachedConstitution> {
  if (cachedConstitution && isConstitutionFresh(cachedConstitution)) {
    return cachedConstitution;
  }

  assertPathIsAllowed(path);

  const octokit = new Octokit({ auth: GITHUB_TOKEN });

  try {
    const { data: ref } = await octokit.git.getRef({ owner, repo, ref: "heads/codex-handoff-v50" });
    const { data: content } = await octokit.repos.getContent({ owner, repo, path });

    if (Array.isArray(content) || content.type !== "file") {
      throw new Error(`Path ${path} did not return a single file.`);
    }

    const decodedContent = Buffer.from(content.content, "base64").toString("utf-8");
    const rules = extractAcceptedRules(decodedContent);

    cachedConstitution = {
      version: ref.object.sha,
      timestamp: new Date().toISOString(),
      fetchedAt: Date.now(),
      rules,
    };

    return cachedConstitution;
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Falling back to local Git-as-Governance caching.");
      cachedConstitution = {
        version: "local-dev-fallback",
        timestamp: new Date().toISOString(),
        fetchedAt: Date.now(),
        rules: [],
      };
      return cachedConstitution;
    }
    throw error;
  }
}

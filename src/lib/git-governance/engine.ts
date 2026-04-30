import { Octokit } from "@octokit/rest";
import { GITHUB_TOKEN } from "@/lib/env";

export type GovernanceRule = {
  verdict: string;
  details: string;
  status: string;
  [key: string]: unknown;
};

export interface CachedConstitution {
  source: "github";
  ledgerPath: string;
  version: string;
  ledgerBlobSha: string | null;
  timestamp: string;
  fetchedAt: number;
  ruleCount: number;
  ruleVerdicts: string[];
  rules: GovernanceRule[];
}

const CONSTITUTION_TTL_MS = 5 * 60 * 1000;
const DEFAULT_OWNER = "Kfarkye";
const DEFAULT_REPO = "thelab";
const DEFAULT_PATH = "docs/ledger/recruiter-voice.json";
const DEFAULT_REF = "codex-handoff-v50";
const ACTIVE_RULES_PATH = "docs/ledger/active_rules.json";

const cachedConstitutions: Record<string, CachedConstitution> = {};
const ALLOWED_PATHS = [
  "architecture-ledger/rules.json",
  "docs/ledger/active_rules.json",
  "docs/ledger/recruiter-voice.json",
  "docs/ledger/code-engineering.json",
];
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

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

export function invalidateConstitutionCache(path?: string): void {
  if (path) {
    delete cachedConstitutions[path];
  } else {
    for (const key in cachedConstitutions) {
      delete cachedConstitutions[key];
    }
  }
}

export async function getCachedConstitution(
  owner = DEFAULT_OWNER,
  repo = DEFAULT_REPO,
  path = DEFAULT_PATH,
): Promise<CachedConstitution> {
  const existing = cachedConstitutions[path];
  if (existing && isConstitutionFresh(existing)) {
    return existing;
  }

  assertPathIsAllowed(path);

  const octokit = new Octokit({ auth: GITHUB_TOKEN });

  try {
    const { data: ref } = await octokit.git.getRef({ owner, repo, ref: `heads/${DEFAULT_REF}` });
    const { data: content } = await octokit.repos.getContent({ owner, repo, path, ref: DEFAULT_REF });

    if (Array.isArray(content) || content.type !== "file") {
      throw new Error(`Path ${path} did not return a single file.`);
    }

    const decodedContent = Buffer.from(content.content, "base64").toString("utf-8");
    const rules = extractAcceptedRules(decodedContent);
    if (path === ACTIVE_RULES_PATH && rules.length === 0 && isProductionRuntime()) {
      throw new Error("Active governance ledger returned zero accepted rules.");
    }
    const ruleVerdicts = rules.map((rule) => rule.verdict);

    const newCache: CachedConstitution = {
      source: "github",
      ledgerPath: path,
      version: ref.object.sha,
      ledgerBlobSha: content.sha || null,
      timestamp: new Date().toISOString(),
      fetchedAt: Date.now(),
      ruleCount: rules.length,
      ruleVerdicts,
      rules,
    };
    
    cachedConstitutions[path] = newCache;
    return newCache;
  } catch (error) {
    if (!isProductionRuntime()) {
      console.warn(`Falling back to local Git-as-Governance caching for ${path}.`);
      const fallback: CachedConstitution = {
        source: "github",
        ledgerPath: path,
        version: "local-dev-fallback",
        ledgerBlobSha: null,
        timestamp: new Date().toISOString(),
        fetchedAt: Date.now(),
        ruleCount: 0,
        ruleVerdicts: [],
        rules: [],
      };
      cachedConstitutions[path] = fallback;
      return fallback;
    }
    throw error;
  }
}

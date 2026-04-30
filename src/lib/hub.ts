import { requireEnv } from "@/lib/env";

type MergeState = {
  merged: boolean;
  sha: string | null;
};

type PullReference = {
  owner: string;
  repo: string;
  pullNumber: string;
};

function readString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function parsePullReference(pullId: string): PullReference {
  const raw = readString(pullId);
  const urlMatch = raw.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      pullNumber: urlMatch[3],
    };
  }

  const shortMatch = raw.match(/^([^/\s]+)\/([^/\s]+)#(\d+)$/);
  if (shortMatch) {
    return {
      owner: shortMatch[1],
      repo: shortMatch[2],
      pullNumber: shortMatch[3],
    };
  }

  if (/^\d+$/.test(raw)) {
    return {
      owner: requireEnv("GITHUB_REPO_OWNER"),
      repo: requireEnv("GITHUB_REPO_NAME"),
      pullNumber: raw,
    };
  }

  throw new Error("INVALID_PULL_REFERENCE");
}

async function githubRequest(method: string, path: string): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${requireEnv("GITHUB_TOKEN")}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : `GitHub API ${res.status}`;
    throw new Error(message);
  }

  return body;
}

export const access_hub = {
  async getMergeState(pullId: string): Promise<MergeState> {
    const ref = parsePullReference(pullId);
    const data = await githubRequest(
      "GET",
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/pulls/${encodeURIComponent(ref.pullNumber)}`,
    );
    const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    return {
      merged: Boolean(record.merged),
      sha: readString(record.merge_commit_sha) || null,
    };
  },

  async mergePR(pullId: string): Promise<{ sha: string }> {
    const ref = parsePullReference(pullId);
    const data = await githubRequest(
      "PUT",
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/pulls/${encodeURIComponent(ref.pullNumber)}/merge`,
    );
    const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const sha = readString(record.sha);
    if (!sha) throw new Error("MERGE_SHA_MISSING");
    return { sha };
  },
};

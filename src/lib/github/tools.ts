// ── GitHub Tools — File read, branch create, PR open ────────────
// Utility functions for interacting with the GitHub API.
// Used by the auto-improve route to read files and push changes.

import { requireEnv } from "@/lib/env";

type ReadFileResult = {
  path: string;
  content: string;
  sha: string;
  encoding: string;
};

export type GitHubConfig = {
  owner: string;
  repo: string;
  token: string;
  baseBranch: string;
};

let _configOverride: GitHubConfig | null = null;

export function setGitHubConfigOverride(config: GitHubConfig | null) {
  _configOverride = config;
}

function getRepoConfig(): GitHubConfig {
  if (_configOverride) return _configOverride;
  return {
    owner: requireEnv("GITHUB_REPO_OWNER"),
    repo: requireEnv("GITHUB_REPO_NAME"),
    token: requireEnv("GITHUB_TOKEN"),
    baseBranch: process.env.GITHUB_BASE_BRANCH || "main",
  };
}

export type ProcessCodeChangeParams = {
  prTitle?: string;
  commitMessage: string;
  files: Array<{ path: string; content: string }>;
  branch?: string;
  reviewStatus?: string;
};

function sanitizeBranch(raw: string): string {
  const trimmed = String(raw || "").trim();

  // Replace disallowed characters
  const safe = trimmed.replace(/[^a-zA-Z0-9\-_/.]/g, "-");

  if (!safe) {
    throw new Error("Branch name must contain at least one valid character");
  }

  // Block names that look like they could be destructive
  if (/\.\.|~|\^|:|\\|\s/.test(safe)) {
    throw new Error("Branch name is invalid");
  }

  return safe;
}

async function githubRequest(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const url = `https://api.github.com${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const data = res.status === 204 ? null : await res.json();

  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "message" in data
        ? String((data as { message: string }).message)
        : `GitHub API ${res.status}`;
    throw new Error(`GitHub API error (${res.status}): ${msg}`);
  }

  return { status: res.status, data };
}

export async function readRepoFile(
  path: string,
  branch?: string,
): Promise<ReadFileResult | null> {
  const config = getRepoConfig();
  const cleanPath = String(path || "").trim().replace(/^\/+/, "");
  if (!cleanPath) throw new Error("path is required");

  const ref = branch || config.baseBranch;
  try {
    const { data } = await githubRequest(
      config.token,
      "GET",
      `/repos/${config.owner}/${config.repo}/contents/${cleanPath}?ref=${ref}`,
    );

    if (!data || typeof data !== "object") return null;
    const fileData = data as {
      content?: string;
      sha?: string;
      encoding?: string;
    };

    if (!fileData.content) return null;

    const decoded =
      fileData.encoding === "base64"
        ? Buffer.from(fileData.content, "base64").toString("utf8")
        : fileData.content;

    return {
      path: cleanPath,
      content: decoded,
      sha: String(fileData.sha || ""),
      encoding: String(fileData.encoding || "base64"),
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("404")) {
      return null;
    }
    throw err;
  }
}

async function getBaseSha(
  token: string,
  owner: string,
  repo: string,
  baseBranch: string,
): Promise<string> {
  const { data } = await githubRequest(
    token,
    "GET",
    `/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`,
  );
  const refData = data as {
    object?: { sha?: string };
  };
  if (!refData?.object?.sha) {
    throw new Error(`Could not resolve HEAD SHA for ${baseBranch}`);
  }
  return refData.object.sha;
}

export async function readRepoFileByPath(path: string, branch?: string): Promise<string | null> {
  const result = await readRepoFile(path, branch);
  return result?.content ?? null;
}

export async function processCodeChange(
  params: ProcessCodeChangeParams,
): Promise<{ prUrl: string; branch: string; filesChanged: number }> {
  const { owner, repo, token, baseBranch } = getRepoConfig();
  const { commitMessage, files, reviewStatus } = params;

  const cleanPath = String(params.branch || `auto-improve/${Date.now()}`);
  const branch = sanitizeBranch(cleanPath);

  if (!files?.length) {
    throw new Error("At least one file is required");
  }

  // 1. Get base SHA
  const baseSha = await getBaseSha(token, owner, repo, baseBranch);

  // 2. Create branch
  const ref = `refs/heads/${branch}`;
  try {
    await githubRequest(token, "POST", `/repos/${owner}/${repo}/git/refs`, {
      ref,
      sha: baseSha,
    });
  } catch (err) {
    // Branch may already exist — try to update it
    if (err instanceof Error && err.message.includes("422")) {
      await githubRequest(
        token,
        "PATCH",
        `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
        { sha: baseSha, force: true },
      );
    } else {
      throw err;
    }
  }

  // 3. Create/update files on the branch
  for (const file of files) {
    const filePath = String(file.path).replace(/^\/+/, "");
    const encoded = Buffer.from(file.content, "utf8").toString("base64");

    // Check if file exists for update (need sha)
    let fileSha: string | undefined;
    try {
      const existing = await readRepoFile(filePath, branch);
      if (existing) fileSha = existing.sha;
    } catch {
      // New file
    }

    await githubRequest(
      token,
      "PUT",
      `/repos/${owner}/${repo}/contents/${filePath}`,
      {
        message: commitMessage,
        content: encoded,
        branch,
        ...(fileSha ? { sha: fileSha } : {}),
      },
    );
  }

  // 4. Create PR
  const prTitle =
    params.prTitle || `Auto-improve: ${commitMessage.slice(0, 60)}`;
  const prBody = [
    `## Auto-Improve Proposal`,
    ``,
    `**Commit message:** ${commitMessage}`,
    `**Files changed:** ${files.length}`,
    reviewStatus ? `**Review status:** ${reviewStatus}` : null,
    ``,
    `---`,
    `_Generated by the auto-improve pipeline._`,
  ]
    .filter(Boolean)
    .join("\n");

  const { data } = await githubRequest(
    token,
    "POST",
    `/repos/${owner}/${repo}/pulls`,
    {
      title: prTitle,
      body: prBody,
      head: branch,
      base: baseBranch,
    },
  );

  const prData = data as { html_url?: string };
  return {
    prUrl: String(prData?.html_url || ""),
    branch,
    filesChanged: files.length,
  };
}

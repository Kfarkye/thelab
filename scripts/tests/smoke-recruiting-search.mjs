import { execFileSync } from "child_process";

const DEFAULT_BASE_URL = "https://gemini3-chat-1049576459547.us-central1.run.app";
const host = process.env.RECRUITING_SEARCH_BASE_URL
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : DEFAULT_BASE_URL);

const packageId = process.env.RECRUITING_SEARCH_PACKAGE_ID || "AYA.PKG.JOB123";
const searchQuery = process.env.RECRUITING_SEARCH_QUERY || "Dietitian";

async function getAuthToken() {
  if (process.env.RECRUITING_SEARCH_AUTH_TOKEN) return process.env.RECRUITING_SEARCH_AUTH_TOKEN;
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET;

  try {
    console.log("Fetching OIDC token via google-auth-library...");
    const token = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          import { GoogleAuth } from "google-auth-library";
          const audience = process.env.TARGET_AUDIENCE;
          const auth = new GoogleAuth();
          const client = await auth.getIdTokenClient(audience);
          const headers = await client.getRequestHeaders(audience);
          const authorization = headers.Authorization || headers.authorization;
          if (!authorization || !authorization.startsWith("Bearer ")) {
            throw new Error("google-auth-library did not return a bearer token");
          }
          console.log(authorization.slice("Bearer ".length));
        `,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, TARGET_AUDIENCE: host },
        timeout: 15_000,
      },
    ).trim();
    if (token) return token;
  } catch (error) {
    console.warn(
      `google-auth-library OIDC fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    console.log("Fetching OIDC token via gcloud user fallback...");
    return execFileSync("gcloud", ["auth", "print-identity-token"], { encoding: "utf8" }).trim();
  } catch (error) {
    throw new Error(
      "Unable to fetch an auth token. Configure Application Default Credentials or run gcloud auth login.",
    );
  }
}

function printInputs() {
  console.log("Recruiting search smoke inputs:");
  console.log(`  Base URL: ${host}`);
  console.log(`  Package ID: ${packageId}`);
  console.log(`  Search Query: ${searchQuery}`);
}

async function readResponse(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function run() {
  const authToken = await getAuthToken();
  printInputs();

  const res = await fetch(`${host}/api/recruiting/match`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      packageId,
      searchQuery,
    }),
  });

  console.log(`Status: ${res.status}`);
  const data = await readResponse(res);
  console.dir(data, { depth: null });

  if (!res.ok) {
    throw new Error(`Recruiting search smoke failed with HTTP ${res.status}.`);
  }

  if (!data || data.ok !== true || data.source !== "spanner_search" || !Array.isArray(data.matches)) {
    throw new Error("Recruiting search response did not match the expected spanner_search shape.");
  }

  if (data.matches.length === 0) {
    throw new Error("Recruiting search returned no matches.");
  }

  const missingNovaUrl = data.matches.find((match) => !String(match.nova_url || "").includes("nova.ayahealthcare.com"));
  if (missingNovaUrl) {
    throw new Error(`Match ${missingNovaUrl.candidate_id} is missing a Nova URL.`);
  }

  const nonZeroMatch = data.matches.find((match) => Number(match.distance_miles) > 0);
  if (!nonZeroMatch) {
    throw new Error("Expected at least one canonical hc_candidates match to return a non-zero distance.");
  }
  const nullDistanceMatch = data.matches.find((match) => match.distance_miles === null);
  if (!nullDistanceMatch) {
    throw new Error("Expected at least one canonical hc_candidates match without coordinates to return null distance.");
  }
  console.log(
    `Distance verification passed: ${nonZeroMatch.candidate_name} is ${nonZeroMatch.distance_miles} miles away.`,
  );
  console.log(
    `Optional-location verification passed: ${nullDistanceMatch.candidate_name} returned null distance.`,
  );

  console.log(`Recruiting search smoke passed with ${data.matches.length} matches.`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

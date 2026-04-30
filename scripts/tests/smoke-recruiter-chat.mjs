import { execFileSync } from "child_process";

const baseUrl = "https://gemini3-chat-1049576459547.us-central1.run.app";
const queries = [
  { input: "Find me Med Surg RNs near LA", expectEmpty: false },
  { input: "Show respiratory therapist candidates near the Bay", expectEmpty: false },
  { input: "Any active RN candidates?", expectEmpty: false },
  { input: "Find PT candidates in California", expectEmpty: true, emptyReason: "likely_data_gap" },
  { input: "Dietitians in Sacramento", expectEmpty: false },
];

function write(line = "") {
  process.stdout.write(`${line}\n`);
}

function getAuthToken() {
  try {
    write("Fetching OIDC token via google-auth-library...");
    const token = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          import { GoogleAuth } from "google-auth-library";
          const audience = "${baseUrl}";
          const auth = new GoogleAuth();
          const client = await auth.getIdTokenClient(audience);
          const headers = await client.getRequestHeaders(audience);
          const authorization = headers.Authorization || headers.authorization;
          if (!authorization || !authorization.startsWith("Bearer ")) {
            throw new Error("google-auth-library did not return a bearer token");
          }
          process.stdout.write(authorization.slice("Bearer ".length));
        `,
      ],
      { encoding: "utf8", timeout: 15_000 },
    ).trim();
    if (token) return token;
  } catch (error) {
    write(`google-auth-library OIDC fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  write("Fetching OIDC token via gcloud user fallback...");
  return execFileSync("gcloud", ["auth", "print-identity-token"], { encoding: "utf8" }).trim();
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function recentEventCount(eventName) {
  const sql = `
    SELECT COUNT(*)
    FROM recruiting_queries
    WHERE natural_language_input = '${eventName}'
      AND created_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 15 MINUTE)
  `;
  const output = execFileSync(
    "gcloud",
    [
      "spanner",
      "databases",
      "execute-sql",
      "recruitingdb",
      "--instance=game-data",
      `--sql=${sql}`,
      "--format=json",
    ],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(output);
  return Number(parsed.rows?.[0]?.[0] || 0);
}

async function ask(token, query) {
  const startedAt = Date.now();
  const res = await fetch(`${baseUrl}/api/recruiting/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ input: query.input, conversation_id: null }),
  });
  const data = await readJson(res);
  const wallMs = Date.now() - startedAt;

  write("");
  write(`Query: ${query.input}`);
  write(`Status: ${res.status}`);
  write(`Wall latency: ${wallMs}ms`);
  write(`Summary: ${data?.summary || "n/a"}`);
  write(`Candidate count: ${Array.isArray(data?.candidates) ? data.candidates.length : "n/a"}`);
  write(`Empty reason: ${data?.empty_reason || "n/a"}`);

  if (!res.ok) throw new Error(`Recruiter chat smoke failed with HTTP ${res.status}`);
  if (wallMs >= 3000) throw new Error(`Recruiter chat expected latency under 3000ms, got ${wallMs}ms.`);
  if (!data || typeof data.summary !== "string" || !Array.isArray(data.candidates)) {
    throw new Error("Recruiter chat response shape is invalid.");
  }
  if (query.expectEmpty) {
    if (data.candidates.length !== 0) throw new Error("Expected empty result set.");
    if (data.empty_reason !== query.emptyReason) {
      throw new Error(`Expected empty_reason ${query.emptyReason}, got ${data.empty_reason}.`);
    }
  } else {
    if (data.candidates.length === 0) throw new Error("Expected non-empty candidates.");
    const availableLinks = data.candidates.filter((candidate) => candidate.nova_url).length;
    if (availableLinks === 0) throw new Error("Expected at least one candidate with a Nova URL.");
  }
}

async function run() {
  const token = getAuthToken();
  for (const query of queries) {
    await ask(token, query);
  }

  const searchEvents = recentEventCount("AYA.EVT.CANDIDATE_SEARCH");
  write("");
  write(`Recent AYA.EVT.CANDIDATE_SEARCH rows: ${searchEvents}`);
  if (searchEvents < queries.length) {
    throw new Error(`Expected at least ${queries.length} recent candidate search events.`);
  }

  const missingNovaEvents = recentEventCount("AYA.EVT.DATA_QUALITY.MISSING_NOVA_ID");
  write(`Recent AYA.EVT.DATA_QUALITY.MISSING_NOVA_ID rows: ${missingNovaEvents}`);
  write("Recruiter chat smoke passed with 5 recruiter queries.");
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});

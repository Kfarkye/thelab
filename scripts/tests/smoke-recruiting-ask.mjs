import { execFileSync } from "child_process";

const baseUrl = "https://gemini3-chat-1049576459547.us-central1.run.app";
const questions = [
  "dietitians near San Francisco",
  "RNs available before May 15",
  "medsurg RN close to Los Angeles",
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

async function readResponse(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function getLoggedSql(queryId) {
  const sql = `SELECT generated_sql FROM recruiting_queries WHERE query_id = '${queryId}'`;
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
  return parsed.rows?.[0]?.[0] || "";
}

async function ask(token, input) {
  const startedAt = Date.now();
  const res = await fetch(`${baseUrl}/api/recruiting/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ input }),
  });
  const data = await readResponse(res);
  const wallMs = Date.now() - startedAt;

  write("");
  write(`Question: ${input}`);
  write(`Status: ${res.status}`);
  write(`Wall latency: ${wallMs}ms`);
  write(`Response: ${JSON.stringify(data, null, 2)}`);

  if (!res.ok) throw new Error(`Ask smoke failed with HTTP ${res.status}`);
  if (!data || !Array.isArray(data.matches) || data.matches.length === 0) {
    throw new Error("Ask smoke expected non-empty matches.");
  }
  if (!data.queryId || typeof data.queryId !== "string") {
    throw new Error("Ask smoke expected queryId.");
  }
  if (!Number.isFinite(Number(data.latencyMs)) || Number(data.latencyMs) >= 2000) {
    throw new Error(`Ask smoke expected latency under 2000ms, got ${data.latencyMs}.`);
  }
  if (/\bnear\b|\bclose to\b|\bwithin\b/i.test(input)) {
    const distances = data.matches.map((match) => match.distance_miles);
    const firstNullIndex = distances.findIndex((distance) => distance === null);
    const hasNonNullAfterNull = firstNullIndex >= 0 && distances
      .slice(firstNullIndex + 1)
      .some((distance) => distance !== null);
    if (hasNonNullAfterNull) {
      throw new Error("Ask smoke expected coordinated candidates to sort before null-distance candidates.");
    }
    if (/dietitians near San Francisco/i.test(input)) {
      const hasKnownDistance = distances.some((distance) => distance !== null);
      const hasNullDistance = distances.some((distance) => distance === null);
      if (!hasKnownDistance || !hasNullDistance) {
        throw new Error("Ask smoke expected a mixed known/null distance result set for dietitians near San Francisco.");
      }
    }
  }

  const generatedSql = getLoggedSql(data.queryId);
  if (!generatedSql) throw new Error(`No generated SQL logged for query ${data.queryId}.`);
  write("Generated SQL:");
  write(generatedSql);
}

async function run() {
  const token = getAuthToken();
  for (const question of questions) {
    await ask(token, question);
  }
  write("");
  write("Recruiting ask smoke passed with 3 natural language queries.");
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});

import { execFileSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const baseUrl = "https://gemini3-chat-1049576459547.us-central1.run.app";
const queriesPath = resolve(repoRoot, "scripts/querydata/validation-queries.json");

function write(line = "") {
  process.stdout.write(`${line}\n`);
}

function loadQueries() {
  return JSON.parse(readFileSync(queriesPath, "utf8"));
}

function getAuthToken() {
  try {
    write(JSON.stringify({ event: "auth_attempt", provider: "google-auth-library" }));
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
    write(JSON.stringify({
      event: "auth_attempt_failed",
      provider: "google-auth-library",
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  write(JSON.stringify({ event: "auth_attempt", provider: "gcloud" }));
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

function getAuditRow(queryId) {
  const sql = `SELECT actor_id, generated_sql, result_count, latency_ms FROM recruiting_queries WHERE query_id = '${queryId}'`;
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
  const row = parsed.rows?.[0];
  return row
    ? { actorId: row[0], generatedSql: row[1], resultCount: Number(row[2]), latencyMs: Number(row[3]) }
    : { actorId: "", generatedSql: "", resultCount: 0, latencyMs: 0 };
}

function mentionsSpecialty(input) {
  return /\b(dietit?i?ans?|dietician|rn|rns|registered nurses?|nurses?|med[\s-]?surg|medsurg|pt|physical therapist|ot|occupational therapist|rt|respiratory)/i.test(input);
}

function flagsFor(input, generatedSql, resultCount, latencyMs) {
  const flags = [];
  const normalizedSql = generatedSql.replace(/\s+/g, " ").trim();
  if (resultCount === 0) flags.push("zero results");
  if (latencyMs > 2000) flags.push("latency over 2000ms");
  if (/\bLIMIT\b/i.test(normalizedSql) && !/\bORDER\s+BY\b/i.test(normalizedSql)) {
    flags.push("LIMIT without ORDER BY");
  }
  if (mentionsSpecialty(input) && !/SEARCH\s*\(\s*c\.search_tokens|SEARCH\s*\(\s*search_tokens/i.test(normalizedSql)) {
    flags.push("specialty mentioned but SQL missing search_tokens predicate");
  }
  return flags;
}

function escapeMd(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function codeBlock(value) {
  return `\`\`\`sql\n${String(value || "").trim()}\n\`\`\``;
}

function recommend(results) {
  const recommendations = [];
  const flagged = results.filter((entry) => entry.flags.length > 0);
  if (flagged.some((entry) => /dietitan|dietician/i.test(entry.input))) {
    recommendations.push("Add value-search aliases for dietitan and dietician to Dietitian.");
  }
  if (flagged.some((entry) => /\bthe bay\b|\bbay\b/i.test(entry.input))) {
    recommendations.push("Add a geographic alias for 'the bay' / 'Bay Area' with San Francisco or Oakland coordinates, or require clarification.");
  }
  if (flagged.some((entry) => /available|wrapping up|assignment|next month|next 3 weeks/i.test(entry.input))) {
    recommendations.push("Add assignment/availability tables to the QueryData context set or document that candidate availability is unavailable in candidates.");
  }
  if (flagged.some((entry) => /\bpt\b|physical therapist|\bot\b|occupational therapist|\brt\b|respiratory/i.test(entry.input))) {
    recommendations.push("Backfill PT, OT, and RT candidate examples or add value searches that surface zero-data specialty coverage gaps.");
  }
  if (flagged.some((entry) => /weekly gross|pay|gross/i.test(entry.input))) {
    recommendations.push("Add Packages pay fields to context templates for pay-based candidate/package questions.");
  }
  if (flagged.some((entry) => /who is close|near San Francisco|active candidates near/i.test(entry.input))) {
    recommendations.push("Add templates for location-only questions so the agent does not force a default specialty.");
  }
  return recommendations.length ? recommendations : ["No context-set changes recommended from this validation run."];
}

function writeReport(results) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const path = resolve(repoRoot, `scripts/querydata/validation-report-${stamp}.md`);
  mkdirSync(dirname(path), { recursive: true });

  const nonEmpty = results.filter((entry) => entry.resultCount > 0).length;
  const fast = results.filter((entry) => entry.latencyMs < 2000).length;
  const flagged = results.filter((entry) => entry.flags.length > 0);

  const lines = [
    "# QueryData Translation Validation Report",
    "",
    `Generated: ${now.toISOString()}`,
    "",
    "## Summary",
    "",
    `- Queries run: ${results.length}`,
    `- Non-empty results: ${nonEmpty}/${results.length}`,
    `- Latency under 2000ms: ${fast}/${results.length}`,
    `- Flagged queries: ${flagged.length}/${results.length}`,
    "",
    "| # | Query | Results | Latency | Pass/Flag |",
    "|---:|---|---:|---:|---|",
    ...results.map((entry, index) => `| ${index + 1} | ${escapeMd(entry.input)} | ${entry.resultCount} | ${entry.latencyMs}ms | ${entry.flags.length ? escapeMd(entry.flags.join(", ")) : "pass"} |`),
    "",
    "## Per-Query Detail",
    "",
  ];

  for (const [index, entry] of results.entries()) {
    lines.push(`### ${index + 1}. ${entry.input}`);
    lines.push("");
    lines.push(`- Expected intent: ${entry.expected_intent}`);
    lines.push(`- Notes: ${entry.notes}`);
    lines.push(`- Query ID: ${entry.queryId}`);
    lines.push(`- Result count: ${entry.resultCount}`);
    lines.push(`- Latency: ${entry.latencyMs}ms`);
    lines.push(`- Flags: ${entry.flags.length ? entry.flags.join(", ") : "none"}`);
    lines.push("");
    lines.push("Generated SQL:");
    lines.push("");
    lines.push(codeBlock(entry.generatedSql));
    lines.push("");
    lines.push("First 3 results:");
    lines.push("");
    if (entry.matches.length) {
      lines.push("| Candidate | Score | Distance | Nova |");
      lines.push("|---|---:|---:|---|");
      for (const match of entry.matches.slice(0, 3)) {
        lines.push(`| ${escapeMd(match.candidate_name)} | ${match.fit_score} | ${match.distance_miles} | ${escapeMd(match.nova_url)} |`);
      }
    } else {
      lines.push("_No results._");
    }
    lines.push("");
  }

  lines.push("## Recommendations");
  lines.push("");
  for (const item of recommend(results)) {
    lines.push(`- ${item}`);
  }
  lines.push("");

  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}

async function ask(token, query) {
  const startedAt = Date.now();
  const res = await fetch(`${baseUrl}/api/recruiting/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ input: query.input }),
  });
  const data = await readResponse(res);
  const wallMs = Date.now() - startedAt;
  if (!res.ok || !data?.queryId) {
    return {
      ...query,
      queryId: data?.queryId || "",
      generatedSql: "",
      resultCount: 0,
      latencyMs: wallMs,
      matches: [],
      flags: [`http ${res.status}`],
    };
  }

  const audit = getAuditRow(data.queryId);
  const resultCount = Number(audit.resultCount || data.matches?.length || 0);
  const latencyMs = Number(audit.latencyMs || data.latencyMs || wallMs);
  const flags = flagsFor(query.input, audit.generatedSql, resultCount, latencyMs);
  return {
    ...query,
    queryId: data.queryId,
    generatedSql: audit.generatedSql,
    resultCount,
    latencyMs,
    matches: Array.isArray(data.matches) ? data.matches : [],
    flags,
  };
}

async function run() {
  const queries = loadQueries();
  if (!Array.isArray(queries) || queries.length !== 30) {
    throw new Error(`Expected 30 validation queries, found ${Array.isArray(queries) ? queries.length : "invalid"}.`);
  }

  const token = getAuthToken();
  const results = [];
  for (const [index, query] of queries.entries()) {
    write(JSON.stringify({ event: "query_start", index: index + 1, input: query.input }));
    const result = await ask(token, query);
    write(JSON.stringify({
      event: "query_done",
      index: index + 1,
      input: query.input,
      resultCount: result.resultCount,
      latencyMs: result.latencyMs,
      flags: result.flags,
    }));
    results.push(result);
  }

  const reportPath = writeReport(results);
  write(JSON.stringify({ event: "report_written", path: reportPath }));
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});

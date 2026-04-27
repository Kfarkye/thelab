import assert from "node:assert";
import fs from "node:fs";

const ledger = JSON.parse(fs.readFileSync("docs/ledger/code-engineering.json", "utf8"));
const rule = ledger.find(r => r.verdict === "Vertex AI SDK and API Standards (2026)");
if (!rule) throw new Error("INVARIANT FAILED: Vertex SDK rule not found in ledger");

assert.ok(rule.details.includes("gemini-3.0"), "INVARIANT FAILED: Enterprise ledger must explicitly whitelist gemini-3.0 models");
assert.ok(!rule.details.includes("gemini-2.5"), "INVARIANT FAILED: Deprecated gemini-2.5 models remain in ledger");
console.log("Model ledger rule verified.");

import assert from "node:assert";
import fs from "node:fs";

const ledger = JSON.parse(fs.readFileSync("docs/ledger/code-engineering.json", "utf8"));
const rule = ledger.find(r => r.verdict === "Vertex AI SDK and API Standards (2026)");
if (!rule) throw new Error("INVARIANT FAILED: Vertex SDK rule not found in ledger");

assert.ok(rule.details.includes("gemini-3.1-pro-preview"), "INVARIANT FAILED: Enterprise ledger must explicitly whitelist gemini-3.1 Pro");
assert.ok(rule.details.includes("gemini-3.1-flash-lite-preview"), "INVARIANT FAILED: Enterprise ledger must explicitly whitelist gemini-3.1 Flash-Lite");
assert.ok(rule.details.includes("thinkingConfig.thinkingLevel = HIGH"), "INVARIANT FAILED: Enterprise ledger must require thinkingLevel HIGH for reasoning paths");
assert.ok(rule.details.includes("exactly two Gemini model IDs"), "INVARIANT FAILED: Enterprise ledger must constrain production to two Gemini models");
assert.ok(!rule.details.includes("gemini-3.0"), "INVARIANT FAILED: Deprecated gemini-3.0 model guidance remains in ledger");
assert.ok(!rule.details.includes("gemini-3-flash-preview"), "INVARIANT FAILED: Deprecated Gemini 3 Flash model guidance remains in ledger");
assert.ok(!rule.details.includes("gemini-2.5"), "INVARIANT FAILED: Deprecated gemini-2.5 models remain in ledger");
console.log("Model ledger rule verified.");

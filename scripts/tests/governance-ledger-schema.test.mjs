import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const LEDGER_DIR = path.resolve(process.cwd(), "docs/ledger");
const ACTIVE_RULES_PATH = path.join(LEDGER_DIR, "active_rules.json");
const ALLOWED_STATUSES = new Set(["accepted"]);

test("docs/ledger JSON files follow governance schema", async () => {
  const entries = await fs.readdir(LEDGER_DIR, { withFileTypes: true });
  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  assert.ok(jsonFiles.length > 0, "Expected at least one JSON governance file in docs/ledger");

  for (const fileName of jsonFiles) {
    const fullPath = path.join(LEDGER_DIR, fileName);
    const raw = await fs.readFile(fullPath, "utf8");

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      assert.fail(`${fileName} is not valid JSON: ${error.message}`);
    }

    assert.ok(Array.isArray(parsed), `${fileName} must be a JSON array`);
    assert.ok(parsed.length > 0, `${fileName} must contain at least one ledger entry`);

    const seenVerdicts = new Set();

    parsed.forEach((entry, index) => {
      assert.ok(entry && typeof entry === "object" && !Array.isArray(entry), `${fileName}[${index}] must be an object`);

      assert.equal(typeof entry.verdict, "string", `${fileName}[${index}].verdict must be a string`);
      assert.notEqual(entry.verdict.trim(), "", `${fileName}[${index}].verdict must not be empty`);

      assert.equal(typeof entry.details, "string", `${fileName}[${index}].details must be a string`);
      assert.notEqual(entry.details.trim(), "", `${fileName}[${index}].details must not be empty`);

      assert.equal(typeof entry.status, "string", `${fileName}[${index}].status must be a string`);
      assert.equal(
        ALLOWED_STATUSES.has(entry.status),
        true,
        `${fileName}[${index}].status must be one of: ${Array.from(ALLOWED_STATUSES).join(", ")}`,
      );

      assert.equal(
        seenVerdicts.has(entry.verdict),
        false,
        `${fileName} has duplicate verdict "${entry.verdict}"`,
      );
      seenVerdicts.add(entry.verdict);
    });
  }
});

test("active governance entrypoint exists and exposes runtime-safe accepted rules", async () => {
  const raw = await fs.readFile(ACTIVE_RULES_PATH, "utf8");
  const parsed = JSON.parse(raw);

  assert.ok(Array.isArray(parsed), "active_rules.json must be a JSON array");
  assert.ok(parsed.length > 0, "active_rules.json must contain at least one active rule");

  parsed.forEach((entry, index) => {
    assert.equal(typeof entry.verdict, "string", `active_rules.json[${index}].verdict must be a string`);
    assert.notEqual(entry.verdict.trim(), "", `active_rules.json[${index}].verdict must not be empty`);
    assert.equal(typeof entry.details, "string", `active_rules.json[${index}].details must be a string`);
    assert.notEqual(entry.details.trim(), "", `active_rules.json[${index}].details must not be empty`);
    assert.equal(entry.status, "accepted", `active_rules.json[${index}].status must be accepted`);
  });
});

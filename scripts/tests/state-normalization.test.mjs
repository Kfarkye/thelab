import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUSHomeState } from "../../src/lib/spanner/state-normalization.js";

test("accepts valid two-letter state code", () => {
  assert.equal(normalizeUSHomeState("FL"), "FL");
});

test("accepts full state name", () => {
  assert.equal(normalizeUSHomeState("Florida"), "FL");
});

test("parses comma-separated address with state code", () => {
  assert.equal(
    normalizeUSHomeState("9073 Preston Pl, Tamarac, FL, 33321, US"),
    "FL",
  );
});

test("parses apartment/unit address with state code", () => {
  assert.equal(
    normalizeUSHomeState("742 Evergreen Terrace Apt 2B, Springfield, IL 62704"),
    "IL",
  );
});

test("parses apartment/unit address with full state name", () => {
  assert.equal(
    normalizeUSHomeState("500 Main St Unit 7, Seattle, Washington 98101"),
    "WA",
  );
});

test("parses lowercase mixed address tokens", () => {
  assert.equal(normalizeUSHomeState("tamarac fl 33321"), "FL");
});

test("does not treat street suffix as state code", () => {
  assert.equal(
    normalizeUSHomeState("9073 Preston Pl, Tamarac, 33321"),
    null,
  );
});

test("returns null for US territory code", () => {
  assert.equal(normalizeUSHomeState("San Juan, PR 00901"), null);
});

test("returns null for US territory name", () => {
  assert.equal(normalizeUSHomeState("Ponce, Puerto Rico 00730"), null);
});

test("returns null for military APO format", () => {
  assert.equal(normalizeUSHomeState("APO AE 09012"), null);
});

test("accepts district of columbia", () => {
  assert.equal(normalizeUSHomeState("District of Columbia"), "DC");
});

test("returns null for unknown input", () => {
  assert.equal(normalizeUSHomeState("Unknown Address Input"), null);
});


import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMLBStatusCode } from "@/lib/sports/status";

test("normalizes lower-case in to LIVE", () => {
  assert.equal(normalizeMLBStatusCode("in"), "LIVE");
});

test("normalizes upper-case IN to LIVE", () => {
  assert.equal(normalizeMLBStatusCode("IN"), "LIVE");
});

test("normalizes ESPN STATUS_IN_PROGRESS to LIVE", () => {
  assert.equal(normalizeMLBStatusCode("STATUS_IN_PROGRESS"), "LIVE");
});

test("normalizes final states", () => {
  assert.equal(normalizeMLBStatusCode("Final"), "FINAL");
  assert.equal(normalizeMLBStatusCode("GAME_OVER"), "FINAL");
});

test("normalizes postponed states", () => {
  assert.equal(normalizeMLBStatusCode("POSTPONED"), "POSTPONED");
  assert.equal(normalizeMLBStatusCode("Delayed"), "POSTPONED");
});

test("falls back to SCHEDULED for unknown statuses", () => {
  assert.equal(normalizeMLBStatusCode("mystery_status"), "SCHEDULED");
});

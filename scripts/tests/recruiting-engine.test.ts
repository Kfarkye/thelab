import test from "node:test";
import assert from "node:assert/strict";
import { calculateMatch, getDistance, normalizeSpecialty } from "../../src/lib/recruiting/engine.ts";
import type { CandidateObject, PackageObject } from "../../src/lib/recruiting/types.ts";

const pkg: PackageObject = {
  package_id: "AYA.PKG.JOB123.20260426.001",
  record_phase: "unattached",
  facility: "Riverside Mental Health and Recovery Center",
  specialty: "DIET",
  normalized_specialty: "Dietitian",
  location: {
    city: "Chattanooga",
    state: "TN",
    zip: null,
    lat: 35.0456,
    lng: -85.3097,
  },
  pay_range: { min: 2115, max: 2115 },
  weekly_gross: 2115,
  shift: "days",
  start_date: "2026-04-26",
  duration_weeks: 13,
  job_description: null,
  requirements: ["Peds experience preferred"],
  flags: [],
};

const candidate: CandidateObject = {
  candidate_id: "AYA.CAND.123",
  candidate_name: "Jane Turner",
  nova_url: "https://nova.ayahealthcare.com/#/recruiting/candidates/123/new-profile/about",
  specialty: "Dietitian",
  normalized_specialty: "Dietitian",
  home_city: "Chattanooga",
  home_state: "TN",
  home_lat: 35.05,
  home_lng: -85.31,
  license_states: ["TN"],
  available_date: "2026-04-01",
  bucket: "claimable",
};

test("normalizes recruiter specialty labels", () => {
  assert.equal(normalizeSpecialty("DIET(1)"), "Dietitian");
  assert.equal(normalizeSpecialty("clinnutrman"), "Clinical Nutrition Manager");
});

test("calculates distance in miles when coordinates exist", () => {
  const distance = getDistance(35.0456, -85.3097, 35.05, -85.31);
  assert.ok(distance != null && distance < 1);
});

test("prioritizes specialty and local distance", () => {
  const match = calculateMatch(candidate, pkg);
  assert.equal(match.match_bucket, "closest_qualified");
  assert.ok(match.match_score >= 80);
  assert.ok(match.reasons.includes("Specialty match"));
  assert.ok(match.risk_flags.includes("Peds experience required (check profile)"));
});

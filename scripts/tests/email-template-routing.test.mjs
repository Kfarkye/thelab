import test from "node:test";
import assert from "node:assert/strict";
import {
  OPS_REASSIGNMENT_RECIPIENT,
  OPS_REASSIGNMENT_TEMPLATE_ID,
  isTemplateRecipientMismatch,
  resolveEmailTemplateId,
} from "../../src/lib/ayaops/email-template-routing.js";

test("reassignment prompt hard-routes to ops_reassignment", () => {
  const templateId = resolveEmailTemplateId({
    requestedTemplateId: "initial_outreach",
    args: {},
    userPrompt: "Draft a reassignment email for Robin Stoner",
  });
  assert.equal(templateId, OPS_REASSIGNMENT_TEMPLATE_ID);
});

test("recipient cue hard-routes to ops_reassignment", () => {
  const templateId = resolveEmailTemplateId({
    requestedTemplateId: "initial_outreach",
    args: { to_email: OPS_REASSIGNMENT_RECIPIENT },
    userPrompt: "Please send this to reassignments",
  });
  assert.equal(templateId, OPS_REASSIGNMENT_TEMPLATE_ID);
});

test("non-reassignment prompt keeps requested template", () => {
  const templateId = resolveEmailTemplateId({
    requestedTemplateId: "initial_outreach",
    args: {},
    userPrompt: "Draft outreach copy for this candidate",
  });
  assert.equal(templateId, "initial_outreach");
});

test("ops_reassignment mismatched recipient is rejected", () => {
  assert.equal(
    isTemplateRecipientMismatch({
      templateId: OPS_REASSIGNMENT_TEMPLATE_ID,
      toEmail: "candidate@example.com",
    }),
    true,
  );
});

test("ops_reassignment correct recipient passes guard", () => {
  assert.equal(
    isTemplateRecipientMismatch({
      templateId: OPS_REASSIGNMENT_TEMPLATE_ID,
      toEmail: OPS_REASSIGNMENT_RECIPIENT,
    }),
    false,
  );
});

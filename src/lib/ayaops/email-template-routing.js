export const OPS_REASSIGNMENT_TEMPLATE_ID = "ops_reassignment";
export const OPS_REASSIGNMENT_RECIPIENT = "reassignments@ayahealthcare.com";

const REASSIGNMENT_INTENT_PATTERNS = [
  /\breassign(?:ment)?\b/i,
  /\breassign\b[\s\w]{0,24}\bcandidate\b/i,
  /\bdraft\b[\s\w]{0,24}\breassignment\b[\s\w]{0,16}\bemail\b/i,
  /\bsend\b[\s\w]{0,24}\breassignment\b[\s\w]{0,16}\brequest\b/i,
  /\bto\b[\s\w]{0,16}\breassignments\b/i,
];

function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function readString(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

export function isReassignmentEmailIntent(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return false;
  return REASSIGNMENT_INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function resolveEmailTemplateId({ requestedTemplateId, args, userPrompt }) {
  const requested = readString(requestedTemplateId).toLowerCase();
  const payload = asRecord(args) || {};
  const toEmail = readString(payload.to_email || payload.toEmail).toLowerCase();
  if (toEmail === OPS_REASSIGNMENT_RECIPIENT) {
    return OPS_REASSIGNMENT_TEMPLATE_ID;
  }

  const cueText = [
    readString(userPrompt),
    readString(payload.intent),
    readString(payload.request_type),
    readString(payload.email_type),
    readString(payload.instructions),
    readString(payload.subject),
    readString(payload.body),
    requested,
  ]
    .filter(Boolean)
    .join("\n");

  if (isReassignmentEmailIntent(cueText)) {
    return OPS_REASSIGNMENT_TEMPLATE_ID;
  }

  return requested;
}

export function isTemplateRecipientMismatch({ templateId, toEmail }) {
  const normalizedTemplate = readString(templateId).toLowerCase();
  const normalizedTo = readString(toEmail).toLowerCase();
  if (!normalizedTo) return false;
  return (
    normalizedTemplate === OPS_REASSIGNMENT_TEMPLATE_ID &&
    normalizedTo !== OPS_REASSIGNMENT_RECIPIENT
  );
}

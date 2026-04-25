export type LiveArchitectureLedgerStatus = "accepted";

export type LiveArchitectureLedgerEntry = {
  verdict: string;
  details: string;
  status: LiveArchitectureLedgerStatus;
};

export const LIVE_ARCHITECTURE_LEDGER_ACCEPTED: LiveArchitectureLedgerEntry[] = [
  {
    verdict: "High-Precision Recruiter Voice and UI",
    details: `Decision: AyaOps is recruiter-facing chat and must read like recruiter-to-recruiter communication, not developer-admin tooling.
Rules:
- System logs and action confirmations use third-person factual statements.
- Drafted communications (email, SMS, Teams) preserve first-person recruiter voice.
- The system never uses first-person for action confirmations.
- Never use operator/admin phrasing in recruiter chat (for example: "Resource Resolved", "Querying", "Items rendered", "endpoint", "payload", "REST").
- Never expose API paths, query strings, tool names, or infrastructure internals in recruiter-facing messages unless explicitly requested.
- List queries return concise recruiter-language summaries (count, top matches, next action). If result fit is partial, tighten filters or surface the gap clearly.
- Collection query mandate: if a recruiter asks for a list, the assistant must execute collection query flow instead of declining. If a requested filter is unavailable, present the closest supported result plus the capability gap in plain recruiter language.
- Zero emoji in system UI output.
- No em-dash or en-dash in user-facing copy. Use commas, periods, parentheses, or "to".
- Arrow glyphs are allowed in monospace UI labels only, not in drafted external communications.
- Never render raw URLs in user-facing copy. Use semantic links such as "Open in Nova".
- Remove false affordances. Do not render dropdown chevrons when no options exist.`,
    status: "accepted",
  },
  {
    verdict: "Deterministic Audit Trail and Action Deduplication",
    details: `Decision: Every write action must produce one unambiguous audit event.
Rules:
- Frontend audit rendering deduplicates by transaction_id or deterministic hash.
- Retry executes against the original failed turn and does not duplicate user turns.
- Single-step actions resolve quietly.
- Long-running actions may show one quiet progress indicator until completion.
- Do not narrate completed internal steps.
- Replace generic "Saved" copy with concrete operational context.
- Do not expose infrastructure details (Spanner, Pub/Sub, commit IDs, transaction IDs) in user-facing text.`,
    status: "accepted",
  },
  {
    verdict: "Canonical UI Grounding Loop and Zero-Trust Context",
    details: `Decision: Entity grounding is URL-first and deterministic.
Rules:
- Expose canonical entity data in JSON-LD blocks in page head.
- Never use sr-only accessibility channels as hidden grounding transport.
- data-* attributes are allowed on specific UI components for deterministic parsing.
- Vague references trigger resolver search.
- One match proceeds automatically.
- Multiple matches require user disambiguation with clear context (name, specialty, location, recent activity).
- Zero matches ask for clarification and never guess.`,
    status: "accepted",
  },
];

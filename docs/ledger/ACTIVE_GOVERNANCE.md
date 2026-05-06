# Active Governance

GitHub ledger files govern runtime behavior. The deployed container can contain dirty local files, but those files do not govern unless they are committed, pushed, allowlisted, and loaded through the Git-as-Governance engine.

`docs/ledger/active_rules.json` is the current runtime rule entrypoint for active governance status checks.

Active sports rule: Gemini must ground game-level sports responses against real ESPN URLs (scoreboard/date/game page) before outputting facts.

`GET /api/governance/status` loads `docs/ledger/active_rules.json` through the GitHub-backed governance engine and returns metadata only: source, ledger path, branch version, blob SHA, fetch time, rule count, and verdict names.

The endpoint proves which GitHub-backed ledger file is active without exposing secrets or full rule text.

This is internal observability, not a user-facing ledger panel.

Promotion path: edit the ledger, commit it, push it to the allowlisted GitHub branch, confirm the path is allowlisted in the engine, then verify `/api/governance/status`.

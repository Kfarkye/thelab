# ADR-001: URL-First Operating Surface

## VERDICT
Resolved resources must carry canonical URLs because URLs are the shared address space for the model, browser agent, and human operator.

## RULES
- Entity discovery goes through the URL Hub.
- Candidate resources expose Nova URLs when available.
- Human-facing surfaces prefer links over raw database identifiers.
- Execution tools use typed inputs after URL Hub resolution.


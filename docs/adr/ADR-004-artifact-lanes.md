# ADR-004: Artifact Lanes

## VERDICT
Generated artifacts move through explicit lanes so preview, persistence, execution, and deployment are separate decisions.

## LANES
- `artifact_text_preview_v1`: reviewable text only.
- `ledgered_artifact`: saved draft with actor, ruleset, hash, validation, and approval state.
- `live_execution_preview`: deferred high-risk execution lane.

## RULE
The preview endpoint must not execute, persist, or deploy generated code.


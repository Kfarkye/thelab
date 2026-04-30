# ADR-003: Profile-Native Notes

## VERDICT
Recruiter notes belong to the candidate profile context and must resolve through canonical candidate identity before write operations.

## RULES
- Candidate identity must be clear before candidate-specific notes are written.
- Notes must preserve actor and timestamp.
- Ambiguous candidate references stay read-only.
- Nova links remain the human verification path.


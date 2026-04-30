# Chat Context Scope Checklist

- Global preferences may persist across turns.
- Candidate, facility, package, RTO, date, and screenshot details are tied to the active object only.
- When the active object or task type changes, prior local details are omitted unless the user explicitly links them.
- Candidate-specific details are not used when identity is unclear.
- Conflicting local context prefers the current active object.


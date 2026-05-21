# Implementation Policy

Implementation work must stay scoped to the Linear issue.

Before editing:

- Inspect the relevant code.
- Identify tests or checks that cover the change.
- Respect project-specific guidance such as `AGENTS.md`, `CLAUDE.md`, and repo-local docs.

While editing:

- Prefer existing patterns.
- Keep unrelated refactors out of scope.
- Preserve user changes.
- For audio or realtime code, prioritize performance and avoid hot-path allocation or locking.

Before stopping:

- Run focused tests when feasible.
- Record what changed and what remains in `HANDOFF.md`.

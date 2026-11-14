# Implementation Policy

These are norms, not rules (see the judgment policy): deviate when the task
genuinely calls for it, and record the reason in `HANDOFF.md`. The principles
below earn their place by making work reviewable and reversible.

## Keep Changes Small

Large changes are harder to review, riskier to ship, and harder to revert.

- Commit each increment as it passes its tests (see the commit policy). Don't
  save the commit for when the feature is done, and don't plan to squash or
  split later.
- Keep branches short-lived: merge within one to three days.
- Keep formatting changes out of behavior changes.
- Never force-push a shared branch.

## Before editing

- Inspect the relevant code.
- Identify tests or checks that cover the change.
- Respect project-specific guidance such as `AGENTS.md`, `CLAUDE.md`, and
  repo-local docs.

## While editing

- Prefer existing patterns.
- Keep unrelated refactors out of scope.
- Preserve user changes.
- Performance is important, but readability and maintainability are more
  important. Don't optimize prematurely.
- Document all public or exported entities with doc-strings or comments.

## Before stopping

- Run focused tests when feasible.
- Commit, then run `mahler check --workspace <workspace> --issue <ISSUE>` (or
  `--path <worktree>` for a single slice) for touched repos. It mirrors what
  CI will run, so failures here are failures there. Once is enough: it skips
  checks that already passed on the same committed tree.
- Record what changed and what remains in `HANDOFF.md`.

### Change Summaries

After any modification, provide a structured summary. This makes review easier,
documents scope discipline, and surfaces unintended changes:

```tex
CHANGES MADE:
- src/routes/tasks.ts: Added validation middleware to POST endpoint
- src/lib/validation.ts: Added TaskCreateSchema using Zod

THINGS I DIDN'T TOUCH (intentionally):
- src/routes/auth.ts: Has similar validation gap but out of scope
- src/middleware/error.ts: Error format could be improved (separate task)

POTENTIAL CONCERNS:
- The Zod schema is strict — rejects extra fields. Confirm this is desired.
- Added zod as a dependency (72KB gzipped) — already in package.json
```

This pattern catches wrong assumptions early and gives reviewers a clear map of
the change. The "DIDN'T TOUCH" section is especially important — it shows you
exercised scope discipline and didn't go on an unsolicited renovation.

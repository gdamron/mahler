# Implementation Policy

## Core Principles

### Keep Changes Small

Remember that large changes are risky changes and are difficult to review. Avoid
common rationalizations:

> "I'll commit when the feature is done"

**Reality**: One giant commit is impossible to review, debug, or revert. Commit
each slice.

> "The message doesn't matter"

**Reality**: Messages are documentation. Future you (and future agents) will
need to understand what changed and why.

> "I'll squash it all later"

**Reality**: Squashing destroys the development narrative. Prefer clean
incremental commits from the start.

> "Branches add overhead"

**Reality**: Short-lived branches are free and prevent conflicting work from
colliding. Long-lived branches are the problem — merge within 1-3 days.

> "I'll split this change later"

**Reality**: Large changes are harder to review, riskier to deploy, and harder
to revert. Split before submitting, not after.

### Red Flags

- Large uncommitted changes accumulating
- Commit messages like "fix", "update", "misc"
- Formatting changes mixed with behavior changes
- No `.gitignore` in the project
- Committing `node_modules/`, `.env`, or build artifacts
- Long-lived branches that diverge significantly from main
- Force-pushing to shared branches

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

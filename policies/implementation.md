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
- Never force-push a shared branch.

## Leave Code Better Than You Found It

When you find a problem in the code you are working in, fix it as part of the
work. Don't note it for later: cleanup set aside for a follow-up rarely
happens, and the next agent pays for it again.

- **What counts:** formatting, unclear names, duplication, dead code, stale
  comments, a function doing too much, a missing test, a pattern the rest of
  the repo has moved away from.
- **Where:** the code your change goes through, meaning the files and
  functions you edit or had to read closely to make it. This is not a hunt
  through the rest of the repo.
- **Formatting:** run the repo's formatter and linter on the files you touch,
  and match the surrounding style where there is no tool. If that reformats
  lines your change didn't need, commit the reformat on its own.
- **Its own commit:** each cleanup is a separate commit from the behavior
  change (see the commit policy), with tests passing before and after. Put
  it first when it makes the change easier: tidy the code, then make the
  change in the tidy code.
- **Covered by tests:** refactor only what tests cover. If nothing covers it,
  add a test that pins the current behavior first, or leave the code alone
  and say so.
- **No behavior change:** a cleanup that changes what users or callers see is
  not a cleanup. Treat it as part of the issue or raise it.

### When cleanup gets its own branch

Cleanup rides in the same branch and PR as the work by default. Give it its
own branch and PR when any of these holds:

- it is larger than the change it rides with, or would push the PR past the
  size where the risk level rises (see the pr policy)
- it is mechanical and wide: a formatter run or a rename across many files
- it reaches outside the area the issue works in: another module, another
  repo, or code another active issue is changing
- it raises the risk level on its own, or touches a path the merge policy
  routes to the human
- reverting the feature should not revert it, or the other way around

Prefer doing that branch now over deferring it. When the work builds on the
cleanup, put the cleanup at the bottom of a stack with the work on top (see
the pr policy); a stack is verified once, so the extra PR costs little. When
it is independent, a conductor proposes it to its parent as a separate
issue, and a slice agent reports it to its conductor. Defer only cleanup
that needs its own planning, and record it in `HANDOFF.md` with the reason.

## Before editing

- Inspect the relevant code.
- Identify tests or checks that cover the change.
- Respect project-specific guidance such as `AGENTS.md`, `CLAUDE.md`, and
  repo-local docs.

## While editing

- Prefer existing patterns.
- Clean up problems you find in the code you touch (above). Leave unrelated
  code alone.
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

CLEANED UP ALONG THE WAY:
- src/routes/tasks.ts: Split the 80-line handler into parse and save steps
  (own commit, covered by existing tests)

LEFT FOR LATER (and why):
- src/routes/auth.ts: Has a similar validation gap; outside this issue's area
- src/middleware/error.ts: Error format change would alter responses

POTENTIAL CONCERNS:
- The Zod schema is strict — rejects extra fields. Confirm this is desired.
- Added zod as a dependency (72KB gzipped) — already in package.json
```

This pattern catches wrong assumptions early and gives reviewers a clear map of
the change. Keep "LEFT FOR LATER" short and honest: each entry is a problem
you saw and chose not to fix, with the reason from the list above. An empty
section is the goal.

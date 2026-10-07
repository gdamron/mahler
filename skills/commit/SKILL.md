---
name: commit
description: Commit a tested increment of issue-scoped work as a save point, and push the working branch.
---

# Commit

## Triggers

- "commit this"
- "make a commit"
- "commit the issue work"

## Required Policies

- judgment
- workspace-safety
- definition-of-done
- commit
- handoff

## Allowed Commands

- `git status`
- `git diff`
- `git add`
- `git commit`
- `git push` for the issue or slice branch only; never force-push a shared
  branch or push to a base branch
- repo-local tests/checks needed before commit

## Expected Inputs

- Existing issue workspace
- Completed or checkpoint-worthy changes

## Required Outputs

- Commit on the issue or slice branch
- Updated `HANDOFF.md`, or, when working in slice mode, the
  commit reported to the conductor that owns it (record your own workflow
  deviations in `HANDOFF.md` either way)
- Definition of Done checklist checked against the final diff
- Commit hash and tests run

## Stop Conditions

- tests fail without explicit human direction
- staged diff contains unrelated changes
- the current branch is a base branch

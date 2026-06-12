---
name: commit
description: Commit completed issue-scoped work after checking tests and staged changes.
---

# Commit

## Triggers

- "commit this"
- "make a commit"
- "commit the issue work"

## Required Policies

- judgment
- workspace-safety
- commit
- handoff

## Allowed Commands

- `git status`
- `git diff`
- `git add`
- `git commit`
- repo-local tests/checks needed before commit

## Expected Inputs

- Existing issue workspace
- Completed or checkpoint-worthy changes

## Required Outputs

- Commit on the issue branch
- Updated `HANDOFF.md`
- Commit hash and tests run

## Stop Conditions

- tests fail without explicit human direction
- staged diff contains unrelated changes
- active profile does not include this skill and the human has not explicitly confirmed the deviation

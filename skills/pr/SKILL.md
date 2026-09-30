---
name: pr
description: Prepare or open a pull request for committed issue-scoped work.
---

# PR

## Triggers

- "prepare a PR"
- "open a PR"
- "write the PR summary"

## Required Policies

- judgment
- workspace-safety
- pr
- handoff

## Allowed Commands

- git status and log commands
- `git push` for the issue or slice branch when it has not been pushed yet
- configured GitHub or forge command for PR creation when available

## Expected Inputs

- Issue or slice branch with committed changes that have passed review
- Current `HANDOFF.md`
- For a stacked slice: the predecessor branch to target

## Required Outputs

- PR summary or created PR URL (one PR per slice branch; a stacked PR targets
  its predecessor's branch and says so in its description)
- Tests run
- Updated `HANDOFF.md`

## Stop Conditions

- branch has uncommitted changes
- no remote is configured
- review findings on the branch are unresolved

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

- workspace-safety
- pr
- handoff

## Allowed Commands

- git status and log commands
- configured GitHub or forge command for PR creation when available

## Expected Inputs

- Issue branch with committed changes
- Current `HANDOFF.md`

## Required Outputs

- PR summary or created PR URL
- Tests run
- Updated `HANDOFF.md`

## Stop Conditions

- branch has uncommitted changes
- no remote is configured
- active profile does not allow this skill

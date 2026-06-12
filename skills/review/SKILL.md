---
name: review
description: Review an issue-scoped diff and report findings before handoff.
---

# Review

## Triggers

- "review this issue"
- "review the changes"
- "check the diff"

## Required Policies

- judgment
- workspace-safety
- review
- handoff

## Allowed Commands

- git diff and status commands in selected issue worktrees
- repo-local test or check commands needed to validate findings

## Expected Inputs

- Existing issue brief and selected worktree
- Diff or branch to review

## Required Outputs

- Findings first, ordered by severity
- File and line references when available
- Updated `HANDOFF.md`

## Stop Conditions

- no issue brief exists
- review target is ambiguous
- active profile does not allow this skill

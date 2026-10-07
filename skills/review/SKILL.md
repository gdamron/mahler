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
- Diff or branch to review, and the base it should be compared against
- When delegated: the reviewer brief from the conductor

## Required Outputs

- Findings first, ordered by severity
- File and line references when available
- A recommended fix for each finding when you have one
- Updated `HANDOFF.md`, or, when delegated, findings reported to the
  conductor that owns it (record your own workflow deviations in
  `HANDOFF.md` either way)

## Stop Conditions

- no issue brief exists
- review target is ambiguous

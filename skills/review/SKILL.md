---
name: review
description: Review an issue workspace diff and report findings before handoff.
---

# Review

## Triggers

- "review this issue"
- "review the changes"
- "check the diff"

## Required Policies

- workspace-safety
- review
- handoff

## Allowed Commands

- git diff and status commands in the generated issue workspace
- repo-local test or check commands needed to validate findings

## Expected Inputs

- Existing issue workspace
- Diff or branch to review

## Required Outputs

- Findings first, ordered by severity
- File and line references when available
- Updated `HANDOFF.md`

## Stop Conditions

- no issue workspace exists
- review target is ambiguous
- active profile does not allow this skill

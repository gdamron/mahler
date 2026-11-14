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

- workspace-safety
- review

Reviewing your own issue, also: judgment and handoff. A delegated reviewer
reports to the conductor, which owns both.

## Allowed Commands

- git diff and status commands in selected issue worktrees
- repo-local test or check commands needed to validate findings
- `mahler knowledge search --changed` (from the worktree) or
  `mahler knowledge search <terms>`

## Expected Inputs

- Existing issue brief and selected worktree
- Diff or branch to review, and the base it should be compared against
- When delegated: the reviewer brief from the conductor

## Required Outputs

- Findings first, ordered by severity
- File and line references when available
- A recommended fix for each finding when you have one
- Where it helps the author weigh a finding: who would hit it and whether this
  diff introduced it (see the review policy)
- On a re-review: what the fix commits changed, rather than a fresh review of
  the whole diff
- Knowledge notes the diff contradicts, as findings; and facts worth a new
  note, proposed in the report (title, description, scope) for the conductor
  to record
- Updated `HANDOFF.md`, or, when delegated, findings reported to the
  conductor that owns it, with anything you did differently from this skill

## Stop Conditions

- no issue brief exists
- review target is ambiguous

---
name: handoff
description: Summarize current issue workspace state, blockers, tests, and next steps.
---

# Handoff

## Triggers

- "handoff"
- "summarize status"
- end of every agent session

## Required Policies

- judgment
- handoff

## Allowed Commands

- `mahler handoff <ISSUE>`
- `mahler decide --rule <rule> --reason "<why>" --issue <ISSUE> --agent <agent>`
- git status and diff summary commands in the issue workspace

## Expected Inputs

- Current issue workspace
- Current work status
- Durable decisions from the active `.harness/decisions/` ledger

## Required Outputs

- Updated `HANDOFF.md`
- A `.harness/decisions/` ledger note for each Tier-1 deviation whose reason
  generalizes beyond this issue, referenced from `HANDOFF.md` under "Workflow
  Deviations" (issue-local deviations stay in `HANDOFF.md` only)
- Clear next steps and blockers

## Stop Conditions

- issue workspace cannot be identified
- active profile does not allow this skill

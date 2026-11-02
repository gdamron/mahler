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
- `mahler decide --rule <rule> --description "<one line>" --reason "<why>" --issue <ISSUE> --agent <agent>`
- `mahler learn --title "<claim>" --description "<sentences>" ...` (see the
  knowledge policy)
- git status and diff summary commands in the issue workspace

## Expected Inputs

- Current issue workspace
- Current work status
- `.harness/decisions/INDEX.md` and the brief's `Relevant Knowledge`

## Required Outputs

- Updated `HANDOFF.md`
- A `.harness/decisions/` ledger note for each Tier-1 deviation whose reason
  generalizes beyond this issue, referenced from `HANDOFF.md` under "Workflow
  Deviations" (issue-local deviations stay in `HANDOFF.md` only)
- A knowledge note (`mahler learn`, or an update to an existing note) for each
  fact this session learned that a later session would otherwise rediscover
- Clear next steps and blockers

## Stop Conditions

- issue workspace cannot be identified

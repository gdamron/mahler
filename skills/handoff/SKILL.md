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

- handoff

## Allowed Commands

- `mahler handoff <ISSUE>`
- git status and diff summary commands in the issue workspace

## Expected Inputs

- Current issue workspace
- Current work status

## Required Outputs

- Updated `HANDOFF.md`
- Clear next steps and blockers

## Stop Conditions

- issue workspace cannot be identified
- active profile does not allow this skill

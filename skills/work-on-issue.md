# Skill: Work On Issue

## Triggers

- "work on ISSUE-123"
- "start ISSUE-123"
- "implement ISSUE-123"

## Required Policies

- issue-selection
- workspace-safety
- implementation
- handoff

## Allowed Commands

- `mahler issue <ISSUE> --agent <agent> --linear-file <issue.json>`
- repo-local build, test, and inspection commands inside the generated issue workspace

## Expected Inputs

- Linear issue identifier
- Linear issue metadata from MCP, or explicit human-provided fallback metadata

## Required Outputs

- Generated issue workspace
- Updated `HANDOFF.md`
- Summary of changes and tests run

## Stop Conditions

- Linear metadata is unavailable or incomplete
- no repo is configured
- requested work is outside the Linear issue scope
- active profile does not allow this skill

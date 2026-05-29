---
name: work-on-issue
description: Set up and perform issue-scoped implementation work from Linear issue metadata.
---

# Work On Issue

## Triggers

- "work on ISSUE-123"
- "start ISSUE-123"
- "implement ISSUE-123"

## Required Policies

- issue-selection
- interview
- workspace-safety
- implementation
- handoff

## Allowed Commands

- `mahler linear-template issue`
- `mahler issue <ISSUE> --agent <agent> --linear-file <issue.json>`
- repo-local build, test, and inspection commands inside the generated issue workspace

## Expected Inputs

- Linear issue identifier
- Linear issue metadata from MCP, or explicit human-provided fallback metadata

## Linear MCP Resolution

1. Use Linear MCP `get_issue` with the requested issue identifier.
2. If lookup fails, returns no issue, or omits `identifier`/`title`, stop and ask
   the human for the missing metadata.
3. Map MCP fields into the JSON shape printed by `mahler linear-template issue`.
4. Write the metadata to `.harness/tmp/linear/<ISSUE>.json` in the product workspace,
   creating the directory if needed.
5. Run `mahler issue <ISSUE> --agent <agent> --linear-file .harness/tmp/linear/<ISSUE>.json`.

## Required Outputs

- Generated issue workspace
- Updated `HANDOFF.md`
- Summary of changes and tests run

## Stop Conditions

- Linear metadata is unavailable or incomplete
- Linear MCP lookup fails or returns a different issue identifier
- no repo is configured
- requested work is outside the Linear issue scope
- active profile does not allow this skill

---
name: work-on-issue
description: Create an issue brief and perform issue-scoped implementation work from Linear issue metadata.
---

# Work On Issue

## Triggers

- "work on ISSUE-123"
- "start ISSUE-123"
- "implement ISSUE-123"

## Required Policies

- judgment
- issue-selection
- interview
- workspace-safety
- implementation
- handoff

## Allowed Commands

- `mahler linear-template issue`
- `mahler issue <ISSUE> --agent <agent> --linear-file <issue.json>`
- `mahler decide --rule <rule> --reason "<why>" --issue <ISSUE> --agent <agent>`
- git worktree commands for only the repos needed by the task
- repo-local build, test, and inspection commands inside selected repo worktrees

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
6. Read the generated issue brief under `.harness/issues/<ISSUE>/`, and read the
   active `.harness/decisions/` ledger (not `archive/`) to recover durable
   decisions and intent from earlier sessions (record a new deviation with
   `mahler decide` only when its reason generalizes beyond this issue).
7. Decide which configured repos need worktrees for the task.
8. Choose short-lived branch names using `.harness/policies/branching.md`.
9. Create only the needed repo worktrees, preferably under `workspaces/issues/<ISSUE>/repos/<repo>`.

## Required Outputs

- Generated issue brief
- Repo worktrees only where needed
- Updated `HANDOFF.md`
- Summary of changes and tests run

## Stop Conditions

- Linear metadata is unavailable or incomplete
- Linear MCP lookup fails or returns a different issue identifier
- no repo is configured
- requested work is outside the Linear issue scope
- active profile does not allow this skill

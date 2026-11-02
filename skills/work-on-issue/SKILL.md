---
name: work-on-issue
description: Create an issue brief and worktrees from Linear issue metadata or a local task, then hand off to the conduct skill.
---

# Work On Issue

## Triggers

- "work on ISSUE-123"
- "start ISSUE-123"
- "implement ISSUE-123"
- "let's do this" after agreeing on work in conversation (a local task)

## Required Policies

- judgment
- issue-selection
- interview
- workspace-safety
- branching
- definition-of-done
- risk
- handoff

## Allowed Commands

- `mahler linear-template issue`
- `mahler issue <ISSUE> --agent <agent> --linear-file <issue.json>`
- `mahler linear-template task` and
  `mahler task <slug> --agent <agent> --task-file <task.json>`
- `mahler decide --rule <rule> --description "<one line>" --reason "<why>" --issue <ISSUE> --agent <agent>`
- git worktree commands for only the repos needed by the task
- repo-local build, test, and inspection commands inside selected repo worktrees

## Expected Inputs

- Linear issue identifier, or work agreed with the human in conversation
- Linear issue metadata from MCP, or explicit human-provided fallback metadata

## Linear MCP Resolution

1. Use Linear MCP `get_issue` with the requested issue identifier.
2. If lookup fails, returns no issue, or omits `identifier`/`title`, stop and ask
   the human for the missing metadata.
3. Map MCP fields into the JSON shape printed by `mahler linear-template issue`.
   Put Linear acceptance criteria or checklist items in `acceptanceCriteria` when present.
   Include `nonGoals`, `protectedAreas`, and `riskNotes` only when the Linear issue provides them.
   If the issue belongs to a Linear project, use `get_project` and put the
   project's labels in `projectLabels` so the brief can show merge routing.
4. Write the metadata to `.harness/tmp/linear/<ISSUE>.json` in the product workspace,
   creating the directory if needed.
5. Run `mahler issue <ISSUE> --agent <agent> --linear-file .harness/tmp/linear/<ISSUE>.json`.
6. Read the generated issue brief under `.harness/issues/<ISSUE>/`, including
   its `Relevant Knowledge` section, and `.harness/decisions/INDEX.md`. Open
   the notes that bear on the work (see the knowledge policy). Record a new
   deviation with `mahler decide` only when its reason generalizes beyond this
   issue.
7. Decide which configured repos need worktrees for the task, and whether to
   split the work into slices (see the conduct skill); each slice gets its own
   branch and worktree.
8. Choose short-lived branch names using `.harness/policies/branching.md`.
9. Create only the needed repo worktrees, preferably under `workspaces/issues/<ISSUE>/repos/<repo>`
   (`repos/<repo>-<slice>` for additional slices in the same repo).

## Local Task Resolution

When the work was agreed in conversation and has no Linear issue:

1. Write the task with the write-issue skill, as JSON in the shape printed
   by `mahler linear-template task`: title, description, risk, acceptance
   criteria, non-goals, protected areas, and risk notes.
2. Show the criteria and risk level to the human and wait for their go-ahead.
3. Write it to `.harness/tmp/tasks/<slug>.json` and run `mahler task <slug>
   --agent <agent> --task-file .harness/tmp/tasks/<slug>.json`. The issue
   identifier is `local-<slug>` from here on.
4. Continue from step 6 above.

## Risk

Read the risk line under `## Risk and Verification` in `AGENT_SESSION.md`. If
it says the risk is not set, classify it with the risk policy before starting,
record it in `HANDOFF.md`, and add the label in Linear when you can.

## Next

Continue with the conduct skill: implement directly unless the issue warrants
delegated slices, then review, verify, and open the PRs.

## Required Outputs

- Generated issue brief
- Repo worktrees only where needed
- Updated `HANDOFF.md` with the chosen repos, branches, and slices

## Stop Conditions

- a named Linear issue's metadata is unavailable or incomplete
- Linear MCP lookup fails or returns a different issue identifier
- a local task has no go-ahead from the human
- no repo is configured
- requested work is outside the issue or task scope

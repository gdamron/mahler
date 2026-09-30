---
name: implement
description: Implement a scoped slice of issue work in its worktree with test-verified save-point commits, then push the branch.
---

# Implement

Implementation is a loop of small, tested, committed increments. An implementer
runs this skill for a slice delegated by an orchestrator; a full-stack agent
runs it directly for the whole issue.

## Triggers

- an orchestrator's implementer brief
- "implement this slice"
- "address these review findings"

## Required Policies

- judgment
- workspace-safety
- implementation
- branching
- commit
- definition-of-done
- handoff

## Allowed Commands

- repo-local build, test, and inspection commands inside the assigned worktree
- `mahler check --workspace <workspace> --path <worktree>` for your worktree
- `git status`, `git diff`, `git add`, `git commit` (via the commit skill)
- `git push` for the assigned branch only; never force-push a shared branch or
  push to a base branch
- `mahler decide --rule <rule> --reason "<why>" --issue <ISSUE> --agent <agent>`

## Expected Inputs

- The issue brief: `TASK.md`, `AGENT_SESSION.md`, `HANDOFF.md`
- When delegated: the implementer brief (objective, worktree, branch, allowed
  paths, constraints)
- When iterating: the review findings to address

## Process

1. Read the issue brief and implementer brief. Confirm the worktree and branch
   match the brief; stop if they do not.
2. Inspect the relevant code and tests before editing (implementation policy).
3. Work in save points: implement a small increment, run focused tests, commit
   it with the commit skill, and continue. If a change breaks tests, revert to
   the last commit and investigate rather than piling on fixes.
4. When addressing review findings, fix each accepted one in its own commit
   where practical. If you disagree with a finding, say why in your report
   instead of silently skipping it.
5. Run `mahler check --path <worktree>` for your worktree, then push the branch
   (`git push -u origin <branch>`).
6. Report the implementation policy's change summary (changes made, things
   intentionally not touched, potential concerns), the commit list, checks run,
   and the pushed branch.

When delegated, report status and results to the orchestrator, which owns
`HANDOFF.md`; you still record your own workflow deviations there. When
running as full-stack, update `HANDOFF.md` yourself.

## Required Outputs

- Save-point commits on the assigned branch, pushed
- A change summary, commit list, and checks run
- Workflow deviations recorded in `HANDOFF.md`

## Stop Conditions

- the brief is missing, or the worktree/branch does not match it
- the change needs files outside the allowed paths
- tests fail and cannot be fixed within scope
- the worktree is owned by another active agent
- the next step is opening a PR, merging, or changing issue-tracker state:
  report back instead

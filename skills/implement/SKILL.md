---
name: implement
description: Implement a scoped slice of issue work in its worktree with test-verified save-point commits, then push the branch.
---

# Implement

Implementation is a loop of small, tested, committed increments. A conductor
runs this skill for its own slice of an issue, or, in slice mode, for a slice
delegated by another conductor.

## Triggers

- a conductor's slice brief
- "implement this slice"
- "address these review findings"

## Required Policies

- workspace-safety
- implementation
- commit

When you own the issue, also: judgment, branching, definition-of-done, and
handoff. In slice mode your parent owns those.

## Allowed Commands

- repo-local build, test, and inspection commands inside the assigned worktree
- `mahler check --workspace <workspace> --path <worktree>` for your worktree
- `git status`, `git diff`, `git add`, `git commit` (via the commit skill)
- `git push` for the assigned branch only; never force-push a shared branch or
  push to a base branch
- `mahler decide --rule <rule> --description "<one line>" --reason "<why>" --issue <ISSUE> --agent <agent>`
- `mahler knowledge search <terms>` or `--changed`; `mahler learn` and
  `mahler knowledge verify` when you own the issue (in slice mode, propose
  notes in your report instead)

## Expected Inputs

- The issue brief: `TASK.md`, `AGENT_SESSION.md`, `HANDOFF.md`
- When delegated: the slice brief (objective, worktree, branch, allowed
  paths, constraints)
- When iterating: the review findings to address

## Process

1. Read the issue brief and, when delegated, the slice brief. Confirm the worktree and branch
   match the brief; stop if they do not.
2. Inspect the relevant code and tests before editing (implementation policy).
   Before working in an unfamiliar area, search the knowledge store for it
   (see the knowledge policy).
3. Work in save points: implement a small increment, run focused tests, commit
   it with the commit skill, and continue. If a change breaks tests, revert to
   the last commit and investigate rather than piling on fixes.
4. Never edit frozen acceptance tests (the brief or `HANDOFF.md` names them,
   and `mahler check` fails if they change). They live in the tester's
   worktree, not your branch: to run them, merge your branch into that
   worktree and test there (see the verification policy), and don't copy them
   into your branch. If one looks wrong, report it as
   a possible dispute with the test, the criterion, and your reasoning, and
   keep working on everything else.
5. When addressing review findings, fix each accepted one in its own commit
   where practical. If you disagree with a finding, say why in your report
   instead of silently skipping it.
6. Run `mahler check --path <worktree>` for your worktree, then push the branch
   (`git push -u origin <branch>`).
7. Report the implementation policy's change summary (changes made, things
   intentionally not touched, potential concerns), the commit list, checks run,
   and the pushed branch, plus any fact worth a knowledge note (see the
   knowledge policy).

In slice mode, report status and results to the conductor that owns
`HANDOFF.md`; you still record your own workflow deviations there. When you own
the issue, update `HANDOFF.md` yourself.

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

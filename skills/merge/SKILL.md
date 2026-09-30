---
name: merge
description: Decide whether a reviewed PR may be merged by an agent, then merge it or hand it to the human with a risk assessment.
---

# Merge

## Triggers

- an orchestrator reports a PR ready to merge
- "merge the PRs for this wave"
- "merge PR #123"

## Required Policies

- judgment
- merge
- pr
- branching
- workspace-safety
- handoff

## Allowed Commands

- forge PR inspection: `gh pr view`, `gh pr checks`, `gh pr diff`
- forge merge without bypass flags: `gh pr merge <pr> --<method> --delete-branch`
- Linear MCP `get_issue` and `get_project` for labels
- `git fetch`, `git worktree remove`, `git branch -d` for post-merge cleanup

## Expected Inputs

- PR URL and the issue brief under `.harness/issues/<ISSUE>/`, including the
  issue's `labels` and `projectLabels`
- The orchestrator's merge assessment
- `merge.humanReviewLabels` and `merge.agentMergeLabels` from
  `.harness/config.json`

## Process

1. Confirm the issue and project labels with Linear MCP (they may have changed
   since the brief) and apply the merge policy's decision order.
2. Verify every readiness item yourself; do not rely only on the orchestrator's
   assessment.
3. If there is no matching label, apply the risk rubric independently. With an
   agent-merge label, skip the rubric, but still hand the PR to the human if
   you see high risk.
4. When an agent merge is allowed, merge using the repo's merge method.
   Otherwise, hand the PR to the human with the assessment and continue with
   other work.
5. Clean up and retarget stacked PRs per the merge policy.
6. Record the decision in `COMPOSITION.md` and the issue's `HANDOFF.md`.

## Required Outputs

- A merged PR, or a human hand-off carrying the merge assessment
- The decision recorded with risk level, reasons, and matched labels

## Stop Conditions

- a human-review label matches
- any readiness check fails
- you are not a composer and the human has not explicitly asked you to merge
  this PR
- the forge rejects the merge: do not retry with bypass flags

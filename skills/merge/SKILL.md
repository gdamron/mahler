---
name: merge
description: Decide whether a verified PR may be merged by an agent, then merge it or hand it to the human with its verification record.
---

# Merge

## Triggers

- a conductor reports a PR ready to merge
- "merge the PRs for this wave"
- "merge PR #123"

## Required Policies

- judgment
- merge
- risk
- verification
- pr
- branching
- workspace-safety
- handoff

## Allowed Commands

- forge PR inspection: `gh pr view`, `gh pr checks`, `gh pr diff`
- forge merge without bypass flags: `gh pr merge <pr> --<method> --delete-branch`
- Linear MCP `get_issue` and `get_project` for labels
- `mahler check --workspace <workspace> --issue <ISSUE>` and
  `mahler acceptance run --workspace <workspace> --project <slug> --issue <ISSUE>`
- `mahler cleanup <ISSUE> --workspace <workspace>`, `git fetch`, and `git branch -d` for post-merge cleanup

## Expected Inputs

- PR URL and the issue or task brief under `.harness/issues/<ISSUE>/`,
  including its labels, project labels, and risk level
- The conductor's verification record
- `merge` (`humanReviewLabels`, `humanReviewPaths`, `agentMergeLabels`) from
  `.harness/config.json`

## Process

1. For a Linear issue, confirm the issue and project labels with Linear MCP
   (they may have changed since the brief). A local task's brief is its
   record. Apply the merge policy's decision order, using `mahler check` to
   list any changed human-review paths.
2. Check the PR against the risk policy's signals and raise the level if one
   matches. Then confirm that level's verification is complete (see the
   verification policy): tester results, frozen tests, the project suite, and
   the reviewer's tier.
3. Verify every readiness item yourself; do not rely only on the conductor's
   record.
4. When an agent merge is allowed, merge using the repo's merge method.
   Otherwise, hand the PR to the human with the verification record and
   continue with other work.
5. Clean up and retarget stacked PRs per the merge policy. When the issue's
   last PR merges, run `mahler cleanup <ISSUE>`.
6. Record the decision in `COMPOSITION.md` and the issue's `HANDOFF.md`.

## Required Outputs

- A merged PR, or a human hand-off carrying the verification record
- The decision recorded with risk level, routing, and who merged

## Stop Conditions

- a human-review label matches, or a human-review path changed without an
  agent-merge label
- any readiness check fails, or the risk level's verification is incomplete
- a dispute is open
- you are not a composer and the human has not explicitly asked you to merge
  this PR
- the forge rejects the merge: do not retry with bypass flags

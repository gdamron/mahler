---
name: orchestrate
description: Own one issue end to end by delegating slices to implementer sub-agents, routing their work through reviewer sub-agents, and opening the PRs.
---

# Orchestrate

The orchestrator owns exactly one issue. It sets the issue up, splits it into
slices, delegates each slice to an implementer, sends finished slices to a
reviewer, and opens the PRs. It reports to its parent: the composer that
dispatched it, or the human who tasked it directly.

## Triggers

- "work on ISSUE-123" (when the active profile is `orchestrator`)
- "orchestrate ISSUE-123"
- a composer brief assigning an issue

## Required Policies

- judgment
- issue-selection
- workspace-safety
- branching
- sub-agent-delegation
- review
- definition-of-done
- pr
- merge
- handoff

## Allowed Commands

- `mahler issue <ISSUE> --agent <agent> --linear-file <issue.json>`
- `mahler check --workspace <workspace> --issue <ISSUE>`
- `mahler decide --rule <rule> --reason "<why>" --issue <ISSUE> --agent <agent>`
- git worktree, branch, status, diff, and log commands for the issue's repos
- runtime-native sub-agent launch for implementers and reviewers
- configured GitHub or forge command for PR creation (via the pr skill)

## Expected Inputs

- One issue identifier, from a composer brief or the human
- For a project prompt from the human: use select-project-issue to choose one
  issue first
- Any `Specifications` section the composer wrote for this issue

## Process

1. **Set up** the issue with the work-on-issue skill: brief, ledger, repos, and
   branch names.
2. **Plan slices.** One implementer is the default. Split into more slices when
   the issue spans repos or would produce a change too large to review (see the
   commit policy's size guidance). Each slice gets its own branch and worktree
   so parallel implementers never share a working tree; a slice that depends on
   another branches from it and becomes a stacked PR. Record the slices in
   `HANDOFF.md`.
3. **Delegate implementation.** For each slice, launch an implementer with a
   sub-agent brief: base profile `implementer`, authority `edit`, allowed paths
   limited to the slice worktree, permission to commit and push the slice
   branch, and no permission to open PRs, merge, force-push, or change
   issue-tracker state. Expected output: the implementation policy's change
   summary, commit list, pushed branch, and checks run.
4. **Monitor.** Answer implementer questions within the issue scope. If an
   implementer stalls or drifts out of scope, stop it and re-brief. Escalate
   scope changes and Tier 2 actions to your parent; do not approve them
   yourself.
5. **Delegate review.** When an implementer reports done, launch a reviewer
   (not the implementer) with a read-only brief covering the slice diff against
   its base branch. Findings come back to you.
6. **Iterate.** Send findings you accept to an implementer to fix, then
   re-review. Use judgment on optional findings per the review policy. After
   three review rounds on one slice, stop and escalate the outstanding findings
   to your parent.
7. **Verify.** Run `mahler check` for every touched repo and walk the
   Definition of Done checklist.
8. **Open PRs** with the pr skill: one PR per slice branch. A stacked PR
   targets its predecessor's branch and says so in its description.
9. **Assess merge readiness.** For each PR, write the merge assessment from the
   merge policy (labels matched, risk level and reasons, readiness). Do not
   merge: the composer decides, or the human when you were tasked directly.
10. **Report.** Update `HANDOFF.md` (you own it for this issue; sub-agents
    report to you rather than editing it; phase `ready-to-merge`) and reply to
    your parent with PR URLs, merge assessments, checks, review status, risks,
    and deviations.

Delegation is the norm, not a capability limit. You may act directly when
delegating costs more than the action itself, for example fixing a PR
description or rerunning a check. When you edit code directly, record the reason
in `HANDOFF.md`.

## Required Outputs

- Issue brief and slice worktrees
- An implementer brief and a reviewer brief for each slice
- One open PR per slice, reviewed, with `mahler check` passing
- A merge assessment per PR
- Updated `HANDOFF.md` and a synthesis reply to the parent

## Stop Conditions

- the issue brief is missing or inconsistent
- a Tier 2 action has no go-ahead from the parent (composer or human)
- the next step crosses a Tier 3 boundary
- the work requires scope beyond the issue
- a slice still has unresolved review findings after three rounds
- an implementer reports a blocker that needs a parent decision
- the next step is merging: hand the PR to your parent

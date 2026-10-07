---
name: conduct
description: Own one issue end to end — implement it directly by default, delegate slices to conductor sub-agents only when the issue warrants it, route the diff through a reviewer, and open the PRs. Also covers slice mode, when a parent conductor delegates one slice.
---

# Conduct

The conductor owns exactly one issue, or one slice of an issue in slice mode.
Like a conductor who also plays, it does the work itself by default and brings
in more players only when the piece needs them. It reports to its parent: the
composer that dispatched it, the conductor that delegated its slice, or the
human who tasked it directly.

## Triggers

- "work on ISSUE-123" (when the active profile is `conductor`, or a composer
  is handed a single issue)
- "conduct ISSUE-123"
- a composer brief assigning an issue
- a conductor brief assigning a slice (slice mode)

## Required Policies

Issue mode: judgment, issue-selection, workspace-safety, branching,
implementation, commit, sub-agent-delegation, review, definition-of-done, pr,
merge, handoff.

Slice mode reads only: judgment, workspace-safety, implementation, branching,
commit, handoff. Skip the rest; your parent owns them.

## Allowed Commands

- `mahler issue <ISSUE> --agent <agent> --linear-file <issue.json>`
- `mahler check --workspace <workspace> --issue <ISSUE>` (or `--path <worktree>`)
- `mahler capacity --workspace <workspace>`
- `mahler decide --rule <rule> --reason "<why>" --issue <ISSUE> --agent <agent>`
- git worktree, branch, status, diff, log, add, commit, and push commands for
  the issue's own branches
- runtime-native sub-agent launch for slice conductors and reviewers
- configured GitHub or forge command for PR creation (via the pr skill)

## Expected Inputs

- One issue identifier, from a composer brief or the human
- For a project prompt from the human: use select-project-issue to choose one
  issue first
- Any `Specifications` section the composer wrote for this issue
- In slice mode: the slice brief (objective, worktree, branch, allowed paths)

## Process (issue mode)

1. **Set up** the issue with the work-on-issue skill: brief, ledger, repos, and
   branch names.
2. **Decide the shape.** Work directly — one slice, done by you — unless one of
   these holds:
   - the issue spans repos or splits into independent parts worth running in
     parallel;
   - the change would exceed the commit policy's size guidance and should land
     as stacked PRs;
   - a part suits a much cheaper tier than you (see the delegate skill), or
     would flood your context with exploration you don't need to keep.

   When you split, each slice gets its own branch and worktree so parallel
   workers never share a working tree: `repos/<repo>` for the first slice in a
   repo, `repos/<repo>-<slice>` for the rest. A slice that depends on another
   branches from it and becomes a stacked PR. Record the shape and the reason
   in `HANDOFF.md`.
3. **Implement.** Do your own slice with the implement skill. For each
   delegated slice, use the delegate skill to pick the tier and write the
   brief: base profile `conductor`, `slice mode`, authority `edit`, allowed
   paths limited to the slice worktree, permission to commit and push the slice
   branch only, and no permission to open PRs, merge, force-push, change
   issue-tracker state, or delegate further. Stay within
   `concurrency.maxSliceAgents` and check `mahler capacity` before launching.
4. **Monitor.** Answer slice questions within the issue scope. If a slice
   stalls or drifts out of scope, stop it and re-brief, or take it over.
   Escalate scope changes and Tier 2 actions to your parent; do not approve
   them yourself.
5. **Review.** Launch a reviewer that did not write the code, with a read-only
   brief covering the diff against its base branch; pick its tier with the
   delegate skill. For more than one slice, review each slice's diff.
6. **Iterate.** Fix findings you accept (or send them back to the slice
   conductor), then ask the same reviewer to re-review only the fix commits
   rather than launching a fresh one. Use judgment on optional findings per the
   review policy. After three review rounds on one slice, stop and escalate
   the outstanding findings to your parent.
7. **Verify.** Run `mahler check --issue <ISSUE>`, which checks every worktree
   under the issue's `repos/` dir, slices included, and walk the Definition of
   Done checklist.
8. **Open PRs** with the pr skill: one PR per slice branch. A stacked PR
   targets its predecessor's branch and says so in its description.
9. **Assess merge readiness.** For each PR, write the merge assessment from the
   merge policy (labels matched, risk level and reasons, readiness). Do not
   merge: the composer decides, or the human when you were tasked directly.
10. **Report.** Update `HANDOFF.md` (you own it for this issue; phase
    `ready-to-merge`) and reply to your parent with PR URLs, merge
    assessments, checks, review status, risks, and deviations.

## Slice Mode

When your brief says `slice mode`, you are one player in another conductor's
issue:

1. Confirm the worktree and branch match the brief; stop if they do not.
2. Run the implement skill in your worktree only, committing save points.
3. Run `mahler check --path <worktree>`, then push your slice branch.
4. Report the implementation policy's change summary, commit list, checks run,
   and pushed branch to your parent. Your parent owns `HANDOFF.md`; record only
   your own workflow deviations there.

Do not set up the issue, open PRs, write merge assessments, or delegate.

## Required Outputs

- Issue brief and worktrees; the chosen shape and its reason in `HANDOFF.md`
- A brief, with tier and reason, for every sub-agent launched
- One open PR per slice, reviewed, with `mahler check` passing
- A merge assessment per PR
- Updated `HANDOFF.md` and a synthesis reply to the parent

## Stop Conditions

- the issue brief (or, in slice mode, the slice brief) is missing or
  inconsistent
- a Tier 2 action has no go-ahead from the parent (composer or human)
- the next step crosses a Tier 3 boundary
- the work requires scope beyond the issue or slice
- a slice still has unresolved review findings after three rounds
- a blocker needs a parent decision
- the next step is merging: hand the PR to your parent

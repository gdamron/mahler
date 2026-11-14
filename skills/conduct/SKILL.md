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
implementation, commit, sub-agent-delegation, review, risk, verification,
definition-of-done, pr, merge, handoff.

Slice mode reads only: judgment, workspace-safety, implementation, branching,
commit, handoff. Skip the rest; your parent owns them.

## Allowed Commands

- `mahler issue <ISSUE> --agent <agent> --linear-file <issue.json>`
- `mahler check --workspace <workspace> --issue <ISSUE>` (or `--path <worktree>`)
- `mahler task <slug> --agent <agent> --task-file <task.json>` for a local task
- `mahler acceptance freeze --workspace <workspace> --issue <ISSUE> --repo <repo> --commit <sha>`
- `git merge --no-edit <issue branch>` in the tester's worktree, to run its
  suite against the implementation (never the other way round)
- `mahler acceptance run --workspace <workspace> --project <slug> --issue <ISSUE>`
- `mahler capacity --workspace <workspace>`
- `mahler mark <ISSUE> <name> --workspace <workspace>` (see Timing Marks)
- `mahler knowledge search`, `mahler learn`, and `mahler knowledge verify`
  (see the knowledge policy)
- `mahler decide --rule <rule> --description "<one line>" --reason "<why>" --issue <ISSUE> --agent <agent>`
- git worktree, branch, status, diff, log, add, commit, and push commands for
  the issue's own branches
- runtime-native sub-agent launch for slice conductors, testers, and reviewers
- `gh stack link` for stacked PRs; `gh stack merge` only when the human
  explicitly asks you to merge that stack (see the merge policy)
- configured GitHub or forge command for PR creation (via the pr skill)

## Expected Inputs

- One issue identifier (or local task), from a composer brief or the human
- For a project prompt from the human: use select-project-issue to choose one
  issue first
- Any `Specifications` section the composer wrote for this issue
- In slice mode: the slice brief (objective, worktree, branch, allowed paths)

## Process (issue mode)

1. **Set up** the issue with the work-on-issue skill: brief, ledger, repos, and
   branch names. Confirm the risk level (see the risk policy) and note in
   `HANDOFF.md` the verification it calls for.
2. **Decide the shape.** Work directly — one slice, done by you — unless one of
   these holds:
   - the issue spans repos or splits into independent parts worth running in
     parallel;
   - the change holds more than one deliverable, or exceeds the pr policy's
     size guidance, and should land as a stack of PRs (a stack lives in one
     repo; work across repos is separate PRs);
   - a part suits a much cheaper tier than you (see the delegate skill), or
     would flood your context with exploration you don't need to keep.

   When you split, each slice gets its own branch and worktree so parallel
   workers never share a working tree: `repos/<repo>` for the first slice in a
   repo, `repos/<repo>-<slice>` for the rest. A slice that depends on another
   branches from it and becomes a stacked PR. Each extra worktree with its own
   dependency install costs disk, CPU, and indexing (see the workspace-safety
   policy), so a slice installs dependencies only when its checks need them.
   Record the shape and the reason in `HANDOFF.md`, with a rough estimate
   (PRs, changed lines). The estimate is not a limit. It is what lets you, and
   your parent, notice when the work has grown into something else.
   Once you know which files the work will change, run `mahler knowledge
   search --paths <repo>/<file>,...` (paths inside each repo, prefixed with
   the repo's name, or `--repo <repo>` with plain paths) and read the notes it
   finds; pass the relevant ones on in slice briefs.
3. **Tests first (high risk).** Before anyone implements, launch a tester
   (pick its tier with the delegate skill: a different model from the
   implementer) to write acceptance tests from the spec in its own worktree
   at `<issue root>/tests/<repo>`, cut from the base branch. Freeze its
   commit with `mahler acceptance freeze --issue <ISSUE> --repo <repo>
   --commit <sha>`. The tester's branch never joins the issue branch and is
   never pushed. To run the suite, merge the issue branch into the tester's
   worktree and test there (see "Running the Tester's Suite" in the
   verification policy). The implementer makes those tests pass without
   changing them.
4. **Implement.** Do your own slice with the implement skill. For each
   delegated slice, use the delegate skill to pick the tier and write the
   brief: base profile `conductor`, `slice mode`, authority `edit`, allowed
   paths limited to the slice worktree, permission to commit and push the slice
   branch only, and no permission to open PRs, merge, force-push, change
   issue-tracker state, or delegate further. Stay within
   `concurrency.maxSliceAgents` and check `mahler capacity --workspace <workspace>` before launching.
5. **Monitor.** Answer slice questions within the issue scope. If a slice
   stalls or drifts out of scope, stop it and re-brief, or take it over.
   Escalate scope changes and Tier 2 actions to your parent; do not approve
   them yourself. When the work clearly outgrows its estimate (more PRs than
   planned, or new kinds of gaps turning up), check in with your parent before
   continuing. Bring a proposed cut: ship what is done, ship the clear bug and
   set the rest aside for triage, or redesign. Splitting into more stacked PRs
   keeps each one reviewable, but it doesn't make the whole change smaller.
6. **Review and test.** Launch a reviewer that did not write the code, with a
   read-only brief covering the diff against its base branch; its tier
   follows the risk level (see the delegate skill). For more than one slice,
   review each slice's diff. At medium risk, launch a tester alongside the
   reviewer, unless no criterion can be reached from outside (record why). It works from the spec, not the diff; freeze its commit and run
   its suite from its worktree as in step 3. At low risk, have the reviewer
   confirm the tests can fail (see the verification policy).
7. **Iterate.** Weigh the findings as the review policy describes (for
   example fix, acknowledge, set aside for triage, or rebut). Fix the ones you accept (or
   send them back to the slice conductor), then ask the same reviewer to
   re-review only the fix commits rather than launching a fresh one. Stop when
   nothing open is a clear bug or likely to reach users. After about three
   rounds on one slice, escalate what is still open to your parent with a
   recommendation: accept the risk, rebut, set aside, run one more round on a
   named question, or redesign. When the parent allows more rounds, give each
   one a purpose rather than continuing until the reviewer is quiet.
   When a tester's test fails, decide whether the code, the test, or the spec
   is at fault (see the verification policy). Fix the code yourself. For a
   wrong test or an unclear criterion, raise a dispute with your parent and
   wait for the decision. Never edit frozen tests yourself; after a decision,
   the tester changes them and you freeze again with `--reason`. A rebase or
   restack needs no new freeze: the comparison is by content.
7a. **Promote (medium and high risk).** Once every frozen test passes on the
   final implementation and the findings are handled, write the tests worth
   keeping into the issue branch as ordinary tests, in one commit, and have
   the same reviewer check that commit against the originals (see "Promoting
   Acceptance Tests" in the verification policy). Keep a test unless a drop
   rule applies, and say which you dropped and why.
8. **Verify.** Run `mahler check --issue <ISSUE>`, which checks every worktree
   under the issue's `repos/` dir, slices included, and fails if a frozen
   acceptance test in the tester's worktree changed. When the issue's project has an acceptance suite,
   run `mahler acceptance run --project <slug> --issue <ISSUE>`. Walk the
   Definition of Done checklist.
9. **Open PRs** with the pr skill: one PR per slice branch, each with proof
   that it works. A stacked PR targets its predecessor's branch and says so
   in its description; link dependent PRs into a GitHub stack with
   `gh stack link` so they merge in one step (see the pr policy).
10. **Record verification.** For each PR, write the verification record from
    the verification policy into `HANDOFF.md` and the PR description, with
    the merge routing (labels and any human-review paths `mahler check`
    reported). Do not merge: the composer decides, or the human when you were
    tasked directly.
11. **Record knowledge.** Write the notes this issue taught you, and the ones
    slice conductors, testers, and reviewers proposed, with `mahler learn`;
    update or verify existing notes the work confirmed or corrected.
12. **Report.** Update `HANDOFF.md` (you own it for this issue; phase
    `ready-to-merge`) and reply to your parent with PR URLs, verification
    records, checks, review status, risks, and deviations.

## Timing Marks

Mahler's commands record most of an issue's timeline on their own. Five
boundaries have no command, so mark them as you pass them, in the same
message as the launch or the reply you are acting on:

```sh
mahler mark <ISSUE> tester-start    # as you launch the tester
mahler mark <ISSUE> tester-done     # when it reports
mahler mark <ISSUE> review-start    # as you launch, or re-engage, the reviewer
mahler mark <ISSUE> review-done     # when its findings arrive (once per round)
mahler mark <ISSUE> promoted        # after the promotion commit
```

A missed mark is not a deviation and needs no record; `mahler timings` works
with what it has. Don't mark in slice mode.

## Slice Mode

When your brief says `slice mode`, you are one player in another conductor's
issue:

1. Confirm the worktree and branch match the brief; stop if they do not.
2. Run the implement skill in your worktree only, committing save points.
3. Run `mahler check --path <worktree>`, then push your slice branch.
4. Report the implementation policy's change summary, commit list, checks run,
   pushed branch, and any proposed knowledge notes to your parent. Your parent owns `HANDOFF.md`; record only
   your own workflow deviations there.

Do not set up the issue, open PRs, write verification records, or delegate.
Never edit frozen acceptance tests; report a test you think is wrong.

## Required Outputs

- Issue brief and worktrees; the chosen shape and its reason in `HANDOFF.md`
- A brief, with tier and reason, for every sub-agent launched
- One open PR per slice, reviewed, with `mahler check` passing
- Acceptance tests frozen when the risk level calls for them, passing from
  the tester's worktree, with the ones worth keeping promoted
- A verification record per PR
- Updated `HANDOFF.md` and a synthesis reply to the parent

## Stop Conditions

- the issue brief (or, in slice mode, the slice brief) is missing or
  inconsistent
- a Tier 2 action has no go-ahead from the parent (composer or human)
- the next step crosses a Tier 3 boundary
- the work requires scope beyond the issue or slice
- a slice still has open review findings after about three rounds
- a dispute over a frozen test is waiting for a decision
- the work has clearly outgrown its estimate (check in, as in Monitor)
- your parent asks you to pause: finish and push the current commit, update
  `HANDOFF.md`, and report, without starting another review round
- a blocker needs a parent decision
- the next step is merging: hand the PR to your parent

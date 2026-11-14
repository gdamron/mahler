# Merge Policy

Merging a PR into a base branch is a Tier 2 action with a designated approver
(see the judgment policy). The composer is the only agent that merges.
Conductors stop at a PR that is ready to merge and report its verification
record; they merge only when the human explicitly asks for that specific PR.

## Who Decides

Risk decides how much verification a PR needs (see the risk and verification
policies); these rules decide only who merges it.

Check labels on both the issue and its project. The issue brief records them
(`labels` and `projectLabels` in `linear-issue.json`, summarized under `## Merge`
in `AGENT_SESSION.md`), but labels can change after the brief is written, so
confirm them with Linear MCP `get_issue` and `get_project` before merging. A
local task has no Linear labels; its brief is the record. Match labels
case-insensitively against `merge` in `.harness/config.json`. Apply the first
rule that matches:

1. **Human-review label.** Any label in `merge.humanReviewLabels` means a human
   reviews and merges. This always wins.
2. **Human-review path.** A PR that changes a path matching
   `merge.humanReviewPaths` goes to the human, unless a label in
   `merge.agentMergeLabels` pre-approves it. `mahler check` lists the matching
   paths.
3. **Otherwise** the composer merges once every readiness check passes,
   whatever the risk level.

An agent that believes a PR needs human judgment despite the rules (for
example, a change the criteria did not anticipate) hands it to the human and
says why. The rules never stop an agent from asking.

With no composer in the chain (a human tasked a conductor directly), the human
merges. The conductor reports the verification record and its
recommendation.

## Readiness

Every agent merge requires all of these, regardless of labels:

- Required CI checks are green. Never merge with failures, and never use
  bypass or admin flags (for example `gh pr merge --admin`).
- The risk level has been checked against the PR (see the risk policy), and
  that level's verification is complete: the tester's tests pass at medium
  and high risk, and the project suite passes when there is one.
- Reviewer sub-agent findings that matter have a response, such as a fix, an
  acknowledgement with a reason, a note for triage, or a rebuttal (see the
  review policy), and no human review comment is left unanswered.
- `mahler check` passed for the touched repo, including the frozen
  acceptance tests in the tester's worktree, and the tests worth keeping were
  promoted (see the verification policy).
- No dispute is open.
- The forge reports the PR mergeable with no conflicts.
- A stack is verified as one change: the record on its top PR covers every
  PR in it. CI must still be green on each PR up to the one being merged (see
  Stacks below).
- The Definition of Done is satisfied and `HANDOFF.md` is current.

If the forge rejects the merge (branch protection, required human approval),
that is a Tier 3 guardrail doing its job: hand the PR to the human.

## Stacks

A GitHub stack (see the pr policy) merges in one all-or-nothing step, from the
bottom up to the PR you name:

```sh
gh stack merge <stack-number | pr-number> --<method> --yes
```

- Name the PR by number (the top one you merge); stack and PR numbers never
  overlap. The PR numbers are in the issue's `HANDOFF.md`, or follow each
  PR's base (`gh pr view <pr> --json baseRefName`).
- Apply the routing rules to each PR in the stack. If one goes to the human,
  merge only the PRs below it, and hand the rest of the stack to the human.
  The stack's one verification record still covers the part you merge.
- `gh stack merge` checks only that each PR is open and not a draft, and
  branch protection applies to the base branch. Check readiness on every PR
  yourself, and confirm CI actually ran on each (`gh pr checks <pr>` lists
  checks). A PR with no checks is not green; merge one at a time instead, so
  each PR's checks run once it targets the base branch.
- Always pass the merge method and `--yes`; without them the command prompts
  or reuses the last method.
- Stack merges never bypass branch protection. If the forge rejects one,
  nothing merged; handle it as any rejected merge. With a merge queue, the
  stack joins the queue: wait until every PR shows merged before cleanup.
- A stack merge doesn't delete head branches. Delete them afterwards
  (`git push origin --delete <branch>`) unless the repo deletes them on
  merge.
- Without the `gh stack` extension, for stacked PRs that were never linked,
  or when an upper PR has no checks, merge one PR at a time, bottom first:
  each merges only after its predecessor has merged and it has been
  retargeted to the base branch.
- A conductor the human explicitly asked to merge a stack may run
  `gh stack merge` under these same rules.

## Verification Record

A conductor reports one verification record per issue (see the verification
policy), plus the merge routing for each PR, and the composer records its
decision against it:

```md
- PR: <url, or the stack's PRs bottom to top>
- Routing: human-review label <label> | human-review path <paths> | agent merge
- Risk: <level>: <reasons>
- Verification: <the verification record, or a link to it in HANDOFF.md>
- Readiness: CI <status>; review <status>; mahler check <status>
```

## After Merging

- Use the repo's configured merge method (squash, merge, or rebase); if none
  is documented, use the forge default.
- Delete the merged branch (see the branching policy). Once all of an issue's
  PRs are merged, remove its worktrees with `mahler cleanup <ISSUE>`; it keeps
  any worktree with uncommitted changes and reports it, and deletes the
  tester's branch. If a tester branch was pushed in issue mode, add
  `--remote` to delete that copy too. When the human merges,
  the next composer session (or the human) runs the cleanup.
- A stack merge needs no retargeting. After a one-at-a-time merge, retarget
  or rebase the stacked PRs that depended on it.
- Let the forge's issue-tracker integration move the issue. If it doesn't, the
  composer may update the issue state and record that it did.
- Record the decision (PR, risk, routing, who merged) in the
  `COMPOSITION.md` approvals table and the issue's `HANDOFF.md`.

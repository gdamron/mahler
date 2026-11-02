# Merge Policy

Merging a PR into a base branch is a Tier 2 action with a designated approver
(see the judgment policy). The composer is the only agent that merges.
Conductors stop at a PR that is ready to merge and report its verification
record; they merge only when the human explicitly asks for that specific PR.

## Who Decides

The human no longer reviews code by default. Risk decides how much
verification a PR needs (see the risk and verification policies); these rules
decide only who merges it.

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
- `mahler check` passed for the touched repo, including its frozen
  acceptance tests.
- No dispute is open.
- The forge reports the PR mergeable with no conflicts.
- For a stacked PR, its predecessor has merged and the PR now targets the base
  branch.
- The Definition of Done is satisfied and `HANDOFF.md` is current.

If the forge rejects the merge (branch protection, required human approval),
that is a Tier 3 guardrail doing its job: hand the PR to the human.

## Verification Record

A conductor reports the verification record (see the verification policy) for
each PR, plus the merge routing, and the composer records its decision
against it:

```md
- PR: <url>
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
  any worktree with uncommitted changes and reports it. When the human merges,
  the next composer session (or the human) runs the cleanup.
- Retarget or rebase any stacked PRs that depended on it.
- Let the forge's issue-tracker integration move the issue. If it doesn't, the
  composer may update the issue state and record that it did.
- Record the decision (PR, risk, routing, who merged) in the
  `COMPOSITION.md` approvals table and the issue's `HANDOFF.md`.

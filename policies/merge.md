# Merge Policy

Merging a PR into a base branch is a Tier 2 action with a designated approver
(see the judgment policy). The composer is the only agent that merges.
Conductors stop at a PR that is ready to merge and report a merge assessment; they merge only when the human explicitly asks for
that specific PR.

## Who Decides

Check labels on both the issue and its project. The issue brief records them
(`labels` and `projectLabels` in `linear-issue.json`, summarized under `## Merge`
in `AGENT_SESSION.md`), but labels can change after the brief is written, so
confirm them with Linear MCP `get_issue` and `get_project` before merging. Match
labels case-insensitively against `merge` in `.harness/config.json`. Apply the
first rule that matches:

1. **Human-review label.** Any label in `merge.humanReviewLabels` means a human
   reviews and merges. This always wins.
2. **Agent-merge label.** Any label in `merge.agentMergeLabels` means the human
   has pre-approved an agent merge: the composer may merge once every readiness
   check passes, without applying the risk rubric. If it sees high risk anyway,
   it must hand the PR to the human; the label never overrides that judgment.
3. **No matching label.** The composer judges risk with the rubric below. Low
   risk: the composer may merge. Anything else: the human decides.

With no composer in the chain (a human tasked a conductor directly), the human
decides. The agent recommends, using the same
assessment.

## Readiness

Every agent merge requires all of these, regardless of labels:

- Required CI checks are green. Never merge with failures, and never use
  bypass or admin flags (for example `gh pr merge --admin`).
- Reviewer sub-agent findings are resolved, and no human review comment is left
  unanswered.
- `mahler check` passed for the touched repo.
- The forge reports the PR mergeable with no conflicts.
- For a stacked PR, its predecessor has merged and the PR now targets the base
  branch.
- The Definition of Done is satisfied and `HANDOFF.md` is current.

If the forge rejects the merge (branch protection, required human approval),
that is a Tier 3 guardrail doing its job: hand the PR to the human.

## Risk Rubric

A PR is **not** low risk if any of these hold:

- It touches authentication, authorization, payments, secrets or
  cryptography, data migrations or schema, data deletion, infrastructure or
  deploy configuration, CI configuration, or a public API contract others
  consume.
- It touches the issue's `protectedAreas` or relates to its `riskNotes`.
- It adds or upgrades a dependency across a major version.
- Changed behavior lacks covering tests.
- It exceeds roughly 300 lines of non-test changes.
- The reviewer rated any finding critical, even if it was fixed.
- You are uncertain. When in doubt, it is not low risk.

Typical low-risk changes: documentation, test-only changes, small bug fixes with
covering tests, and internal refactors fully covered by existing tests.

## Merge Assessment

A conductor reports this for each PR, and the composer records its
decision against it:

```md
- PR: <url>
- Labels matched: <humanReview | agentMerge | none> (<label>)
- Risk: low | medium | high: <reasons>
- Readiness: CI <status>; review <status>; mahler check <status>
- Recommendation: agent merge | human review
```

## After Merging

- Use the repo's configured merge method (squash, merge, or rebase); if none
  is documented, use the forge default.
- Delete the merged branch and remove its worktree (see the branching and
  workspace-safety policies).
- Retarget or rebase any stacked PRs that depended on it.
- Let the forge's issue-tracker integration move the issue. If it doesn't, the
  composer may update the issue state and record that it did.
- Record the decision (PR, risk, reasons, labels, who merged) in the
  `COMPOSITION.md` approvals table and the issue's `HANDOFF.md`.

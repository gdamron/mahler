# Verification Policy

The human does not always review code. They own the project's acceptance criteria
and need to trust that what agents merge works. That trust comes from three
things: tests written by an agent that did not write the code, checks that
grow with risk, and a record of what was verified.

The work's risk level (see the risk policy) picks the section below. Each
level includes everything in the levels before it.

## Every Level

- The implementer writes tests for the behavior it changes, and `mahler check`
  passes.
- A reviewer that did not write the code reviews it (see the review policy).
- Frozen acceptance tests are unchanged. `mahler check` fails if a worktree
  changes them.
- When the work belongs to a project with an acceptance suite, the suite
  passes for this change: `mahler acceptance run --project <slug> --issue
<ISSUE>`.
- The verification record is in `HANDOFF.md` and the PR description.
- The PR shows proof the change works (see the pr policy). It is required at
  medium and high risk when the change has observable behavior.

## Low Risk

- A light-tier reviewer is enough.
- Check that the tests can fail. Where the repo has mutation testing set up,
  run it on the changed code. Otherwise, the reviewer undoes the non-test
  change locally and confirms at least one test fails.

## Medium Risk

- After implementation, a tester writes acceptance tests from the spec alone.
  It runs alongside the reviewer.
- The tester's tests must pass before merge. This blocks the merge.
- A standard-tier reviewer.
- When a tester's test fails, the conductor decides what failed:
  - **Implementation bug:** fix the code.
  - **Test bug:** raise a dispute (below).
  - **Spec gap** (the criterion allows more than one reading): raise a
    dispute, so the criterion gets clarified for everyone.

## High Risk

- The tester writes acceptance tests before implementation starts, and they
  are frozen before the implementer begins. The implementer makes them pass
  without changing them.
- The tester runs on a different model from the implementer: a tier that
  routes to another model family when the install has one, otherwise a
  different tier.
- A deep or cross-model reviewer.
- The PR carries a rollout plan: how the change ships (a flag, a staged
  rollout, or all at once), how a failure would show, and how to undo it. If a
  revert can't undo it, say so and say how data is protected.

## The Tester

The tester profile follows the acceptance-test skill. In short:

- It works from the spec: `TASK.md`, the project's criteria, and public
  interfaces (types, API docs, CLI help). It does not read the implementation
  diff or the implementer's tests.
- It works in its own worktree, cut from the base branch, at
  `<issue root>/tests/<repo>`, and commits to its own branch. The worktree
  stays outside `repos/` because its tests fail until the implementation
  lands, and `mahler check --issue` runs every worktree under `repos/`.
- In issue mode its branch stays local. The tester worktree shares one
  repository with the issue worktrees, so the conductor merges the branch and
  freezes its commit without a fetch, and no remote branch is left to delete.
  It pushes only a project suite, or when it doesn't share the local
  repository (in the cloud or on another machine).
- Each test names the criterion it checks.
- It reports which criterion each test covers, and any criterion it could not
  test, with the reason.

## Freezing Tests

When the tester's commit is ready, the conductor records it:

```sh
mahler acceptance freeze --issue <ISSUE> --repo <repo> --commit <sha>
# or, for several commits: --commit <base>..<sha>
```

Then it merges the tester's local branch into the issue branch (a merge, not
a cherry-pick, so `git branch -d` can tell the branch landed). The tester's
worktree stays for any dispute fix; `mahler cleanup <ISSUE>` removes it with
the issue's other worktrees and deletes the merged branch with `git branch
-d`. From then on, `mahler check` fails if a checked worktree's copy of those
files differs from the frozen commit, or is missing. For a slice worktree,
pass `--worktree <dir>`: the directory name under the issue's `repos/` (a
path to the worktree is read as that name). A range freeze counts only the
range's own commits, so base-branch changes made after the tester branched
are not frozen.

Only the tester changes frozen tests, and only after a dispute decision.

## Disputes

When the implementer or conductor believes a frozen test is wrong, the
conductor raises a dispute with its parent (the composer, or the human when
there is none). The dispute gives the test, the criterion, and the reasoning.
The composer decides one of three things:

- The test stands, and the implementation changes.
- The test is wrong. The tester fixes it.
- The criterion was unclear. The composer clarifies it, and the tester updates
  the tests to match.

After a change, the conductor freezes again with the decision:
`mahler acceptance freeze ... --reason "<decision>"`. The new freeze covers the
whole suite at its commit: every file of the freeze it replaces, plus the
files the new commit adds or changes. It fails if a frozen file is missing at
that commit; when the decision removes a test file, pass `--drop <file>`. The
replaced freeze stays in the history, with the reason and the commit that
superseded it. A dispute that changes what the human's project criteria mean
goes to the human.

For a project suite, the tester's fix goes through a PR in the acceptance
repo, and `mahler check` on that branch would fail against the old freeze. So
the composer freezes twice: first at the fix branch's commit, with
`--reason`, so the PR's checks pass; then, once it merges, at the merged
commit on the base branch, with `--reason "<decision>; merged"`, so the
freeze applies to every branch that contains it.

## Project Acceptance

The human writes a project's acceptance criteria at a high level. Agents turn
them into an acceptance suite that every issue in the project runs against.

- **Where it lives:** `acceptance` in `.harness/config.json` names the repo
  (`repo`), the directory in it (`path`, default `acceptance`), and the
  command that runs it (`run`). Each project gets
  `<path>/projects/<slug>/`, with the human's criteria in `CRITERIA.md`,
  numbered P1, P2, and so on.
- **Separate or shared repo:** use a repo of its own when the project spans
  repos or the suite needs its own toolchain. Use a directory in an existing
  repo when one repo holds the code. Both work the same way.
- **Writing it:** the composer launches a tester in project mode when the
  project starts. Its branch merges through the acceptance repo's usual PR
  flow. Then the composer freezes it at the merged commit on the base branch:
  `mahler acceptance freeze --project <slug> --repo <repo> --commit <sha>`.
  A project freeze applies to every worktree of that repo whose history
  contains the frozen commit, so older branches aren't blocked.
- **Running it:** `mahler acceptance run --project <slug> [--issue <ISSUE>]`
  writes a revision manifest (each repo's issue worktree when it has one, and
  its base branch otherwise) and runs `acceptance.run` with `<manifest>` and
  `<project>` filled in. The suite reads the manifest to test those revisions.
  When an issue has several worktrees of one repo (slices), pass `--worktree
  <dir>` to name the one to test. `mahler acceptance manifest` writes the
  manifest alone.
- **Tracking it:** `COMPOSITION.md` keeps a table of each criterion, the
  issues that serve it, the tests that check it, and whether it passes.
- **Done:** the composer runs the suite on the base branches after each wave
  merges. The project is done when every criterion passes there. A failing
  criterion becomes new work.

## Verification Record

The conductor keeps this in the `## Verification` section of `HANDOFF.md`,
and the PR description carries it:

```md
- Risk: <level> (<source>; raised from <level> because <reason>, if raised)
- Implementer tests: <what they cover>; mahler check <status>
- Acceptance tests: frozen at <sha> (<n> files) | not required (low risk)
- Tester results: <n> pass; <failures and how each was classified>
- Project suite: <pass | fail | none>
- Reviewer: <tier>; findings handled
- Proof: <what shows it working, and where: PR body, PR comment, Linear comment>
- Disputes: <none | decision>
- Rollout (high risk): <plan>
```

## What CI Must Do

`mahler check` runs locally and is a Tier 1 control. The tests themselves land
in the PR, so the repo's CI runs them on every later change. That makes CI the
regression guardrail: each repo's CI should run its full test suite, including
merged acceptance tests, on every PR. Name any gap in `guardrails`.

# Verification Policy

The human does not always review code. They own the project's acceptance criteria
and need to trust that what agents merge works. That trust comes from three
things: tests written by an agent that did not write the code, checks that
grow with risk, and a record of what was verified.

A tester's suite verifies one change, through the outermost surface the
criteria are stated against. It never joins the issue branch: it runs from
the tester's own worktree and is discarded after the change merges. A test
is kept only with a stated reason (see "Promoting Acceptance Tests").

The work's risk level (see the risk policy) picks the section below. Each
level includes everything in the levels before it.

## Every Level

- The implementer writes tests for the behavior it changes, and `mahler check`
  passes.
- A reviewer that did not write the code reviews it (see the review policy).
- Frozen acceptance tests are unchanged. `mahler check` fails if they differ
  from what was frozen.
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
  It runs alongside the reviewer. When no criterion can be reached from
  outside (an internal refactor, a change nothing outside can observe), skip
  the tester and record why in the verification record; the implementer's
  tests and the reviewer cover it. At high risk that is a Tier 1 deviation.
- The tester's tests must pass before merge. This blocks the merge.
- Once they pass on the final implementation, the conductor decides which,
  if any, to keep, before reporting the PRs ready (see "Promoting Acceptance
  Tests").
- A standard-tier reviewer.
- When a tester's test fails, the conductor decides what failed:
  - **Implementation bug:** fix the code.
  - **Test bug:** raise a dispute (below).
  - **Spec gap** (the criterion allows more than one reading): raise a
    dispute, so the criterion gets clarified for everyone.

## High Risk

- The tester writes acceptance tests before implementation starts, and they
  are frozen before the implementer begins. The implementer makes them pass
  without changing them, running them from the tester's worktree (see
  "Running the Tester's Suite").
- The tester runs on a different model from the implementer: a tier that
  routes to another model family when the install has one, otherwise a
  different tier.
- A deep or cross-model reviewer.
- The PR carries a rollout plan: how the change ships (a flag, a staged
  rollout, or all at once), how a failure would show, and how to undo it. If a
  revert can't undo it, say so and say how data is protected.

## The Tester

The acceptance-test skill is the tester's whole instruction set; it reads no
other policy but workspace-safety. What its parent needs to know:

- It works from the spec and public interfaces, in its own worktree at
  `<issue root>/tests/<repo>`, cut from the base branch. The worktree stays
  outside `repos/` because its tests fail until the implementation exists,
  and `mahler check --issue` runs every worktree under `repos/`.
- Its branch is scratch work: in issue mode never pushed, never merged into
  the issue branch, never a PR. `mahler cleanup` deletes it.
- It tests only through the outermost surface (the running product, or a
  public API), to the bar in its skill, and adds new files rather than
  editing existing ones.
- It reports which criterion each test covers, and any criterion it could not
  test from outside, with the reason.

## Freezing Tests

When the tester's commit is ready, the conductor records it:

```sh
mahler acceptance freeze --issue <ISSUE> --repo <repo> --commit <sha>
# or, for several commits: --commit <base>..<sha>
```

The freeze records each file's content. With a tester worktree at
`<issue root>/tests/<repo>`, it applies there, and `mahler check --issue
<ISSUE>` (or `--path` on any of the issue's worktrees) fails if a frozen file
in that worktree is missing or differs, committed or not. The check compares
the files and does not run them, so its `ok` line says "compared, not run".
For a second tester worktree, pass `--worktree tests/<dir>`. A range freeze counts only the
range's own commits, so base-branch changes made after the tester branched
are not frozen.

A freeze compares content, not history. Rebasing, restacking, or merging the
issue branch into the tester's worktree leaves the files alone, so none of
them needs a new freeze. Freeze again only when a dispute decision changes
the tests.

Only the tester changes frozen tests, and only after a dispute decision.

## Running the Tester's Suite

The suite runs in the tester's worktree, against the implementation, once the
tester has reported. One command does it and records the result:

```sh
mahler acceptance run --issue <ISSUE> --tester
# for a stack, name the top branch: --repo <repo> --branch <top branch>
```

For each of the issue's freezes in a tester worktree, it merges the
implementation into that worktree, confirms the frozen files are unchanged,
runs the suite's command there, and records what it ran against: the
implementation's commit and tree, the frozen commit, pass or fail, and how
long it took. The output is kept in `.harness/issues/<ISSUE>/`.

- **The command** is the repo's `acceptanceRun` in `.harness/config.json`,
  beside its `checks`. `<files>` is replaced by the frozen files. When an
  issue's suite needs its own arguments (a binary path, a port), record them
  with the freeze: `mahler acceptance freeze ... --run "<command>"`. A
  re-freeze keeps that command unless it gives another.
- **Counts come from the run.** Pass or fail is the command's exit status.
  For counts, have the command print one line starting
  `acceptance-summary:`, such as `acceptance-summary: 272 of 273 passed`;
  Mahler records the last such line as it is. With no such line it records
  pass or fail and the duration only. Copy the verification record's "Tester
  results" from what the command printed. Never type a count from memory.
- **The implementation** is what the issue's `repos/<repo>` worktree has
  checked out, or `--branch <ref>`.

The merge goes one way only: the issue branch into the tester's branch, never
the reverse. The worktrees share one repository, so the issue branch is
already there without a fetch. Run again after each implementation change
you want to test. At high risk the implementer works this way from the
start: the tests fail first, and it makes them pass without touching them.

If the merge conflicts, the tester edited a file the implementation also
changed, and the command undoes the merge and stops. Don't resolve it by
changing a frozen file: have the tester move its tests into new files, and
freeze that commit with the reason.

With no command configured, run the suite by hand the same way (`git merge
--no-edit <issue branch>` in the tester's worktree, then the repo's test
command for the tester's files) and say in the verification record that the
run was not recorded.

## Promoting Acceptance Tests

A tester's suite proves one change met its spec. That is a short-term job,
and the suite is discarded once the change has merged. It was written without
seeing the code, so it tends to repeat the implementer's tests, bring its own
helpers, and grow far larger than the change. Promotion is the exception: a
few tests that earn a lasting place land as ordinary tests, in PRs of their
own.

**When:** after every frozen test passes on the final implementation and the
review findings are handled, before the issue's PRs are reported ready.
Promotion never hides a failing test: a test that fails is a fix or a
dispute, not a drop.

**Who:** the conductor. Choosing means reading the implementer's tests, and
independence has already done its job once the frozen suite passed unchanged.

**Drop** a test unless you can state one of these reasons to keep it:

- **It caught a real bug during the work.** Name the bug.
- **It guards a risk the workspace names** in
  `.harness/custom/acceptance-priorities.md`. Name the risk.
- **It covers a surface no other test reaches.** Name the surface, having
  looked for an existing test of it.

A reason is stated per test or per small group of tests that share it, never
for the suite as a whole. Even with a reason, drop a test when a stronger
test of the same thing already exists, or when it misses the tester's bar
(it tests below the outermost surface, restates the spec's shape, or hedges
against code the tester couldn't see). If that behavior matters and nothing
else covers it, write the direct test instead.

**Size budget:** the kept tests are no larger than the change's own tests,
counted in lines added. A larger keep needs the composer's approval (the
human's, when there is no composer), recorded in the verification record
with its reason. A composer does not accept "kept all" or "kept most" for a
large suite: it asks for the reason behind each kept test first.

Keeping nothing is a normal result and needs no explanation.

**How:**

1. Promoted tests never go into the feature's PRs. Put them on a test-only
   branch above the feature's top branch, and open a PR for it whose base is
   that top branch. Split a large keep into several test-only PRs, each on
   the one below.
2. Write each kept test into the repo's ordinary tests, beside the tests for
   the code it covers. Rewrite it against the real interface: the repo's
   shared test helpers instead of a private rig, a name that says the
   behavior, and no criterion numbers. Keep its inputs, tolerances and
   assertions. Tightening them is fine; loosening them is not.
3. The PR description lists each kept test or group with its reason, the
   size against the budget, and how many tests were dropped.
4. The reviewer checks the test-only PRs against the frozen originals in the
   tester's worktree. It confirms each kept test asserts at least what its
   original did, and that each has a stated reason that holds.
5. The feature merges first. The test-only PRs are not linked into the
   feature's stack, so the feature never waits on them. Once the feature has
   merged, in this order:
   1. Rebase the test branches onto the base branch. After a squash merge
      they still carry the feature's old commits, so use
      `git rebase --onto <base> <old feature top> <test branch>` (with
      `--update-refs` for several), then push and retarget the bottom test
      PR to the base branch.
   2. Only then link the test PRs as their own stack, when there are two or
      more (see the pr policy). A stack's bottom PR has to target the base
      branch, so linking before the rebase fails.
   3. Merge them under the merge policy, like any other PR.
6. The verification record gives the frozen commit, the count kept with the
   reasons, and the count dropped. No new freeze is needed: the tester's
   files haven't changed.

The tester's branch and worktree stay until the issue's PRs and its test-only
PRs merge, for disputes and review. `mahler cleanup <ISSUE>` then removes the
worktree and deletes the branch, printing its tip. The suite is not kept
after that; what was worth keeping is in the repo.

Project suites are not promoted. They stay in the acceptance repo for the
life of the project.

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

There is one record per issue. The conductor keeps it in the `## Verification`
section of `HANDOFF.md`, and the PR description carries it (for a stack, the
top PR's):

```md
- Risk: <level> (<source>; raised from <level> because <reason>, if raised)
- Implementer tests: <what they cover>; mahler check <status>
- Acceptance tests: frozen at <sha> (<n> files) | not required (low risk) | skipped (no criterion reachable from outside: <why>)
- Tester results: <the recorded run: pass or fail, its summary line, the commit it ran on>; <failures and how each was classified>
- Promoted: none (<n> dropped) | <k> of <n> tests in <test-only PRs>, <lines> lines against a budget of <lines> (<reason>: <count>, ...); over budget approved by <who>: <why> | not required
- Project suite: <pass | fail | none>
- Reviewer: <tier>; findings handled
- Proof: <what shows it working, and where: PR body, PR comment, Linear comment>
- Disputes: <none | decision>
- Rollout (high risk): <plan>
```

## Stacks

An issue that lands as a stack of PRs is verified once, as one change:

- One tester suite, run against the top branch of the stack.
- One review of the whole stack (base branch to top branch) by one reviewer,
  read PR by PR. Fixes go on the branch that owns the code, and the branches
  above it are rebased (`git rebase --update-refs` moves them together).
- One verification record and one proof, on the top PR. The PRs below link
  to it.

CI still runs on every PR, and each PR still has to stand on its own: the
tests pass at every branch in the stack, not only the top. When only the
lower part of a stack will merge (the merge policy routes an upper PR to the
human), say in the record which PRs it covers.

Slices in different repos are separate changes: each gets its own review and
PR, under the one record in `HANDOFF.md`.

## What CI Must Do

`mahler check` runs locally and is a Tier 1 control. The implementer's tests
land in the PR and the promoted acceptance tests land in their own, so the
repo's CI runs them on every later change. That makes CI the regression guardrail: each repo's CI
should run its full test suite on every PR. Name any gap in `guardrails`.

# Verification Policy

The human does not always review code. They own the project's acceptance criteria
and need to trust that what agents merge works. That trust comes from three
things: tests written by an agent that did not write the code, checks that
grow with risk, and a record of what was verified.

A tester's suite verifies one change, through the outermost surface the
criteria are stated against. It never joins the issue branch: it runs from
the tester's own worktree, and the tests that add lasting coverage are
promoted into the codebase (see "Promoting Acceptance Tests").

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
- Once they pass on the final implementation, the conductor promotes the ones
  worth keeping before opening the PR (see "Promoting Acceptance Tests").
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
in that worktree is missing or differs, committed or not. For a second tester
worktree, pass `--worktree tests/<dir>`. A range freeze counts only the
range's own commits, so base-branch changes made after the tester branched
are not frozen.

A freeze compares content, not history. Rebasing, restacking, or merging the
issue branch into the tester's worktree leaves the files alone, so none of
them needs a new freeze. Freeze again only when a dispute decision changes
the tests.

Only the tester changes frozen tests, and only after a dispute decision.

## Running the Tester's Suite

The suite runs in the tester's worktree, against the implementation, once the
tester has reported:

```sh
cd <issue root>/tests/<repo>
git merge --no-edit <issue branch>   # the top branch, for a stack
<the repo's test command for the tester's files>
```

The merge goes one way only: the issue branch into the tester's branch, never
the reverse. The worktrees share one repository, so the issue branch is
already there without a fetch. Merge again after each implementation change
you want to test. At high risk the implementer works this way from the
start: the tests fail first, and it makes them pass without touching them.

If the merge conflicts, the tester edited a file the implementation also
changed. Don't resolve it by changing a frozen file: have the tester move its
tests into new files, and freeze that commit with the reason.

## Promoting Acceptance Tests

A tester's suite proves one change met its spec. It is written to a bar (see
the acceptance-test skill) so that most of it is worth keeping, but it was
still written without seeing the code: a test may repeat one the implementer
wrote, bring its own helpers, or cite criterion numbers from a task file the
repo doesn't have. So the whole suite verifies the change, and the tests that
add lasting coverage land, as ordinary tests.

**When:** after every frozen test passes on the final implementation and the
review findings are handled, before the PR opens. Promotion never hides a
failing test: a test that fails is a fix or a dispute, not a drop.

**Who:** the conductor. Finding duplicates means reading the implementer's
tests, and independence has already done its job once the frozen suite passed
unchanged.

**Keep** a test unless a rule below drops it. **Drop** a test when:

- An existing test checks the same behavior at the same level. Keep the
  stronger of the two, or fold the extra cases into one.
- It misses the tester's bar: it tests below the outermost surface, restates
  the spec's shape (field lists, ordering, names, message wording), or
  hedges against code the tester couldn't see. If the behavior matters and
  nothing else covers it, write the direct test instead.

Never drop a test that caught a bug, or one that covers what
`.harness/custom/acceptance-priorities.md` names, unless a stronger test of
the same thing stays. Say in the PR which tests you dropped and under which
rule. If you are dropping most of the suite, the tester missed its bar: note
that in `HANDOFF.md` so an audit can see it.

**How:**

1. In one commit on the issue branch, write each kept test into the repo's
   ordinary tests, beside the tests for the code it covers. Rewrite it against
   the real interface: the repo's shared test helpers instead of a private
   rig, a name that says the behavior, and no criterion numbers. Keep its
   inputs, tolerances and assertions. Tightening them is fine; loosening them
   is not. For a stack, each test goes in the PR whose code it covers.
2. The reviewer re-reviews that commit against the frozen originals in the
   tester's worktree. It confirms each kept test asserts at least what its
   original did, and each drop fits a rule above.
3. The verification record gives the frozen commit, the count kept, and the
   count dropped under each rule. No new
   freeze is needed: the tester's files haven't changed, and the promoted
   tests are ordinary tests that CI runs from now on.

The tester's branch and worktree stay until the issue's PRs merge, for
disputes and review. `mahler cleanup <ISSUE>` then removes the worktree and
deletes the branch, printing its tip. The suite is not kept after that; what
was worth keeping is in the repo.

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
- Tester results: <n> pass; <failures and how each was classified>
- Promoted: <k> of <n> tests, to <paths>; dropped <d> (<rule>: <count>, ...) | not required
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
and the promoted acceptance tests land in the PR, so the repo's CI runs them
on every later change. That makes CI the regression guardrail: each repo's CI
should run its full test suite on every PR. Name any gap in `guardrails`.

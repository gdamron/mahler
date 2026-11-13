---
name: acceptance-test
description: Write acceptance tests from the spec alone, for one issue or for a project's criteria, without reading the implementation.
---

# Acceptance Test

The tester writes tests that say what "done" means, from the spec, before or
beside the implementation. Its value is independence: it never sees how the
code was written, so its tests can't share the implementer's blind spots. A
conductor launches it for medium- and high-risk issues; a composer launches it
in project mode (see the verification policy).

## Triggers

- a tester brief from a conductor or composer
- "write acceptance tests for this issue"
- "write the acceptance suite for this project"

## Required Policies

- judgment
- workspace-safety
- verification
- risk
- commit
- handoff

## Allowed Commands

- `git worktree add` for the tester worktree the brief names, cut from the
  base branch
- repo-local build and test commands inside that worktree
- `git status`, `git diff`, `git add`, `git commit` (via the commit skill)
- `git push` for the tester branch only, and only when step 6 says to
- `mahler decide --rule <rule> --description "<one line>" --reason "<why>" --issue <ISSUE> --agent <agent>`

## Expected Inputs

- The tester brief: mode (issue or project), the repo and worktree to write
  in, the branch, and when to write (before or after implementation)
- Issue mode: `TASK.md` (its acceptance criteria, non-goals, and protected
  areas) and the project's `CRITERIA.md` when there is one
- Project mode: `<acceptance.path>/projects/<slug>/CRITERIA.md` in the
  acceptance repo

## What You May Read

- The spec above, and public interfaces: types and signatures, API docs, CLI
  help, schemas, and existing test helpers.
- `.harness/custom/acceptance-priorities.md`, when the workspace has one.
- The code on the base branch, to learn how to drive the system.
- Not the implementation diff, the issue branch, or the implementer's tests.
  If the brief or a message shows you implementation details, say so in your
  report.

## The Bar

You can't see the implementer's tests, so a test at their level mostly repeats
one of them. Yours earn their place by testing where theirs don't reach.

- **Test through the outermost surface only:** the one the criteria are
  stated against. In order of preference: the running product (its CLI,
  server, rendered UI, or the whole system end to end); a library's public
  API, when the library itself is what the issue ships. Never a private
  function, an internal module, or the shape of a type. Unit tests are the
  implementer's job.
- **One test per criterion, plus its failure edge:** the test that fails if
  the behavior is missing, and one for its boundary or error case. Don't fan
  out over variants the criterion doesn't name. If a criterion needs more,
  say why in your report.
- **Behavior, not shape:** don't assert field lists, ordering, names, exports,
  or message wording, unless the criterion is itself a contract others
  consume.
- **No guessing:** if a test would need a guess about names or structure you
  can't see (matching by pattern, an "assumption" comment), don't write it.
  Report the criterion as not testable from outside, with what you would need
  to know.
- **Shared helpers only:** drive the system with the repo's existing test
  support. Needing a private rig usually means the test is at the wrong
  level.
- **The workspace's priorities:** if
  `.harness/custom/acceptance-priorities.md` exists, read it. It names what
  this workspace most wants acceptance tests to protect. Weight your tests
  toward it.

A criterion with no outer surface (an internal refactor, a change nothing
outside can observe) is not yours to test. List it under criteria you could
not test; the implementer's tests and the reviewer cover it. If no criterion
is reachable from outside, write nothing and report that.

## Process

1. Read the brief and the spec, and the workspace's acceptance priorities
   when the file exists. List the criteria you will test, each with its ID or
   a short quote and the surface you will test it through, and the ones with
   no outer surface.
2. If a criterion allows more than one reading, don't pick one silently.
   Write the test for the reading the spec most supports and flag it as a
   possible spec gap in your report.
3. Create the worktree the brief names (for example
   `<issue root>/tests/<repo>`, outside `repos/`) from the base branch, on
   the brief's branch.
4. Write tests to the bar above: observable behavior through the outermost
   surface. Put the criterion's ID or quote in each test's name or a comment.
   Follow the repo's test conventions and put the tests where its other tests
   live, or under `<path>/projects/<slug>/` in project mode. Add new files
   rather than editing existing ones, so the implementation can't conflict
   with them.
5. Run them. Before implementation, tests for new behavior should fail for
   the expected reason (missing feature, not a broken test). After
   implementation, report what passes and what fails; don't change a test to
   make it pass.
6. Commit with the commit skill. Don't merge the branch, freeze it, or open
   a PR. In issue mode nobody does: your branch is scratch work that never
   joins the issue branch. Your parent freezes your commit, runs the suite
   from your worktree, and promotes the tests worth keeping into the issue
   branch as ordinary tests (see the verification policy).
   - **Issue mode: don't push.** Your worktree shares its repository with the
     conductor's `repos/<repo>` worktree (`git rev-parse --git-common-dir`
     prints the same path in both), so `mahler acceptance freeze` finds your
     commit without a fetch.
   - **Push only when the commit can't be reached locally:** in project mode,
     where the suite lands in the acceptance repo through a PR, or when your
     worktree doesn't share the conductor's repository (you run in the cloud
     or on another machine). Say in your report that you pushed, and why.
7. Report back.

## Required Outputs

- Commits on the tester branch, holding only test files, pushed only when
  step 6 says to
- A table mapping each criterion to the tests that check it
- Any criterion that got more than a test and its failure edge, and why
- Criteria you could not test, and why
- Possible spec gaps, with the reading you chose
- Test results, and for any failure your view of whether the code, the test,
  or the spec is at fault
- Workflow deviations recorded in `HANDOFF.md`

## Disputes

If your parent sends you a dispute decision that says a test is wrong or a
criterion changed, fix only what the decision covers, commit (pushing only
when step 6 says to), and report the new commit so the parent can freeze again
with the decision as the reason. By then your worktree may hold a merge of
the issue branch, which your parent made to run the suite. Leave it there,
and still don't read the implementation.

## Stop Conditions

- the brief is missing, or names no repo, worktree, or branch
- the spec has no testable criteria, or none reachable from outside: report
  that instead of dropping to unit level
- writing a test would need changes outside test files
- you would need to read the implementation to continue
- the next step is merging, freezing, or opening a PR: report back instead

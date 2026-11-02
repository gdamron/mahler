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
- `git push` for the tester branch only
- `mahler decide --rule <rule> --reason "<why>" --issue <ISSUE> --agent <agent>`

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
- The code on the base branch, to learn how to drive the system.
- Not the implementation diff, the issue branch, or the implementer's tests.
  If the brief or a message shows you implementation details, say so in your
  report.

## Process

1. Read the brief and the spec. List the criteria you will test, each with
   its ID or a short quote.
2. If a criterion allows more than one reading, don't pick one silently.
   Write the test for the reading the spec most supports and flag it as a
   possible spec gap in your report.
3. Create the worktree the brief names (for example
   `<issue root>/repos/<repo>-tests`) from the base branch, on the brief's
   branch.
4. Write tests that check observable behavior: inputs, outputs, errors, and
   limits. Put the criterion's ID or quote in each test's name or a comment.
   Follow the repo's test conventions and put the tests where its other tests
   live, or under `<path>/projects/<slug>/` in project mode.
5. Run them. Before implementation, tests for new behavior should fail for
   the expected reason (missing feature, not a broken test). After
   implementation, report what passes and what fails; don't change a test to
   make it pass.
6. Commit with the commit skill and push the branch. Don't merge it, freeze
   it, or open a PR: your parent does that.
7. Report back.

## Required Outputs

- Commits on the tester branch, pushed, holding only test files
- A table mapping each criterion to the tests that check it
- Criteria you could not test, and why
- Possible spec gaps, with the reading you chose
- Test results, and for any failure your view of whether the code, the test,
  or the spec is at fault
- Workflow deviations recorded in `HANDOFF.md`

## Disputes

If your parent sends you a dispute decision that says a test is wrong or a
criterion changed, fix only what the decision covers, commit, push, and report
the new commit so the parent can freeze again with the decision as the reason.

## Stop Conditions

- the brief is missing, or names no repo, worktree, or branch
- the spec has no testable criteria
- writing a test would need changes outside test files
- you would need to read the implementation to continue
- the next step is merging, freezing, or opening a PR: report back instead

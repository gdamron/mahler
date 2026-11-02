---
name: pr
description: Prepare or open a pull request for committed issue-scoped work.
---

# PR

## Triggers

- "prepare a PR"
- "open a PR"
- "write the PR summary"

## Required Policies

- judgment
- workspace-safety
- pr
- handoff

## Allowed Commands

- git status and log commands
- `git push` for the issue or slice branch when it has not been pushed yet
- configured GitHub or forge command for PR creation when available; with
  GitHub, `gh pr create`, `gh pr edit`, and `gh pr comment`, using
  `--body-file` and `--attach` for images and video
- `gh stack link <pr> <pr> ...` and `gh stack view --json` for a stack
- Linear MCP to comment on the issue with the PR link and proof

## Expected Inputs

- Issue or slice branch with committed changes that have passed review
- Current `HANDOFF.md`
- The verification record from `HANDOFF.md`
- Proof the change works: command or test output, screenshots, or video
  saved under `.harness/tmp/proof/<ISSUE>/`
- For a stacked slice: the predecessor branch to target

## Process

1. Write the description to a file using the pr policy's structure: a short
   summary, the verification record, proof, and notes only when needed.
   Reference each image by its local path where it belongs.
2. Open the PR with `--body-file` and one `--attach` per image or video.
3. For a stack, open each PR against its predecessor's branch, then link them
   bottom to top with `gh stack link` (see the pr policy).
4. Comment on the Linear issue with the PR link and the same proof. Skip this
   for a local task.
5. Record the PR URL, and its stack if any, in `HANDOFF.md`.

## Required Outputs

- PR summary or created PR URL (one PR per slice branch; a stacked PR targets
  its predecessor's branch, says so in its description, and is linked into a
  GitHub stack when `gh stack` is installed)
- Proof attached or included, or the exact error if an attachment failed
- Tests run
- Updated `HANDOFF.md`

## Stop Conditions

- branch has uncommitted changes
- no remote is configured
- a review finding on the branch has no response yet (see the review policy)

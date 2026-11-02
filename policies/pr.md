# PR Policy

PR preparation is allowed only when the assigned role permits it.

Agents with permission to create pull requests can and should open pull requests
when code is ready for review. This is the natural conclusion of the implementation
process outlined in the `git-workflow` skill.

## Guidelines

Before preparing a PR:

- Confirm the branch corresponds to the issue or local task.
- Confirm `HANDOFF.md` is current.
- Gather the verification record (see the verification policy) and proof
  that the change works (below).
- Do not merge PRs yourself; merging follows the merge policy.

### PR size

A PR is one deliverable that can merge, and be reverted, on its own. Line
counts used to stand in for a human reviewer's attention. Agents now review
most PRs, but size still costs: reviewers miss more in a large diff, a large
PR is harder to revert cleanly, it collides with parallel work, and it widens
what the tester must cover.

- Split by deliverable, not by line count. A refactor and a feature are two
  PRs (see the commit policy).
- Past roughly 300 lines of non-test changes, the risk level is at least
  medium (see the risk policy). Look for a split before accepting that.
- When parts depend on each other, land them as a stack (below), which merges
  in one step.
- When the merge policy routes a PR to the human, smaller matters more:
  prefer the split.
- If a change keeps needing more PRs than planned, check its scope with
  whoever assigned it, not only split again.

### PR Title

The PR title should be concise and descriptive, summarizing the main change or
feature being introduced. If it is a bug fix, it is appropriate to include the
word "fix" in the title. In general, a title should sound like a title, not a
sentence.

### PR description

A description is required. Its readers are the agent deciding the merge, an
audit sampling merged work later, future agents tracing history, and the
human only when the merge policy routes the PR to them. All of them want the
facts quickly.

- **Summary:** one to three sentences on what changes for users or callers,
  and why.
- **Verification:** the verification record. For a local task, add its
  acceptance criteria and the reason for its risk level: `.harness/` may not
  be versioned, so the PR is the lasting record.
- **Proof:** evidence the change works (below).
- **Notes:** only what a reader would otherwise get wrong: a surprising
  decision, a known limit, a follow-up. Delete the section when empty.

Leave out file lists, a restatement of the diff, the story of how the work
went, and lists of what you didn't do unless a reader would assume you had.
Aim for under 150 words besides the verification record and proof. A PR
routed to the human may add one "What to look at" line naming the parts that
need their judgment.

If the repo has a PR template, use it, held to the same standard. If not, use
this structure:

```md
### Summary

<!-- One to three sentences: what changes, and why. -->

### Issue Tracking

[DEV-123](https://example.com/issues/123) | none (local task local-<slug>)

### Verification

<!-- The verification record (see the verification policy). -->

### Proof

<!-- Command or test output in a <details> block, screenshots, or video. -->

### Notes

<!-- Only what a reader would otherwise get wrong. Delete if empty. -->
```

### Proof of work

Show that the change works, not only that checks passed. Proof is required
at medium and high risk for any change with observable behavior, and
encouraged everywhere else. For a change with nothing observable (an
internal refactor), the relevant test output is the proof.

- **Text:** command output, a test run, an API response, or CLI output before
  and after. Put it in a collapsed `<details>` block with the command that
  produced it, trimmed to what shows the behavior.
- **Images and video:** a UI change needs a screenshot or a short recording.
  Save them under `.harness/tmp/proof/<ISSUE>/`, never in the branch, and
  attach them with `gh` (2.99 or later; `mahler doctor` checks):

  ```sh
  gh pr create --title "<title>" --body-file body.md --attach './after.png#Login error after the fix'
  gh pr edit <pr> --body-file body.md --attach ./after.png
  gh pr comment <pr> --body-file proof.md --attach ./before.png --attach ./after.png
  ```

  To place an image, reference its local path in the body
  (`![Login error after the fix](./after.png)`); `gh` uploads the file and
  rewrites the link. Attachments the body doesn't reference go at the end.
  For a video, put `![](./demo.mp4)` alone in its paragraph. `--attach` takes
  images and video only, repeats for several files, and needs push access.
- Don't say a file couldn't be attached without trying `--attach`. If it
  fails, give the exact error and attach what you can.
- **Linear:** once the PR is open, post the same proof as a comment on the
  Linear issue with the PR link, using Linear MCP (and its file upload tools
  for images). A comment is not an issue-tracker state change.

### Stacks

When an issue lands as dependent PRs (see the conduct skill), make them a
GitHub stack so they merge together in one step, with no retargeting or
rebasing between merges. This uses the `gh stack` extension
(`gh extension install github/gh-stack`; `mahler doctor` reports whether it is
installed).

1. Open each PR with this policy, its base set to its predecessor's branch
   (the bottom one targets the base branch). Each keeps its own description,
   verification record, and proof, and says where it sits in the stack.
2. Link them, bottom to top: `gh stack link <pr> <pr> ...`. Add `--base
   <branch>` when the base isn't the default branch. To add a PR on top of an
   existing stack: `gh stack link <stack-number> <pr>`. `gh stack view --json`
   shows the stack.
3. Don't use `gh stack init`, `add`, or `modify`: they expect every branch in
   one checkout, and `modify` is interactive.

Without the extension, the stacked PRs still target their predecessors, and
the merge policy merges them one at a time.

### Authorship

Ultimately, the human developer is the author of the code. The agent's role is
to assist the human in writing code. Do not add co-authorship statements to the
PR title or description. The human developer is the author.

### Comments

In general, you do not need to add comments to a PR. However, a reviewer may ask
you to read comments and address them in the code.

### Merging

Opening a PR does not grant merge authority. Only a composer merges, and only
under the merge policy (labels, paths, and readiness). Everyone else reports
the PR as ready with its verification record and waits.

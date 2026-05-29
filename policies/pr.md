# PR Policy

PR preparation is allowed only when the assigned role permits it.

Agents with permission to create pull requests can and should open pull requests
when code is ready for review. This is the natural conclusion of the implementation
process outlined in the `git-workflow` skill. A well crafted pull request is
essential for effective collaboration between agent and human developers.

## Guidelines

Before preparing a PR:

- Confirm the branch corresponds to the Linear issue.
- Confirm `HANDOFF.md` is current.
- Summarize user-visible behavior, implementation notes, and tests.
- Do not merge PRs unless the human explicitly asks.

### PR size

A PR should be as small as possible while still being a complete unit of work.
It is preferable to have multiple small PRs than one large PR. If a PR is too
large, consider breaking it down into smaller, more focused PRs.

### PR Title

The PR title should be concise and descriptive, summarizing the main change or
feature being introduced. If it is a bug fix, it is appropriate to include the
word "fix" in the title. In general, a title should sound like a title, not a
sentence.

### PR description

A description is required. It should provide a clear but concise explanation or
the changes. If a PR template is included, always use it. If not, use the following
structure:

```md
### Summary

<!-- A brief summary of the changes, ideally 1-2 sentences -->

### Issue Tracking

[DEV-123](https://example.com/issues/123)

### Screenshots

<!-- If applicable, include screenshots or gifs to illustrate the changes -->

### Notes

<!-- Any additional notes, such as implementation details, assumptions, or areas
for special review -->
```

### Authorship

Ultimately, the human developer is the author of the code. The agent's role is
to assist the human in writing code. Do not add co-authorship statements to the
PR title or description. The human developer is the author.

### Comments

In general, you do not need to add comments to a PR. However, a reviewer may ask
you to read comments and address them in the code.

### Merging

Do not merge yourself. Wait for a human reviewer to review and merge every PR.

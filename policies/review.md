# Review Policy

Review work focuses on correctness, regressions, missing tests, and workflow risk.

Review a local diff and report findings before creating a pull request. This
applies to review between agents and self-review. Always perform a local review
before opening a pull request. Second-agent review is optional (but encouraged)
unless requested; human sign-off is expected before merge.

When reviewing:

- Inspect the diff from the issue workspace.
- Prioritize concrete bugs and behavioral regressions.
- Cite file paths and lines when possible.
- Separate findings from optional style suggestions.
- Record review status in `HANDOFF.md`.
- Document skipped checks and reasons in `HANDOFF.md`.
- Be direct and respectful in feedback.
- Do not block progress unless there is a critical issue.

## Guidelines

### 1. Review scope

The review should encompass the entire diff, but it can be helpful to break it
down into smaller sections if the diff is large.

### 2. Review criteria

The review should assess the following criteria:

- Code quality: Is the code clean, well-structured, and maintainable?
- Functionality: Does the code work as intended and meet the requirements?
- Performance: Is the code efficient and performant?
- Security: Are there any security vulnerabilities or concerns?
- Style: Does the code adhere to the project's coding style and conventions?
- Tests: Are there sufficient tests, and do they cover the relevant cases?

### 3. Fix-it forward

The purpose of the review is to identify issues and areas for improvement, but
the main goal is to let work get done. For each issue identified, provide a
recommended fix or improvement if you have one. Don't be a gate keeper; instead,
facilitate progress.

### 4. Handling feedback

When you are the recipient of a review, address all feedback before opening a
pull request. It is completely valid to have multiple iterations of review and
improvement before a pull request is ready. While you should be receptive to all
feedback, you are not obligated to implement every suggestion. Use your judgment.

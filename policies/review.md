# Review Policy

Review work focuses on correctness, regressions, missing tests, and workflow risk.

Review a local diff and report findings before creating a pull request. This
applies to review between agents and self-review. Always perform a local review
before opening a pull request. A conductor self-reviews and sends every slice
to a reviewer sub-agent that did not write it; skipping that is a recorded
deviation. The delegate skill picks the reviewer's tier, which may route to a
cross-model review (a skill or a command, such as a Codex review); its
findings are translated into the format below.
Merging follows the merge policy: a composer may merge the PRs it allows, and
everything else waits for human sign-off.

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

When it helps the author weigh a finding, say who would hit it and how
(likely, rare, only with unusual access, or theoretical), and whether this diff
introduced it, exposed something that was already there, or came from an
earlier review round's fix. A severity label alone says how bad a problem would
be, not how likely anyone is to run into it.

If the review is adversarial (hunting for ways to break a stated rule), it
helps to have the threat model and the non-goals in the brief. Without them,
every path looks like an attack and the review never comes back clean.

### 4. Handling feedback

When you are the recipient of a review, findings are input to weigh, not orders.
Before opening a pull request, decide what to do with each finding that
matters; minor nits can be grouped or skipped without comment. Common
responses:

- **Fix** clear bugs and regressions users would notice, plus anything in the
  areas the workspace cares most about (its protected areas and risk notes).
  When several findings share a cause, fix the cause.
- **Acknowledge** a rare edge case as not covered, with the reasoning, in the
  PR or `HANDOFF.md`.
- **Set aside for triage** a finding that is real but outside this change. List
  it in `HANDOFF.md` so the human can decide what becomes new work.
- **Rebut** a finding you disagree with, saying why.

Multiple rounds are fine, but each one should earn its place. Stop when nothing
open is a clear bug or something users are likely to hit, not when the
reviewer runs out of things to say: a thorough reviewer rarely does. Rounds
after the first usually look only at the fix commits. If the same mechanism
keeps drawing serious findings round after round, that usually means the
design needs a rethink rather than another patch.

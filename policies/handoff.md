# Handoff Policy

Every agent session must leave a useful handoff.

At the start of a session, read the active `.harness/decisions/` ledger (not
`archive/`) to recover durable decisions and intent recorded by earlier
sessions — `HANDOFF.md` is per-issue and does not carry across issues.

When several agents work on one issue, the orchestrator owns `HANDOFF.md`;
implementers and reviewers report to it instead of editing the file. A
composer's cross-issue state lives in `.harness/projects/<slug>/COMPOSITION.md`.

Update `HANDOFF.md` with:

- status: phase, state, current owner or active agent, and blockers,
- phase: use a brief orientation value such as `brief-created`, `planning`,
  `implementing`, `self-review`, `agent-review`, `ready-to-commit`,
  `committed`, `ready-for-pr`, `pr-opened`, `waiting-human-signoff`, `done`, or
  `blocked`; this is guidance only, not a state machine,
- slices: each slice's branch, implementer, review round, and PR (when the
  issue has more than one),
- reviews: self-review, sub-agent review, and human review status,
- quality: relevant tests/checks, full test suite status, known risks, and any
  skipped checks with reasons,
- changed files,
- next steps,
- workflow deviations: record all of them in the table; for those whose reason
  generalizes beyond this issue, also add a `.harness/decisions/` ledger note and
  reference that note in the row (see `judgment` policy; `mahler decide`).

Default expectations:

- self-review before pull request,
- sub-agent review before pull request (see the review policy),
- human sign-off before merge,
- skipped checks must be documented with reasons.

If work is incomplete, say exactly where to resume.

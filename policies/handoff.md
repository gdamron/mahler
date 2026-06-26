# Handoff Policy

Every agent session must leave a useful handoff.

At the start of a session, read the active `.harness/decisions/` ledger (not
`archive/`) to recover durable decisions and intent recorded by earlier
sessions — `HANDOFF.md` is per-issue and does not carry across issues.

Update `HANDOFF.md` with:

- status: phase, state, current owner or active agent, and blockers,
- phase: use a brief orientation value such as `brief-created`, `planning`,
  `implementing`, `self-review`, `agent-review`, `ready-to-commit`,
  `committed`, `ready-for-pr`, `pr-opened`, `waiting-human-signoff`, `done`, or
  `blocked`; this is guidance only, not a state machine,
- reviews: self-review, optional second-agent review, and human review status,
- quality: relevant tests/checks, full test suite status, known risks, and any
  skipped checks with reasons,
- changed files,
- next steps,
- workflow deviations: record all of them in the table; for those whose reason
  generalizes beyond this issue, also add a `.harness/decisions/` ledger note and
  reference that note in the row (see `judgment` policy; `mahler decide`).

Default expectations:

- self-review before pull request,
- second-agent review is optional (but encouraged) unless requested,
- human sign-off before merge,
- skipped checks must be documented with reasons.

If work is incomplete, say exactly where to resume.

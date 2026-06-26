# Handoff Policy

Every agent session must leave a useful handoff.

At the start of a session, read the active `.harness/decisions/` ledger (not
`archive/`) to recover durable decisions and intent recorded by earlier
sessions — `HANDOFF.md` is per-issue and does not carry across issues.

Update `HANDOFF.md` with:

- current status,
- owner or active agent,
- changed files,
- tests/checks run,
- blockers,
- next steps,
- workflow deviations: record all of them here; for those whose reason
  generalizes beyond this issue, also add a `.harness/decisions/` ledger note and
  reference it (see `judgment` policy; `mahler decide`).

If work is incomplete, say exactly where to resume.

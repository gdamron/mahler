# Mahler Decisions Ledger

Append-only, cross-session record of **Tier-1 deviations** and the reasons behind
them (see `.harness/policies/judgment.md`). Agents relearn the project every
session and never read a prior issue's `HANDOFF.md`; this ledger is the durable
"experience" that carries intent forward.

## Convention

- One file per deviation: `<YYYY-MM-DD>-<slug>.md`.
- Frontmatter: `date`, `issue`, `agent`, `rule`. Body: the reason — what was
  decided, why it improves outcome/safety/efficiency, the risk, and any follow-up.
- Write entries with `mahler decide --rule <rule> --reason "<why>" --issue <ISSUE> --agent <agent>`.
- Reference each note from the issue's `HANDOFF.md` under "Workflow Deviations".

## Keep it lean

The ledger is read at the start of every session, so it must stay small enough to
be worth reading. Record a deviation here **only when its reason generalizes
beyond the issue that produced it** — a decision a future, unrelated session
should know. Purely issue-local judgment calls belong in `HANDOFF.md` only.

- **Append-only:** agents never edit, delete, or move entries.
- **Read the active ledger** (this directory, not `archive/`); filter by the
  `issue:` or `rule:` frontmatter when you only need a slice.
- **Humans curate.** Recurring decisions get promoted into a policy or
  `CLAUDE.md` rule; folded or stale notes move to `archive/`, which sessions do
  not read by default.

This is interim, designed to fold into a future Obsidian-based shared memory
store with no migration.

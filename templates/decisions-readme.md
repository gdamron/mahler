# Mahler Decisions Ledger

Append-only, cross-session record of **Tier-1 deviations** and the reasons behind
them (see `.harness/policies/judgment.md`). Agents relearn the project every
session and never read a prior issue's `HANDOFF.md`; this ledger is the durable
"experience" that carries intent forward.

## Convention

- One file per deviation: `<YYYY-MM-DD>-<slug>.md`. Mahler regenerates
  `INDEX.md` (one line per note) after each `mahler decide` and on install.
- Frontmatter: `date`, `issue`, `agent`, `rule`. Body: the reason — what was
  decided, why it improves outcome/safety/efficiency, the risk, and any follow-up.
- Write entries with `mahler decide --rule <rule> --reason "<why>" --issue <ISSUE> --agent <agent>`.
- Reference each note from the issue's `HANDOFF.md` under "Workflow Deviations".

## Keep it lean

Sessions read `INDEX.md` at start, so the ledger must stay small enough to be
worth reading. Record a deviation here **only when its reason generalizes
beyond the issue that produced it** — a decision a future, unrelated session
should know. Purely issue-local judgment calls belong in `HANDOFF.md` only, and
what you learned about the code or tools belongs in the knowledge store
(`mahler learn`).

- **Append-only:** agents never edit, delete, or move entries on their own;
  an audit moves notes to `archive/` only once the human approves.
- **Read `INDEX.md`**, and open the notes that bear on your work (`archive/`
  is not indexed).
- **Humans curate.** Recurring decisions get promoted into a policy or
  `CLAUDE.md` rule; folded or stale notes move to `archive/`, which sessions do
  not read by default. The `audit` skill prepares those proposals for the
  human (reports in `.harness/audits/`).

Knowledge lives separately, in the knowledge store (`.harness/knowledge/` by
default).

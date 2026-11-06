---
name: audit
description: Review the workspace's own workflow rules and records (the decisions ledger, the knowledge store, custom overlays, instruction files, and config) and propose what to archive, promote, update, or drop, for the human to approve.
---

# Audit

Local rules pile up. Ledger notes get folded into policies but stay active,
overlays drift from the Mahler defaults they replaced, and rules made for one
situation keep steering unrelated work. An audit keeps the set small and
consistent, so agents read less and follow rules that still mean something.
Removing a rule is usually a better result than adding one.

## Triggers

- "audit our policies", "review the decisions ledger", "clean up the rules"
- a project or large piece of work has wrapped up
- at session start, when the last audit is old (a month or so) or the active
  ledger has grown long (`mahler doctor` warns past 20 notes): suggest one to
  the human rather than starting it unasked

## Required Policies

- judgment

## Allowed Commands

- read files under `.harness/`, the workspace instruction files, and the
  Mahler package's own `policies/` and `skills/` (beside its `dist/`:
  `$(dirname "$(realpath "$(command -v mahler)")")/../..`)
- `mahler doctor --workspace <workspace>`
- `mahler knowledge search <terms>` (or `--paths <repo>/<file>`) to find
  duplicates and related notes
- forge PR inspection (`gh pr list`, `gh pr view`, `gh pr diff`) to sample
  merged work
- after the human approves:
  - `mahler knowledge import <ledger-note> --title "<claim>" --description
    "<sentences>" [--tags a,b] [--repos r] [--paths glob,glob] --archive` to
    turn a ledger note into knowledge and archive it
  - move other ledger notes to `.harness/decisions/archive/`
  - edit, merge, or retire knowledge notes, and `mahler knowledge verify
    <slug>` for ones you confirmed; then `mahler knowledge sync` once, to
    publish the hand edits when the store is a shared repo (with PR
    publish, that opens one PR for the audit's edits) and to back up the
    ledger's moves when it has a repo
  - edit `.harness/custom/` and the workspace instruction files, then
    `mahler install` to regenerate the native artifacts

## What to Look At

Use judgment about depth: a quick pass over a small workspace is fine.

- **Decisions ledger** (`.harness/decisions/`, not `archive/`). The ledger is
  for deviations from Mahler's rules; facts about the code, tools, or project
  belong in the knowledge store. Give each active note one outcome:
  - **Knowledge:** a fact about the world ("Y behaves like Z"), often a
    gotcha with its topic in the `rule` field. Import it, rewritten for
    readers outside the issue: a claim title, a description that carries the
    fact, and tags, repos, and paths. Check `mahler knowledge search` first;
    if a note already covers it, propose adding anything new to that note
    (and the issue to its `sources`), then archiving the ledger note.
  - **Policy or overlay change:** the norm was wrong for this workspace, or a
    recurring theme across notes is really a rule.
  - **Repo docs:** a design decision or rationale that belongs next to the code.
  - **Preference:** how this human wants work done; an overlay or
    instruction-file rule.
  - **Archive:** a one-off with nothing left to learn, a note already folded
    in elsewhere, or one a later note supersedes.
  - **Keep:** a precedent still worth showing sessions.
  Flag notes that contradict each other.
- **Knowledge store** (`knowledge.path` in config, default
  `.harness/knowledge/`; read its `INDEX.md` first):
  - duplicates to merge into one note
  - notes that contradict each other, or the code
  - notes whose repos no longer exist, or whose `paths` globs match no file
  - notes whose `verified:` date is old or missing in areas that change
    often: check them against the code, then verify, correct, or retire them
  - titles that name a topic instead of stating a claim, and descriptions too
    thin to act on
- **Overlays** (`.harness/custom/`): compare each overlay that replaces a
  Mahler default with the current default. Look for:
  - upstream changes the overlay is missing
  - overlays that no longer differ in substance
  - overlays that could be a short addition instead of a full replacement
- **Instruction files** (`CLAUDE.md` and `AGENTS.md`, outside the
  `<!-- HARNESS:START -->` … `<!-- HARNESS:END -->` block that install
  rewrites): rules that duplicate or conflict with policies or the ledger. If
  the human points you at runtime memory kept elsewhere, read it too, and
  propose changes there for them to make.
- **Config** (`.harness/config.json`): look for any of these that no longer
  fit how the team works:
  - guardrail and Definition of Done changes
  - model tiers (a tier routed to an external tool usually wants a
    `fallback`)
  - concurrency caps
  - merge labels, `merge.humanReviewPaths`, and risk labels
  - the acceptance suite settings
- **Merged work:** sample a few PRs agents merged since the last audit,
  weighted toward medium and high risk. For each, check that the
  verification record holds up: the risk level was fair, the tests check the
  criteria they claim, frozen tests stayed frozen, and no bug has turned up
  since. A pattern (say, migrations keep arriving as medium) becomes a
  proposal: a risk signal, a human-review path, or a policy change.
- **Disputes:** read the dispute decisions in `COMPOSITION.md` files and
  freeze histories. Repeated disputes about one kind of criterion usually
  mean issues are being written too loosely.

## Output

Group proposals by action, each with a one-line reason and the files
involved. Ledger notes use the outcomes above (knowledge, policy or overlay,
repo docs, preference, archive, keep); for a knowledge outcome, include the
proposed title, description, and scope so the human approves the note as it
will read. Other proposals group by archive, promote, update, drop, or keep. For a full audit, write them to
`.harness/audits/<YYYY-MM-DD>.md`; for a quick pass, the list in chat plus a
short dated note there is enough. Present the proposals to the human and ask
which to apply. Apply only those: the ledger stays append-only for agents, so moving a
note into `archive/` is the human's call. Record what was applied in the dated
file, so the next audit knows where this one left off.

## Stop Conditions

- the human hasn't approved a proposal: leave it in the report
- a proposal would change Mahler's own defaults rather than this workspace:
  note it in the report as feedback for Mahler instead

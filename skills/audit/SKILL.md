---
name: audit
description: Review the workspace's own workflow rules (the decisions ledger, custom overlays, instruction files, and config) and propose what to archive, promote, update, or drop, for the human to approve.
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
  ledger has grown long (a few dozen notes): suggest one to the human rather
  than starting it unasked

## Required Policies

- judgment

## Allowed Commands

- read files under `.harness/`, the workspace instruction files, and the
  Mahler package's own `policies/` and `skills/` (beside its `dist/`:
  `$(dirname "$(realpath "$(command -v mahler)")")/../..`)
- `mahler doctor --workspace <workspace>`
- after the human approves: move ledger notes to `.harness/decisions/archive/`,
  edit `.harness/custom/` and the workspace instruction files, then
  `mahler install` to regenerate the native artifacts

## What to Look At

Use judgment about depth: a quick pass over a small workspace is fine.

- **Decisions ledger** (`.harness/decisions/`, not `archive/`):
  - notes already folded into a policy, an overlay, or an instruction file
  - notes a later note supersedes
  - notes that contradict each other
  - recurring themes worth promoting into a policy overlay or instruction file
  - notes about work that has since finished
- **Overlays** (`.harness/custom/`): compare each overlay that replaces a
  Mahler default with the current default. Look for:
  - upstream changes the overlay is missing
  - overlays that no longer differ in substance
  - overlays that could be a short addition instead of a full replacement
- **Instruction files** (`CLAUDE.md`, `AGENTS.md` outside the Mahler block,
  and any runtime memory the workspace keeps): rules that duplicate or conflict
  with policies or the ledger.
- **Config** (`.harness/config.json`): look for any of these that no longer
  fit how the team works:
  - guardrail and Definition of Done changes
  - model tiers (a tier routed to an external tool usually wants a
    `fallback`)
  - concurrency caps
  - merge labels

## Output

Write a short report to `.harness/audits/<YYYY-MM-DD>.md`. Group proposals by
action (archive, promote, update, drop, keep), each with a one-line reason and
the files involved. Present the report to the human and ask which proposals to
apply. Apply only those: the ledger stays append-only for agents, so moving a
note into `archive/` is the human's call. Record what was applied at the end
of the report, so the next audit knows where this one left off.

## Stop Conditions

- the human hasn't approved a proposal: leave it in the report
- a proposal would change Mahler's own defaults rather than this workspace:
  note it in the report as feedback for Mahler instead

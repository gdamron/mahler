# Judgment Policy

Mahler provides workflow guidance, not exhaustive control. Human developers on
small teams follow soft process because experience and social friction fill the
gaps; agents have neither, so Mahler compensates with context and records — not
with blocks. If the workflow does not fit the task, deviate when doing so
improves outcome, safety, or efficiency.

Bounded freedom means:

1. Do not violate explicit human instructions.
2. Do not broaden task scope silently.
3. Record deviations where the next session will find them.
4. Ask the human when a deviation changes scope, ownership, or an outward action.

## The Three Tiers

Every workflow expectation in Mahler belongs to one of three tiers. The tier
determines what to do when you want to deviate.

### Tier 1 — Norms (deviate freely, record the reason)

Examples: using a skill outside the active profile's recommendation, commit
size, branch naming, scope judgment calls.

Deviation is allowed and reversible. Mahler never blocks these. The requirement
is the record:

1. Always write the reason in the `Workflow Deviations` section of the issue's
   `HANDOFF.md` — what you decided, why, the risk, and any follow-up.
2. *Only when the reason generalizes beyond this issue* — a decision a future,
   unrelated session should know — also append it to the cross-session ledger
   with `mahler decide --rule <rule> --reason "<why>" --issue <ISSUE> --agent
   <agent>` (writes `.harness/decisions/<date>-<slug>.md`).

Keep the ledger lean. `HANDOFF.md` is per-issue and a later session never reads a
*prior* issue's handoff, so the ledger exists to carry forward only the durable
reasons worth re-reading every session. A purely issue-local judgment call stays
in `HANDOFF.md` only — recording it in the ledger turns the ledger into noise the
next session must wade through.

At the start of a session, read the active ledger in `.harness/decisions/` (not
`archive/`) to recover earlier intent; filter by the `issue:` or `rule:`
frontmatter when you only need a slice. The ledger is **append-only**: never
edit, delete, or move entries. Humans curate — promoting recurring decisions into
a policy or `CLAUDE.md` rule and moving folded or stale notes to
`.harness/decisions/archive/` (which sessions do not read by default). An
unrecorded deviation is a workflow failure; a recorded one is a review input.

### Tier 2 — Confirm (get explicit human go-ahead first)

Examples: `git push`, opening a PR, a review-only profile reaching for commit.

These actions are outward-facing or hard to reverse. A human developer would
feel friction before doing them out of role; you do not, so manufacture the
pause: stop and get explicit human confirmation for the specific action before
proceeding. Mahler does not enforce this in code — the norm is the gate.

### Tier 3 — Hard guardrails (declared by Mahler, enforced elsewhere)

Examples: merging to a base branch, required CI checks.

Mahler declares these in the workspace config (`guardrails` in
`.harness/config.json`) and in issue briefs so you can anticipate them. The
actual enforcement lives in the forge and CI — do not attempt to bypass it, and
do not waste a PR cycle discovering it: run the checks CI will run before
declaring work ready.

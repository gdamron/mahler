---
name: delegate
description: Decide whether to delegate, which agent to use, and which model tier to launch it on — balancing output quality against token cost and machine load. Use before launching any sub-agent.
---

# Delegate

Every sub-agent costs a fresh context: it re-reads its brief, the workspace
instructions, and the policies its skill names before doing any work. Spend
that cost only where it buys something. Run this skill before each launch.

## Required Policies

- judgment
- sub-agent-delegation

## Allowed Commands

- `mahler capacity --workspace <workspace>`
- `mahler decide --rule <rule> --reason "<why>" --issue <ISSUE> --agent <agent>`
- runtime-native sub-agent launch, skill invocation, and agent messaging

## 1. Delegate or do it yourself?

Delegate when at least one holds:

- **Parallelism:** independent work that can run at the same time.
- **Context protection:** wide searches, long logs, or big diffs you need the
  conclusion of, not the contents.
- **Cheaper tier:** a lower tier can do the work as well as you.
- **Independence:** review must come from an agent that did not write the code.

Do it yourself when the work is small, when the brief would be longer than the
work, when you would have to re-explain context you already hold, or when the
result needs your own judgment anyway. Tweaking a PR description, rerunning a
check, or a one-file fix almost never earns a sub-agent.

## 2. Pick the agent

| Need | Agent |
|---|---|
| One issue, from a composer | `conductor`, issue mode |
| One slice, from a conductor | `conductor`, slice mode |
| Review of a finished diff | `reviewer` |
| Read-only lookup or codebase search | the runtime's built-in explore agent, or an ad hoc read-only brief |

## 3. Pick the tier

`.harness/MODELS.md` lists this install's tiers: the model and effort each
runtime uses, each profile's default and allowed tiers, and the Claude agent to
launch for each. Read it before choosing. The default tiers, from lightest to
heaviest:

| Tier | Use for |
|---|---|
| `trivial` | lookups, search, summarizing logs, fully specified mechanical edits (renames, formatting) |
| `light` | well-specified implementation that follows existing patterns, routine review, fixing accepted findings |
| `standard` | work that needs judgment: design choices inside one repo, moderate ambiguity, debugging with a likely cause |
| `deep` | underspecified work, cross-repo interfaces, security, concurrency, data migrations, unknown-cause debugging, review of high-risk PRs |

An install may add tiers (such as a cross-model review); `MODELS.md` shows them.

`inherit` is a reserved tier: the sub-agent runs on your own model and effort.
Profiles a human may talk to directly (`composer`, `conductor`) default to it,
so a session keeps the model the human chose. When you launch one of them as a
sub-agent, name a tier anyway: leaving it at `inherit` silently copies your
model, which is usually more than the work needs.

Effort and model trade differently. Raise **effort** on a mid-size model when
the work is clear but must be careful and thorough. Choose the **larger model**
at moderate effort when the work needs judgment: design choices, ambiguity, or
reading intent from sparse context.

Rules of thumb:

- Start at `light` for well-specified work and `standard` when it needs
  judgment; drop to `trivial` only when the work is plainly mechanical, and go
  to `deep` only for the signals above. The reviewer defaults to `light`.
- Escalate one tier after a failed attempt, after a second review round with
  substantive (non-style) findings, or when the sub-agent reports the task is
  ambiguous. Say why in the brief.
- Review a high-risk diff (merge policy) at `deep` or with a cross-model tier.
  Otherwise the reviewer's tier need not match the author's.
- A tier outside the profile's `allowed` list is a Tier 1 deviation: record
  the reason in `HANDOFF.md`. In Claude it has no generated definition; the
  closest you can get is a model-alias override, which keeps the default
  tier's effort.

## 4. Launch it

Find the chosen tier for your runtime in `.harness/MODELS.md`:

- `model` / `effort`: launch the agent `MODELS.md` lists for the tier and
  your runtime. The default tier is the profile's own agent (`conductor`);
  each other allowed tier has a generated definition named `<profile>-<tier>`
  (`conductor-standard`, `reviewer-deep`) that pins its model and effort.
  Pass no model or effort overrides: Claude's agent tool can't set effort at
  launch, and Codex applies the agent's own settings over spawn values, so an
  override either fakes the tier or is ignored.
- `skill`: invoke that skill instead of launching a Mahler sub-agent (for
  example `codex:review` for a cross-model review). Pass the brief's
  objective, base branch, and scope as its arguments or focus text, then
  translate its output into the format the brief expects — for review, the
  review policy's findings — before acting on it.
- `agent`: launch that runtime agent type instead of the Mahler profile, with
  the same brief plus any `model` / `effort` the entry sets.

## 5. Respect capacity

Run `mahler capacity` before launching agents in parallel or starting a full
test suite, build, or `mahler check`:

- `busy`: launch nothing new. Finish or wait on running work, and prefer
  focused tests over full suites.
- `ok`: stay within `concurrency` in `.harness/config.json` —
  `maxIssueAgents` conductors per composer, `maxSliceAgents` slice conductors
  per conductor, and `maxHeavyCommands` heavy commands at once across your
  agents. Sub-agents ask their parent before starting another heavy command.

Raising a cap for a run is a Tier 1 deviation: record why.

## 6. Keep the brief cheap

- Link files and sections; do not paste their contents.
- Name the policies the sub-agent must read; a slice conductor reads only the
  slice-mode set in the conduct skill.
- Ask for compact output: the change summary, findings, or answer — never a
  transcript.
- Reuse a sub-agent that already holds the context: send a reviewer the fix
  commits to re-review (Claude: message the same agent) instead of launching a
  new one.
- Fill the brief's `Agent and tier` field with the tier and a one-line reason.

## Required Outputs

- A decision to delegate or not; when delegating, a brief with agent, tier,
  and reason
- Deviations from the profile's allowed tiers or the concurrency caps recorded
  in `HANDOFF.md` (or `COMPOSITION.md` for a composer)

## Stop Conditions

- `mahler capacity` reports `busy` and the work cannot wait: ask your parent
- the task needs a tier or authority your parent has not allowed

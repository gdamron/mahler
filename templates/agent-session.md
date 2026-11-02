# Agent Session

- Issue: {{identifier}}
- Agent: {{agent}}
{{profileLines}}- Recommended worktree root: {{worktreeRoot}}

## Configured Repos

{{repos}}

## Guardrails (enforced outside Mahler — anticipate them)

{{guardrails}}

## Risk and Verification

{{risk}}

## Merge

{{merge}}

## Relevant Knowledge

{{knowledge}}

## Definition of Done

{{definitionOfDone}}

## Rules

- Create worktrees only for repos needed by this task.
- Prefer project-local worktrees under the recommended worktree root.
- Choose short-lived branch names using `.harness/policies/branching.md`.
- Do not edit the product workspace root.
- Follow the native installed skills for this agent and policies in `.harness/policies/`.
- If delegating to sub-agents, use `.harness/policies/sub-agent-delegation.md`; prefer configured roles, specialize as needed, and keep authority read-only unless edit scope is explicit.
- At session start, read Relevant Knowledge above and `.harness/decisions/INDEX.md`; open the notes that bear on your work.
- Record what you learn about the code, tools, or project with `mahler learn` (see `.harness/policies/knowledge.md`); update a note rather than adding a near-duplicate.
- Record deliberate workflow deviations in `HANDOFF.md`; only when the reason generalizes beyond this issue, also append a note with `mahler decide` to `.harness/decisions/`.
- Update `HANDOFF.md` before stopping.

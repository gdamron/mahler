# Mahler Workflow

This workspace uses Mahler for multi-agent development. An **orchestrator agent** coordinates the work; the **human developer** stays the final accountable authority.

## What To Do When Prompted

- If asked to "work on FUG-123", run the Mahler issue workflow for that issue brief.
- If asked to "work on project X in Linear", use Linear MCP to inspect the project, select one eligible issue, then create the issue brief.
- Do not edit code in the product workspace root.
- Do not edit sibling issue workspaces.
- Before changing code, read the generated issue brief files: `TASK.md`, `AGENT_SESSION.md`, and `HANDOFF.md`.
- Create git worktrees only for repos needed by the task.
- Prefer project-local worktrees under `workspaces/issues/<ISSUE>/repos/<repo>`.
- Choose branch names using `.harness/policies/branching.md`; Mahler does not choose branch names for you.
- At session start, read the active `.harness/decisions/` ledger (not `archive/`) to recover durable decisions from earlier sessions.
- If delegating to sub-agents, use `.harness/policies/sub-agent-delegation.md`; default sub-agent authority is read-only unless the brief explicitly grants edit scope.
- Record deliberate workflow deviations in `HANDOFF.md`; only when the reason generalizes beyond this issue, also append a note with `mahler decide` to `.harness/decisions/`.
- Before stopping, update `HANDOFF.md` with changed files, tests run, blockers, and next steps.

## Atomic Unit

Linear issues are the atomic unit for code changes, commits, and PRs. Project prompts are issue-selection prompts.

## Linear Selection Rules

For project prompts, select the highest-priority issue that:

- is open and unblocked,
- is not already active in a workspace,
- is assigned to an accepted configured agent user,
- has all required configured labels.

Tie-break by priority first, then oldest update/create timestamp.

## Roles

- **Human developer** — the final accountable authority for quality, integration, merge, and release. Owns final review and merge decisions unless a prompt explicitly delegates a narrower action. The human is not modeled as an agent.
- **Orchestrator agent** — the default coordinating role and the primary interface to the human developer: it surfaces risks to the human, reports synthesis, and asks for direction. It plans agent-level work, delegates scoped slices to sub-agents, coordinates sub-agents, synthesizes their outputs, and runs quality checks within the bounds of the delegated work. It is empowered to take any action directly when delegation is not warranted, pausing at Tier 2 boundaries for human go-ahead.
- **Sub-agents** — scoped specialist agents launched and delegated by the orchestrator for a specific slice of the task. Delegation uses native/runtime agent capabilities and the brief template in `.harness/policies/sub-agent-delegation.md`, not Mahler CLI commands.

Tier 2 actions and Tier 3 guardrails (base-branch merge, CI) still apply: the orchestrator pauses for human go-ahead and never bypasses the forge.

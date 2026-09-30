# Mahler Workflow

This workspace uses Mahler for multi-agent development. A **composer agent** coordinates **orchestrator agents**, each of which owns one issue; the **human developer** stays the final accountable authority.

## What To Do When Prompted

- If asked to "work on FUG-123", run the Mahler issue workflow for that issue brief.
- If asked to "work on project X in Linear", use Linear MCP to inspect the project. A composer plans across all eligible issues and dispatches one orchestrator per issue; any other role selects one eligible issue, then creates the issue brief.
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

- **Human developer** — the final accountable authority for quality, integration, merge, and release. Owns final review and merge decisions for high-risk work and anything labeled for human review; low-risk merges are delegated to the composer under `.harness/policies/merge.md`. The human is not modeled as an agent.
- **Composer agent** — the default role and the primary interface to the human for multi-issue work. It plans a project or set of issues in `.harness/projects/<slug>/COMPOSITION.md`, dispatches one orchestrator per issue, answers their escalations (including Tier 2 go-ahead), merges PRs the merge policy allows, synthesizes results, and surfaces risks.
- **Orchestrator agent** — owns one issue, tasked by a composer or directly by the human. It sets the issue up, delegates each slice to an implementer, routes finished slices through a reviewer, iterates on findings, opens the PRs, and reports a merge assessment for each; it does not merge. It owns the issue's `HANDOFF.md` and pauses at Tier 2 boundaries for its parent's go-ahead.
- **Implementer / reviewer sub-agents** — scoped specialists launched by an orchestrator. Implementers edit, commit, and push their slice branch; reviewers are read-only. Delegation uses native/runtime agent capabilities and the brief template in `.harness/policies/sub-agent-delegation.md`, not Mahler CLI commands.
- **Full-stack agent** — the lowest-level agent a human tasks directly; it runs the whole issue loop itself without orchestrating.

Every agent is empowered to take any action directly when delegation is not warranted. Tier 2 actions and Tier 3 guardrails still apply: agents pause for go-ahead from their parent (ultimately the human) and never bypass the forge.

# Mahler Workflow

This workspace uses Mahler for multi-agent development. A **composer agent** coordinates **conductor agents**, each of which owns one issue; the **human developer** stays the final accountable authority.

## What To Do When Prompted

- If asked to "work on FUG-123", run the Mahler issue workflow for that issue brief.
- If asked to "work on project X in Linear", use Linear MCP to inspect the project. A composer plans across all eligible issues and dispatches one conductor per issue; any other role selects one eligible issue, then creates the issue brief.
- Do not edit code in the product workspace root.
- Do not edit sibling issue workspaces.
- Before changing code, read the generated issue brief files: `TASK.md`, `AGENT_SESSION.md`, and `HANDOFF.md`.
- Create git worktrees only for repos needed by the task.
- Prefer project-local worktrees under `workspaces/issues/<ISSUE>/repos/<repo>`.
- Choose branch names using `.harness/policies/branching.md`; Mahler does not choose branch names for you.
- At session start, read the active `.harness/decisions/` ledger (not `archive/`) to recover durable decisions from earlier sessions.
- Before delegating, use the `delegate` skill to decide whether a sub-agent is worth its context cost and which model tier to launch it on; briefs follow `.harness/policies/sub-agent-delegation.md`, and default sub-agent authority is read-only unless the brief explicitly grants edit scope.
- Before launching agents in parallel or running full test suites and builds, run `mahler capacity` and stay within the `concurrency` caps in `.harness/config.json`.
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

- **Human developer** — the final accountable authority for quality, integration, merge, and release. Owns final review and merge decisions for high-risk work and anything labeled for human review; other merges are delegated to the composer under `.harness/policies/merge.md`. The human is not modeled as an agent.
- **Composer agent** — the default role and the primary interface to the human for multi-issue work. It plans a project or set of issues in `.harness/projects/<slug>/COMPOSITION.md`, dispatches one conductor per issue, answers their escalations (including Tier 2 go-ahead), merges PRs the merge policy allows, synthesizes results, and surfaces risks.
- **Conductor agent** — owns one issue, tasked by a composer or directly by the human. It sets the issue up and does the work itself by default; when the issue spans repos, splits into parallel parts, or is too large for one PR, it delegates slices to other conductors in **slice mode**, which edit, commit, and push only their slice. It routes the diff through a reviewer, iterates on findings, opens the PRs, and reports a merge assessment for each; it does not merge. It owns the issue's `HANDOFF.md` and pauses at Tier 2 boundaries for its parent's go-ahead.
- **Reviewer sub-agent** — read-only review of a finished diff by an agent that did not write it. Delegation uses native/runtime agent capabilities and the brief template in `.harness/policies/sub-agent-delegation.md`, not Mahler CLI commands.

Each sub-agent launches on a model tier listed in `.harness/MODELS.md`: a model and effort per runtime, or a hand-off to another skill or agent (such as a cross-model review). Profiles default to a tier; parents pick another per launch with the `delegate` skill by launching the generated `<profile>-<tier>` agent (such as `conductor-deep`).

Every agent is empowered to take any action directly when delegation is not warranted. Tier 2 actions and Tier 3 guardrails still apply: agents pause for go-ahead from their parent (ultimately the human) and never bypass the forge.

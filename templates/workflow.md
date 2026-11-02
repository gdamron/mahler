# Mahler Workflow

This workspace uses Mahler for multi-agent development. A **composer agent** coordinates **conductor agents**, each of which owns one issue; the **human developer** stays the final accountable authority.

## What To Do When Prompted

- If asked to "work on DEV-123", run the Mahler issue workflow for that issue brief.
- If asked to "work on project X in Linear", use Linear MCP to inspect the project. A composer plans across all eligible issues and dispatches one conductor per issue; any other role selects one eligible issue, then creates the issue brief.
- If the human describes work in conversation instead, agree on acceptance criteria and a risk level, write a local task with `mahler task <slug>`, and run the same workflow for `local-<slug>` once the human says go. No Linear issue is needed.
- Confirm the work's risk level before starting, and complete the verification it calls for (`.harness/policies/risk.md`, `.harness/policies/verification.md`).
- Do not edit code in the product workspace root.
- Do not edit sibling issue workspaces.
- Before changing code, read the generated issue brief files: `TASK.md`, `AGENT_SESSION.md`, and `HANDOFF.md`.
- Create git worktrees only for repos needed by the task.
- Prefer project-local worktrees under `workspaces/issues/<ISSUE>/repos/<repo>`.
- Choose branch names using `.harness/policies/branching.md`; Mahler does not choose branch names for you.
- At session start, read the brief's `Relevant Knowledge` and `.harness/decisions/INDEX.md`, and open the notes that bear on your work. After planning, run `mahler knowledge search --changed` (see `.harness/policies/knowledge.md`).
- Record what you learn about the code, tools, or project with `mahler learn`; update an existing note rather than adding a near-duplicate.
- Before delegating, use the `delegate` skill to decide whether a sub-agent is worth its context cost and which model tier to launch it on; briefs follow `.harness/policies/sub-agent-delegation.md`, and default sub-agent authority is read-only unless the brief explicitly grants edit scope.
- Before launching agents in parallel or running full test suites and builds, run `mahler capacity` and stay within the `concurrency` caps in `.harness/config.json`.
- Record deliberate workflow deviations in `HANDOFF.md`; only when the reason generalizes beyond this issue, also append a note with `mahler decide` to `.harness/decisions/`.
- Before stopping, update `HANDOFF.md` with changed files, tests run, blockers, and next steps.

## Atomic Unit

An issue is the atomic unit for code changes, commits, and PRs: a Linear issue, or a local task (`local-<slug>`) agreed in conversation. Project prompts are issue-selection prompts.

## Linear Selection Rules

For project prompts, select the highest-priority issue that:

- is open and unblocked,
- is not already active in a workspace,
- is assigned to an accepted configured agent user,
- has all required configured labels.

Tie-break by priority first, then oldest update/create timestamp.

## Roles

- **Human developer** — the final accountable authority for quality, integration, merge, and release. Writes project-level acceptance criteria and owns final review and merge decisions for anything labeled for human review or changing a human-review path; other merges are delegated to the composer under `.harness/policies/merge.md`, after verification scaled to risk. The human is not modeled as an agent.
- **Composer agent** — the default role and the primary interface to the human for multi-issue work. It plans a project or set of issues in `.harness/projects/<slug>/COMPOSITION.md`, writes issues with risk levels and testable criteria, sets up the project's acceptance suite, dispatches one conductor per issue, answers their escalations (including Tier 2 go-ahead and disputes over frozen tests), merges PRs the merge policy allows, synthesizes results, and surfaces risks.
- **Conductor agent** — owns one issue, tasked by a composer or directly by the human. It sets the issue up and does the work itself by default; when the issue spans repos, splits into parallel parts, or is too large for one PR, it delegates slices to other conductors in **slice mode**, which edit, commit, and push only their slice. It routes the diff through a reviewer (and a tester at medium or high risk), iterates on findings, opens the PRs, and reports a verification record for each; it does not merge. It owns the issue's `HANDOFF.md` and pauses at Tier 2 boundaries for its parent's go-ahead.
- **Tester sub-agent** — writes acceptance tests from the spec without reading the implementation: after implementation at medium risk, before it at high risk, and for a project's criteria. Its tests are frozen, and `mahler check` fails if anyone else changes them.
- **Reviewer sub-agent** — read-only review of a finished diff by an agent that did not write it. Delegation uses native/runtime agent capabilities and the brief template in `.harness/policies/sub-agent-delegation.md`, not Mahler CLI commands.

Each sub-agent launches on a model tier listed in `.harness/MODELS.md`: a model and effort per runtime, or a hand-off to another skill, agent type, or shell command (such as a cross-model review). Profiles default to a tier; parents pick another per launch with the `delegate` skill by launching the generated `<profile>-<tier>` agent (such as `conductor-deep`).

Every agent is empowered to take any action directly when delegation is not warranted. Tier 2 actions and Tier 3 guardrails still apply: agents pause for go-ahead from their parent (ultimately the human) and never bypass the forge.

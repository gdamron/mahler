---
name: compose
description: Plan a Linear project or set of issues, dispatch one orchestrator per issue, and synthesize their results for the human.
---

# Compose

The composer is the human's primary interface for multi-issue work. It plans,
dispatches orchestrators, answers their escalations, and reports synthesis. It
does not write code; each issue's work belongs to that issue's orchestrator.

## Triggers

- "work on project X in Linear" (when the active profile is `composer`)
- "work on MAH-1, MAH-2, and MAH-3"
- "run the backlog for project X"

## Required Policies

- judgment
- issue-selection
- interview
- sub-agent-delegation
- workspace-safety
- handoff

## Allowed Commands

- `mahler linear-template project`
- `mahler decide --rule <rule> --reason "<why>" --issue <ISSUE> --agent <agent>`
- Linear MCP project and issue lookup
- runtime-native agent launch for orchestrators (sub-agents, agent teams, or
  headless sessions such as `claude -p` / `codex exec`)
- read-only git, status, and diff commands across issue workspaces

## Expected Inputs

- A Linear project name or ID, an explicit list of issue identifiers, or a
  human goal to decompose into issues
- The active `.harness/decisions/` ledger (not `archive/`)

## Process

1. **Resolve scope.** For a project, use Linear MCP `get_project` and
   `list_issues`, then apply the eligibility rules in the issue-selection
   policy. For an explicit list, use `get_issue` for each; named issues are in
   scope as named, but stop and ask if one is blocked or already active.
2. **Plan.** Write `.harness/projects/<slug>/COMPOSITION.md` from the template
   below (`<slug>` is the project slug, or a short name for an ad hoc list).
   Order issues by blockers, then priority, then oldest update/create
   timestamp, and group them into waves: an issue joins a wave only when its
   blockers are done or can be stacked on an open PR. Issues likely to touch the
   same files go in different waves.
3. **Specify.** When an issue is underspecified, or issues share an interface,
   add a section under `Specifications` in `COMPOSITION.md` (clarified
   acceptance criteria, contracts between issues, non-goals) and point the
   orchestrator brief at it. Use the interview skill with the human when the
   plan has open questions that change scope.
4. **Dispatch.** For each issue in the current wave, up to the concurrency cap
   (default 3; adjust by judgment and record why), launch an orchestrator with
   a sub-agent brief: base profile `orchestrator`, authority `edit`, objective
   "carry `<ISSUE>` through the orchestrate skill to open, reviewed PRs",
   context link to its `Specifications` section, results destination the
   issue's `HANDOFF.md` plus a reply to the composer. Exactly one orchestrator
   owns an issue at a time.
5. **Choose an execution mode** and record it in `COMPOSITION.md`. Prefer
   orchestrators that can launch their own sub-agents. If the runtime cannot
   nest agents that deep:
   - launch orchestrators as independent top-level sessions (e.g. headless
     `claude -p` or `codex exec` in the product workspace) and monitor them
     through their `HANDOFF.md`, or
   - act as the orchestrator for each issue yourself: follow the orchestrate
     skill per issue, launching implementers and reviewers directly and keeping
     each issue's state in its own `HANDOFF.md`.
6. **Monitor.** Track each orchestrator through its replies and
   `.harness/issues/<ISSUE>/HANDOFF.md`. Answer escalations:
   - Tier 2 requests from orchestrators: the composer may approve or deny them
     (see the judgment policy); log each approval in `COMPOSITION.md`.
   - Scope changes that affect other issues or the project goal, conflicts
     between orchestrators, or an orchestrator blocked twice on the same
     problem: escalate to the human.
7. **Advance waves.** When an issue reaches open, reviewed PRs, update its row
   and decide whether dependents can stack on its branch or must wait for the
   human to merge. Revise the plan when results change its assumptions.
8. **Synthesize.** Report to the human: per-issue status and PR links, risks,
   decisions needed, and what the next wave will do. Keep `COMPOSITION.md`
   current so a later session can resume from it.

## COMPOSITION.md Template

```md
# Composition: <project or goal>

- Composer: <agent>
- Source: <Linear project URL or issue list>
- Execution mode: nested sub-agents | separate sessions | composer-as-orchestrator
- Concurrency cap: 3

## Goal

<!-- The outcome the human asked for, in one or two sentences. -->

## Plan

| Wave | Issue | Title | Depends on | Repos | Orchestrator | Status | PRs |
|---|---|---|---|---|---|---|---|

## Specifications

### <ISSUE>

- Clarified acceptance criteria:
- Interfaces with other issues:
- Non-goals:

## Approvals and Decisions

| Decision | Approved by | Reason |
|---|---|---|

## Risks

-

## Next Steps

-
```

## Required Outputs

- A current `COMPOSITION.md` under `.harness/projects/<slug>/`
- One orchestrator brief per dispatched issue
- A synthesis report to the human
- Workflow deviations recorded in the affected issue's `HANDOFF.md`, or in
  `COMPOSITION.md` when they span issues; a ledger note only when the reason
  generalizes

## Stop Conditions

- Linear MCP is unavailable or project/issue metadata is incomplete
- no eligible issues remain
- the next step crosses a Tier 3 boundary (merge to a base branch, bypassing
  required CI): pause for the human
- the plan requires scope beyond the requested project or issue set
- orchestrators conflict over the same code and cannot be serialized without a
  human decision

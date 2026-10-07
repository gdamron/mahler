---
name: compose
description: Plan a Linear project or set of issues, dispatch one conductor per issue, and synthesize their results for the human.
---

# Compose

The composer is the human's primary interface for multi-issue work. It plans,
dispatches conductors, answers their escalations, and reports synthesis. It
does not write code; each issue's work belongs to that issue's conductor. Handed
a single issue, the composer skips this skill and follows the conduct skill
itself: one issue never needs a composer layer.

## Triggers

- "work on project X in Linear" (when the active profile is `composer`)
- "work on MAH-1, MAH-2, and MAH-3"
- "run the backlog for project X"

## Required Policies

- judgment
- issue-selection
- interview
- sub-agent-delegation
- merge
- workspace-safety
- handoff

## Allowed Commands

- `mahler linear-template project`
- `mahler decide --rule <rule> --reason "<why>" --issue <ISSUE> --agent <agent>`
- Linear MCP project and issue lookup
- `mahler capacity --workspace <workspace>`
- runtime-native agent launch for conductors (sub-agents, agent teams, or
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
   conductor brief at it. Use the interview skill with the human when the
   plan has open questions that change scope.
4. **Dispatch.** Run `mahler capacity --workspace <workspace>` before each wave. For each issue in the
   current wave, up to `concurrency.maxIssueAgents` in `.harness/config.json`
   (and none while capacity reports `busy`; raising the cap is a recorded
   deviation), launch a conductor with a sub-agent brief built with the
   delegate skill: base profile `conductor`, issue mode, a tier chosen from the
   issue's risk and ambiguity, authority `edit`, objective
   "carry `<ISSUE>` through the conduct skill to open, reviewed PRs", the
   `maxSliceAgents` and `maxHeavyCommands` caps,
   context link to its `Specifications` section and the project's labels
   (the conductor records them as `projectLabels`), results destination the
   issue's `HANDOFF.md` plus a reply to the composer. Exactly one conductor
   owns an issue at a time.
5. **Choose an execution mode** and record it in `COMPOSITION.md`. Prefer
   conductors that can launch their own sub-agents. If the runtime cannot
   nest agents that deep:
   - launch conductors as independent top-level sessions (e.g. headless
     `claude -p` or `codex exec` in the product workspace) and monitor them
     through their `HANDOFF.md`, or
   - act as the conductor for each issue yourself: follow the conduct
     skill per issue, launching slice conductors and reviewers directly and keeping
     each issue's state in its own `HANDOFF.md`.
6. **Monitor.** Track each conductor through its replies and
   `.harness/issues/<ISSUE>/HANDOFF.md`. Answer escalations:
   - Tier 2 requests from conductors: the composer may approve or deny them
     (see the judgment policy); log each approval in `COMPOSITION.md`.
   - Scope changes that affect other issues or the project goal, conflicts
     between conductors, or a conductor blocked twice on the same
     problem: escalate to the human.
7. **Merge and advance waves.** When a conductor reports PRs ready to
   merge, use the merge skill: labels first, then readiness, then your own risk
   judgment. Merge what the merge policy allows (predecessors first for stacked
   PRs); hand everything else to the human with its assessment. Start
   dependent issues once their blockers merge, or stack them on an open PR when
   waiting would stall the plan. Revise the plan when results change its
   assumptions.
8. **Synthesize.** Report to the human: per-issue status and PR links, risks,
   decisions needed, and what the next wave will do. Keep `COMPOSITION.md`
   current so a later session can resume from it.

## COMPOSITION.md Template

```md
# Composition: <project or goal>

- Composer: <agent>
- Source: <Linear project URL or issue list>
- Project labels: <labels, or none>
- Execution mode: nested sub-agents | separate sessions | composer-as-conductor
- Concurrency: <maxIssueAgents> issue agents (from `.harness/config.json`; note any override and why)

## Goal

<!-- The outcome the human asked for, in one or two sentences. -->

## Plan

| Wave | Issue | Title | Depends on | Repos | Conductor (tier) | Status | PRs | Merge |
|---|---|---|---|---|---|---|---|---|

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
- One conductor brief, with tier and reason, per dispatched issue
- A synthesis report to the human
- Workflow deviations recorded in the affected issue's `HANDOFF.md`, or in
  `COMPOSITION.md` when they span issues; a ledger note only when the reason
  generalizes

## Stop Conditions

- Linear MCP is unavailable or project/issue metadata is incomplete
- no eligible issues remain
- the next step crosses a Tier 3 boundary (bypassing required CI or branch
  protection): pause for the human
- a PR needs human review under the merge policy: hand it off and continue
  with other work
- the plan requires scope beyond the requested project or issue set
- conductors conflict over the same code and cannot be serialized without a
  human decision

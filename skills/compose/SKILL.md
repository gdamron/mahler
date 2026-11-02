---
name: compose
description: Plan a Linear project, a set of issues, or a goal agreed in conversation, dispatch one conductor per issue, verify the project against its acceptance criteria, and synthesize results for the human.
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
- a goal the human describes in conversation, without Linear

## Required Policies

- judgment
- issue-selection
- interview
- sub-agent-delegation
- merge
- risk
- verification
- workspace-safety
- handoff

## Allowed Commands

- `mahler linear-template project` and `mahler linear-template task`
- `mahler task <slug> --agent <agent> --task-file <task.json>`
- `mahler acceptance freeze|manifest|run --workspace <workspace> --project <slug> ...`
- `mahler decide --rule <rule> --description "<one line>" --reason "<why>" --issue <ISSUE> --agent <agent>`
- Linear MCP project and issue lookup, and creating the issues in a plan the
  human approved (see the write-issue skill)
- `mahler capacity --workspace <workspace>`
- runtime-native agent launch for conductors (sub-agents, agent teams, or
  headless sessions such as `claude -p` / `codex exec`)
- read-only git, status, and diff commands across issue workspaces

## Expected Inputs

- A Linear project name or ID, an explicit list of issue identifiers, or a
  human goal to decompose into issues
- The project's acceptance criteria from the human, when they wrote them
- `.harness/decisions/INDEX.md` and the knowledge store's `INDEX.md`

## Process

1. **Resolve scope.** For a project, use Linear MCP `get_project` and
   `list_issues`, then apply the eligibility rules in the issue-selection
   policy. For an explicit list, use `get_issue` for each; named issues are in
   scope as named, but stop and ask if one is blocked or already active. For
   a goal agreed in conversation, decompose it into local tasks with
   `mahler task` (see the issue-selection policy) and get the human's go-ahead
   on the list, its criteria, and its risk levels.
2. **Plan.** Write `.harness/projects/<slug>/COMPOSITION.md` from the template
   below (`<slug>` is the project slug, or a short name for an ad hoc list).
   Order issues by blockers, then priority, then oldest update/create
   timestamp, and group them into waves: an issue joins a wave only when its
   blockers are done or can be stacked on an open PR (its PR targets the
   blocker's branch, but the two issues are never linked into one GitHub
   stack). Issues likely to touch the
   same files go in different waves. An issue that holds several deliverables,
   each able to merge on its own, is often better split into several issues
   now than discovered as one long stack later.
3. **Specify.** Write every new issue with the write-issue skill: a risk
   label with its reason, and acceptance criteria a tester can check without
   the code. Get the human's go-ahead on new issues before creating them in
   Linear. When an issue is underspecified, or issues share
   an interface, add a section under `Specifications` in `COMPOSITION.md`
   (clarified acceptance criteria, contracts between issues, non-goals) and
   point the conductor brief at it. Use the interview skill with the human
   when the plan has open questions that change scope.
3a. **Set up project acceptance.** When the human wrote project criteria and
   `acceptance` is configured, make sure they are in
   `<acceptance.path>/projects/<slug>/CRITERIA.md` with IDs (P1, P2, ...), and
   launch a tester in project mode before the first wave (see the
   verification policy). When its PR merges in the acceptance repo, freeze
   the suite at the merged commit with `mahler acceptance freeze --project
   <slug>`. Fill the traceability table in `COMPOSITION.md`: each criterion,
   the issues that serve it, and the tests that check it. A criterion no
   issue serves is a gap in the plan.
4. **Dispatch.** Run `mahler capacity --workspace <workspace>` before each wave. For each issue in the
   current wave, up to `concurrency.maxIssueAgents` in `.harness/config.json`
   (and none while capacity reports `busy`; raising the cap is a recorded
   deviation), launch a conductor with a sub-agent brief built with the
   delegate skill: base profile `conductor`, issue mode, a tier chosen from the
   issue's risk and ambiguity, authority `edit`, objective
   "carry `<ISSUE>` through the conduct skill to open, reviewed PRs", the
   `maxSliceAgents` and `maxHeavyCommands` caps, a rough expected size,
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
   - Disputes over frozen acceptance tests: decide them (see the verification
     policy) and record each decision in `COMPOSITION.md`. A dispute that
     changes what the human's project criteria mean goes to the human.
   - Review findings a conductor escalates, and check-ins about work that has
     outgrown its estimate: decide yourself what matters (see the review
     policy) rather than passing every finding
     back as more work. Batch the set-aside findings for the human to triage
     before any of them becomes a new issue, then write the approved ones with
     the write-issue skill.
7. **Merge and advance waves.** When a conductor reports PRs ready to
   merge, use the merge skill: labels and paths first, then the risk level's
   verification, then readiness. Merge what the merge policy allows
   (a stack in one step with `gh stack merge`, or predecessors first
   without it); hand everything else to the human
   with its verification record. After each wave merges, run the project
   suite on the base branches (`mahler acceptance run --project <slug>`) and
   update the traceability table; a failing criterion becomes new work. Start
   dependent issues once their blockers merge, or stack them on an open PR when
   waiting would stall the plan. Revise the plan when results change its
   assumptions.
8. **Synthesize.** Report to the human: per-issue status and PR links, which
   project criteria pass, risks, decisions needed, and what the next wave
   will do. The project is done when every criterion passes on the base
   branches, not when the last issue merges. Keep `COMPOSITION.md`
   current so a later session can resume from it.

When the human asks for something new mid-project ("fix that now"), a rough
size and a suggested cut before starting usually beat a quick yes. For example:
"the reported bug is one small PR; closing every related path is four or
five. I suggest the first."

When the human asks you to pause, reply in the same turn with what is in
flight and where each piece will stop. Ask conductors to finish and push their
current commit, update `HANDOFF.md` and report, without starting new review
rounds. Then save state in `COMPOSITION.md`. A pause means wrapping work up
cleanly, not leaving it half-merged: keep base branches releasable.

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

| Wave | Issue | Title | Risk | Depends on | Repos | Conductor (tier) | Status | PRs | Merge |
|---|---|---|---|---|---|---|---|---|---|

## Acceptance Criteria

- Suite: <acceptance repo>/<path>/projects/<slug>/ (frozen at <sha>), or none

| Criterion | Issues | Tests | Status |
|---|---|---|---|

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

- a named Linear project or issue can't be fetched, or its metadata is
  incomplete
- no eligible issues remain
- the next step crosses a Tier 3 boundary (bypassing required CI or branch
  protection): pause for the human
- a PR needs human review under the merge policy: hand it off and continue
  with other work
- the plan requires scope beyond the requested project or issue set
- conductors conflict over the same code and cannot be serialized without a
  human decision

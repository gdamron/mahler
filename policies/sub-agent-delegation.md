# Sub-Agent Delegation Policy

Composer and orchestrator agents delegate scoped work to sub-agents through the
native/runtime agent capabilities available in the current environment. Mahler
does not launch sub-agents itself and does not provide `mahler subagent ...`
commands.

Delegation is an aid to investigation, implementation, and review. The
delegating agent remains responsible for coordination, integration, quality
checks, and synthesis. The human developer remains the final accountable
authority.

## Delegation Hierarchy

```text
human
  └── composer            plans multiple issues; one orchestrator per issue; merges
        └── orchestrator  owns one issue; one implementer per slice
              ├── implementer  edits, commits, and pushes its slice branch
              └── reviewer     read-only review of a finished slice
```

- A human may task any level directly. `full-stack` is the lowest-level agent a
  human tasks directly: it runs the whole issue loop itself.
- Each agent reports to its parent. Escalations travel up one level at a time.
- The orchestrator owns the issue's `HANDOFF.md`; the composer owns
  `COMPOSITION.md`. Sub-agents report to their parent rather than editing
  those records.
- If the runtime cannot nest agents as deep as the hierarchy needs, the parent
  either launches the child as an independent top-level session or performs
  the child's role itself, following the child's skill. Record the chosen mode
  where the parent keeps its plan.

## Role Selection

- Prefer configured or predefined sub-agent roles by default.
- Choose the closest fitting configured role, then specialize it in the brief
  when the task needs narrower instructions.
- Use an ad hoc role only when no configured role fits. The brief must state why
  the ad hoc role is needed, what it is allowed to do, and where its scope ends.
- Do not invent broader authority than the current issue, active profile,
  workspace guardrails, or human instruction allows.

## Authority

Sub-agents are read-only by default.

Use `authority mode: read-only` unless the delegating agent explicitly grants
edit authority in the brief. A read-only sub-agent may inspect files, search code,
run non-mutating commands, and report findings, but must not modify files,
create commits, push branches, open PRs, or change issue-tracker state.

If edit authority is granted, the brief must state the exact allowed
modification scope: repos, files, paths, command classes, and any protected
areas. Standard grants by role:

- **Implementer:** edit within its slice worktree, commit, and push its slice
  branch. It does not open PRs, merge, force-push shared branches, or change
  issue-tracker state.
- **Reviewer:** read-only. It may run tests and checks to validate findings.
- **Orchestrator (from a composer):** run the orchestrate skill for its one
  issue, including launching implementers and reviewers and opening PRs.

Only the composer merges, under the merge policy; sub-agents never merge or
bypass human review. For Tier 2 actions (see the
judgment policy) it asks its parent. A composer may give Tier 2 go-ahead to its
orchestrators; an orchestrator passes Tier 2 requests up to its own parent
rather than approving them. Tier 3 boundaries always go to the human.

## Required Brief Fields

Every delegated task should start from a written brief with these fields:

- Role: the sub-agent's role in this delegation.
- Base configured role/profile: the predefined role/profile used, or `none`.
- Specialization or ad hoc role description: narrower instructions, or the ad
  hoc role rationale when no configured role fits.
- Objective: the concrete outcome requested.
- Relevant context and links: issue IDs, Linear URLs, repo notes, prior findings,
  and files that should be read first.
- Allowed repos/files/paths: exact scope the sub-agent may inspect or modify.
- Constraints and guardrails: non-goals, protected areas, command limits, and
  policy reminders.
- Authority mode: `read-only` or `edit`; default is `read-only`.
- Expected output format: findings, patch summary, test results, risks, open
  questions, or another explicit format.
- Results destination: where to report results, such as a reply to the
  delegating agent, `HANDOFF.md`, or `COMPOSITION.md`.

## Sub-Agent Brief Template

```md
# Sub-Agent Brief

- Role:
- Base configured role/profile:
- Specialization or ad hoc role description:
- Objective:
- Relevant context and links:
- Allowed repos/files/paths:
- Constraints and guardrails:
- Authority mode: read-only
- Expected output format:
- Results destination:

## Instructions

- Stay within the allowed repos/files/paths.
- Treat authority as read-only unless this brief explicitly says `edit`.
- If authority mode is `edit`, modify only the allowed scope, take only the
  outward actions (commit, push, PR) the brief names, and leave a concise change
  summary for the delegating agent.
- Stop and report back if required context is missing, scope is unclear, or the
  task appears to require broader authority.
```

## Synthesizing Results

The delegating agent synthesizes sub-agent output into the active work record:

- Put durable issue status, changed files, checks run, blockers, risks, and next
  steps in `HANDOFF.md`.
- Put cross-issue plan, status, and approvals in `COMPOSITION.md`.
- Keep transient investigation notes in working notes when they do not need to
  survive handoff.
- Record workflow deviations in `HANDOFF.md`; if the reason generalizes beyond
  the issue, also add a `.harness/decisions/` ledger note.
- Do not paste raw sub-agent transcripts unless the detail is necessary for
  review; summarize the decision-relevant findings.

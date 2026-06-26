# Sub-Agent Delegation Policy

The orchestrator agent may delegate scoped work to sub-agents through the
native/runtime agent capabilities available in the current environment. Mahler
does not launch sub-agents itself and does not provide `mahler subagent ...`
commands.

Delegation is an aid to investigation, implementation, and review. The
orchestrator remains responsible for coordination, integration, quality checks,
and synthesis. The human developer remains the final accountable authority.

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

Use `authority mode: read-only` unless the orchestrator explicitly grants edit
authority in the brief. A read-only sub-agent may inspect files, search code,
run non-mutating commands, and report findings, but must not modify files,
create commits, push branches, open PRs, or change issue-tracker state.

If edit authority is granted, the brief must state the exact allowed
modification scope: repos, files, paths, command classes, and any protected
areas. The orchestrator must review edited files and integrate the result before
commit or PR. A sub-agent must never commit, push, open a PR, merge, or bypass
human review unless the human explicitly delegated that outward action.

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
- Results destination: where to report results, such as the orchestrator reply,
  `HANDOFF.md`, or orchestrator working notes.

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
- If authority mode is `edit`, modify only the allowed scope and leave a concise
  change summary for orchestrator review before commit or PR.
- Stop and report back if required context is missing, scope is unclear, or the
  task appears to require broader authority.
```

## Synthesizing Results

The orchestrator should synthesize sub-agent output into the active work record:

- Put durable issue status, changed files, checks run, blockers, risks, and next
  steps in `HANDOFF.md`.
- Keep transient investigation notes in orchestrator working notes when they do
  not need to survive handoff.
- Record workflow deviations in `HANDOFF.md`; if the reason generalizes beyond
  the issue, also add a `.harness/decisions/` ledger note.
- Do not paste raw sub-agent transcripts unless the detail is necessary for
  review; summarize the decision-relevant findings.

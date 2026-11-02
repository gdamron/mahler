# Definition of Done Policy

Definition of Done is layered:

1. Team baseline: Mahler's defaults plus the workspace's `definitionOfDone`
   changes in `.harness/config.json`.
2. Acceptance criteria from the issue or local task brief, plus the
   verification its risk level requires (see the verification policy).

An issue is done only when both layers are satisfied. Treat the rendered
`Definition of Done` checklist in `TASK.md` and `AGENT_SESSION.md` as the
working contract for completion.

Before handoff, verify each checklist item and update `HANDOFF.md` with:

- changed files,
- checks run and results,
- skipped checks with reasons,
- the verification record,
- known risks or blockers,
- next steps.

Do not expand the issue scope just to satisfy a broad item. If a checklist item
conflicts with the issue scope or available context, stop and ask your parent
(the composer, or the human when there is none) for a scope decision, then
record the outcome in `HANDOFF.md`.

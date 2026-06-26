# Definition of Done Policy

Definition of Done is layered:

1. Team baseline from `.harness/config.json` `definitionOfDone`.
2. Issue-specific acceptance criteria from the Linear issue brief.

An issue is done only when both layers are satisfied. Treat the rendered
`Definition of Done` checklist in `TASK.md` and `AGENT_SESSION.md` as the
working contract for completion.

Before handoff, verify each checklist item and update `HANDOFF.md` with:

- changed files,
- checks run and results,
- skipped checks with reasons,
- known risks or blockers,
- next steps for human review.

Do not expand the issue scope just to satisfy a broad item. If a checklist item
conflicts with the issue scope or available context, stop and ask the human for a
scope decision, then record the outcome in `HANDOFF.md`.

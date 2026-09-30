# Mahler Native Adapter: {{runtimeLabel}}

This file is generated from Mahler canonical skills, profiles, and policies.

## Prompt Routing

When the user asks to work on a Linear issue or project, including bare prompts like `work on MAH-123`:

1. Read `WORKFLOW.md`.
2. Read `.harness/config.json` to identify the active {{runtimeLabel}} profile.
3. Read that profile under `.harness/agents/profiles/`.
4. For `work on ISSUE-123`: an orchestrator uses `{{skillsDir}}/orchestrate/SKILL.md`, which starts with `{{skillsDir}}/work-on-issue/SKILL.md`; any other role uses `{{skillsDir}}/work-on-issue/SKILL.md` directly.
5. For project or multi-issue prompts: a composer uses `{{skillsDir}}/compose/SKILL.md` to plan every eligible issue; any other role uses `{{skillsDir}}/select-project-issue/SKILL.md` to pick one.
6. Read every policy named by the selected skill from `.harness/policies/`.
7. Use Linear MCP for issue or project details.
8. Write Linear metadata JSON under `.harness/tmp/linear/` using `mahler linear-template issue|project` as the shape.
9. Run the Mahler command described in `.harness/config.json` to create the issue brief.
10. Decide which configured repos need worktrees, choose branch names using `.harness/policies/branching.md`, and create only those worktrees.
11. Prefer project-local worktrees under `workspaces/issues/<ISSUE>/repos/<repo>`.
12. Record deliberate workflow deviations in `HANDOFF.md`; only when the reason generalizes beyond this issue, also append a note with `mahler decide --rule <rule> --reason "<why>" --issue <ISSUE> --agent {{runtime}}` to `.harness/decisions/`. At session start, read the active ledger in `.harness/decisions/` (not `archive/`) to recover durable decisions — the next session never reads a prior issue's HANDOFF.
13. If the requested skill is outside the active profile, treat it as a Tier 1 deviation: proceed deliberately and record the reason in `HANDOFF.md`; add a `.harness/decisions/` ledger note only when the reason generalizes beyond this issue. Stop and ask if Linear metadata is unavailable.

## Confirm Before Outward Actions

Merging a PR is a Tier 2 action (see `.harness/policies/judgment.md` and
`.harness/policies/merge.md`): outward-facing and hard to reverse. Only a composer
may merge, and only PRs the merge policy allows; every other agent stops and gets
explicit human go-ahead for the specific PR. For other Tier 2 actions, get
explicit go-ahead from your parent agent (a composer) or the human before
proceeding. Using a skill outside the active profile is a Tier 1 role-fit
deviation unless the underlying action is itself Tier 2. Mahler does not perform or
block these actions itself; the pause is the gate.

Do not skip the Mahler issue brief just because the product repo is visible from the root directory.

Project-local instructions in `{{rootInstructions}}` intentionally point back to these canonical installed skills and policies.

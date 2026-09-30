## Mahler Workflow

This workspace uses Mahler. Bare prompts like `work on MAH-123`, `start MAH-123`, or `work on project X in Linear` should route through Mahler before code changes so the agent has the issue brief and shared policies.

Mahler compiles canonical workflow source into native agent artifacts:

- Codex skills: `.agents/skills/<skill>/SKILL.md`
- Codex agents: `.codex/agents/<profile>.toml`
- Claude skills: `.claude/skills/<skill>/SKILL.md`
- Claude agents: `.claude/agents/<profile>.md`
- Shared config and policies: `.harness/config.json` and `.harness/policies/`

Recommended routing:

- Active profile check: inspect `.harness/config.json` and the active profile in `.harness/agents/profiles/` ({{codexProfile}}; {{claudeProfile}}) before choosing a skill.
- Issue prompt: use the native `work-on-issue` skill. It fetches Linear metadata, writes `.harness/tmp/linear/<ISSUE>.json`, then runs `{{mahlerCommand}} issue <ISSUE> --agent <codex|claude> --linear-file <issue.json>` to create a brief.
- Project prompt: use the native `select-project-issue` skill. It fetches Linear project metadata, writes `.harness/tmp/linear/<project>.json`, then runs `{{mahlerCommand}} project "<PROJECT>" --agent <codex|claude> --linear-file <project.json>`.
- For review, commit, PR, and handoff prompts, use the matching native skill and the policies it names.
- Sub-agent delegation: use `.harness/policies/sub-agent-delegation.md`; prefer configured roles, specialize them in the brief, default to read-only authority, and synthesize results into `HANDOFF.md` or working notes. Mahler does not provide `mahler subagent ...` commands.
- Create git worktrees only for repos needed by the task, preferably under `{{workspaceDir}}/issues/<ISSUE>/repos/<repo>`.
- Choose branch names using `.harness/policies/branching.md`; Mahler does not choose branch names for agents.
- Record deliberate workflow deviations in `.harness/issues/<ISSUE>/HANDOFF.md`; only when the reason generalizes beyond this issue, also append a note with `mahler decide` to `.harness/decisions/`. Read the active ledger (not `archive/`) at session start to recover durable decisions.
- If the requested skill is outside the active profile, treat it as a Tier 1 deviation: you may proceed deliberately, but record the reason (see `.harness/policies/judgment.md`). Stop and ask the human if Linear metadata is unavailable.

Guardrails (Tier 3 — declared here so agents anticipate them; enforced by the forge/CI, not Mahler):

{{guardrails}}

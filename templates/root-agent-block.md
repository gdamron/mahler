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
- Multi-issue or project prompt for a composer: use the native `compose` skill. It plans every eligible issue in `.harness/projects/<slug>/COMPOSITION.md` and dispatches one conductor per issue.
- Issue prompt (any role, including a composer handed one issue): use the native `conduct` skill, which starts with `work-on-issue`, implements directly by default, and delegates slices only when the issue warrants it. `work-on-issue` fetches Linear metadata, writes `.harness/tmp/linear/<ISSUE>.json`, then runs `{{mahlerCommand}} issue <ISSUE> --agent <codex|claude> --linear-file <issue.json>` to create a brief.
- Project prompt for any other role: use the native `select-project-issue` skill to pick one issue. It fetches Linear project metadata, writes `.harness/tmp/linear/<project>.json`, then runs `{{mahlerCommand}} project "<PROJECT>" --agent <codex|claude> --linear-file <project.json>`.
- For implement, review, commit, PR, and handoff prompts, use the matching native skill and the policies it names.
- Sub-agent delegation: use the native `delegate` skill to decide whether to delegate and which model tier (`.harness/MODELS.md`) to launch on, and `.harness/policies/sub-agent-delegation.md` for the brief; default to read-only authority and synthesize results into `HANDOFF.md` or working notes. Mahler does not provide `mahler subagent ...` commands.
- Machine load: before launching agents in parallel or running full test suites and builds, run `{{mahlerCommand}} capacity` and stay within the `concurrency` caps in `.harness/config.json`.
- Create git worktrees only for repos needed by the task, preferably under `{{workspaceDir}}/issues/<ISSUE>/repos/<repo>`.
- Choose branch names using `.harness/policies/branching.md`; Mahler does not choose branch names for agents.
- Record deliberate workflow deviations in `.harness/issues/<ISSUE>/HANDOFF.md`; only when the reason generalizes beyond this issue, also append a note with `mahler decide` to `.harness/decisions/`. Read the active ledger (not `archive/`) at session start to recover durable decisions.
- If the requested skill is outside the active profile, treat it as a Tier 1 deviation: you may proceed deliberately, but record the reason (see `.harness/policies/judgment.md`). Stop and ask the human if Linear metadata is unavailable.

Merging is a Tier 2 action only a composer may take (see `.harness/policies/merge.md`), deciding in this order: issue or project labels {{humanReviewLabels}} always require human review; labels {{agentMergeLabels}} pre-approve a composer merge once CI and review are green; otherwise the composer merges only PRs it judges low risk. A PR the composer judges high risk always goes to the human, whatever its labels.

Guardrails (Tier 3 — declared here so agents anticipate them; enforced by the forge/CI, not Mahler):

{{guardrails}}

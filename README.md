# Mahler

Mahler (as in Gustav, everyone's favorite composer/conductor) is a workflow
tool for multi-agent software work. A composer agent coordinates conductor
agents, each owning one issue, under a human developer who stays the final
accountable authority. It installs
project-scoped instructions, policies, and helpers so agents can be prompted
with small requests such as:

```sh
work on ISSUE-123
work on project "My Project" in issue tracking
```

Mahler keeps code work task-scoped. Project prompts resolve to individual
issues before any code workspace is created: a composer plans all of them, and
other roles pick one.

## Principles

- The human developer is the final accountable authority for quality,
  integration, merge, and release — not modeled as an agent.
- Agents form a hierarchy: a **composer** (the default role and primary
  interface to the human) plans multi-issue work and dispatches one
  **conductor** per issue. A conductor does the work itself by default and
  delegates slices to other conductors in **slice mode** only when the issue
  spans repos, splits into parallel parts, or is too large for one PR. A
  **reviewer** (read-only) reviews every diff. Agents pause at Tier 2
  boundaries for their parent's go-ahead.
- Delegation costs tokens, so it must earn its place. The `delegate` skill
  decides whether to launch a sub-agent and on which **model tier**: named
  per-install tiers (`models` overrides in `.harness/config.json`, listed in
  `.harness/MODELS.md`) map to a model and
  reasoning effort per runtime, or hand a role to another skill, agent type, or
  shell command (for example a Codex review of Claude's work). `concurrency` caps parallel agents and heavy
  commands, and `mahler capacity` reports machine load against them.
- Merging is a Tier 2 action only the composer takes, and only once readiness
  checks pass. Labels in `merge.humanReviewLabels` (default `high-risk`) always
  send a PR to the human; labels in `merge.agentMergeLabels` (default
  `agent-merge`) pre-approve a composer merge; otherwise the composer merges
  only what it judges low risk. A PR it judges high risk always goes to the
  human.
- Sub-agent delegation uses native/runtime agent capabilities plus the installed
  `sub-agent-delegation` policy and brief template. Sub-agents are read-only by
  default unless their brief explicitly grants scoped edit authority.
- Tasks (such as Linear issues) are the atomic unit for code changes, commits,
  and PRs.
- Agents create dedicated git worktrees only for the repos needed by a task,
  preferably under `workspaces/issues/<ISSUE>/repos/`.
- Policies live in canonical Mahler modules and are rendered into
  workspace-local Claude/Codex instruction surfaces.
- Skills compose policies into named workflows, and agent profiles declare
  which skills each role can use.
- Generated markdown (`WORKFLOW.md`, issue briefs, runtime adapters, agent
  definitions, installed READMEs) is rendered from `templates/*.md`; the
  TypeScript only fills `{{placeholders}}`.
- Linear MCP is the preferred source of issue and project context. If an agent
  lacks Linear MCP access, it must ask for missing metadata instead of
  inventing it.

## Commands

```sh
npm install -g https://github.com/gdamron/mahler/releases/download/v2026.10.0/mahler-2026.10.0.tgz   # pinned; see INSTALL.md
mahler --version
mahler install /path/to/product-workspace --linear-assignee gonzo --linear-label agent
mahler issue FUG-123 --workspace /path/to/product-workspace --agent codex
mahler project "Project X" --workspace /path/to/product-workspace --agent claude --linear-file project.json
mahler status --workspace /path/to/product-workspace
mahler profile codex --workspace /path/to/product-workspace
mahler can codex commit --workspace /path/to/product-workspace
mahler handoff FUG-123 --workspace /path/to/product-workspace --agent codex
mahler decide --rule scope --reason "expanded to fix adjacent bug" --issue FUG-123 --agent codex --workspace /path/to/product-workspace
mahler check --workspace /path/to/product-workspace [--repo <name>] [--issue FUG-123 | --path <worktree>]
mahler capacity --workspace /path/to/product-workspace
mahler cleanup FUG-123 --workspace /path/to/product-workspace [--dry-run]
mahler doctor /path/to/product-workspace
mahler linear-template issue
mahler linear-template project
```

`mahler install` scans the target workspace for immediate child git repos and
writes them into `.harness/config.json`. Linear assignee and label filters are
explicit install options; Mahler does not ship a default assignee. When a repo
has a `package.json`, install pre-populates per-repo `checks` (test/lint/build
commands) from its scripts; edit `.harness/config.json` to adjust them.
Reinstalling keeps human-set config: the Mahler command, worktree root, Linear
filters, repo checks, merge labels, each runtime's agent profile, and changes
to Mahler's default model tiers, concurrency caps, guardrails, and Definition
of Done, which are stored as overrides so new defaults still arrive (see
[INSTALL.md](INSTALL.md#what-reinstall-keeps)).

`mahler check` is a local mirror of CI: it runs each repo's configured check
commands and reports ok/fail per command. With `--issue` it checks every
worktree under the issue's `repos/` dir, including slice worktrees such as
`repos/<repo>-<slice>`, and fails if there are none; with `--path` it checks a
single worktree; otherwise it checks each source repo. It is feedback, not a gate — the
forge/CI remains the Tier 3 authority.

`mahler capacity` prints CPU cores, load average, and the `concurrency` caps
from `.harness/config.json`, with an ok/busy verdict. Agents run it before
launching parallel agents or heavy commands. Like `check`, it is advisory.

`mahler cleanup` removes an issue's worktrees once its PRs are merged, keeping
branches and the issue brief. It refuses to remove a worktree with uncommitted
or untracked changes. Finished worktrees otherwise keep costing disk, and on
macOS, Spotlight indexing; `mahler doctor` reports when Spotlight is indexing
the worktree root (exclude it in System Settings → Spotlight → Search Privacy;
folder markers such as `.metadata_never_index` are not honored there).

`mahler decide` appends a note to the decisions ledger
(`.harness/decisions/<YYYY-MM-DD>-<slug>.md`): the durable, cross-session record
of Tier-1 deviations and the reasons behind them. A per-issue `HANDOFF.md` is
not enough — a later session never reads a prior issue's handoff, so the ledger
carries intent forward (the "experience" an agent otherwise lacks each session).
Because the ledger is read at the start of every session, it stays lean:
only deviations whose reason _generalizes beyond the issue that produced them_
belong here; purely issue-local calls stay in `HANDOFF.md`. It is append-only —
agents never edit, delete, or move entries — and humans curate, promoting
recurring decisions into policy and moving stale notes to
`.harness/decisions/archive/` (not read by default). It is designed to fold into
a future shared memory store with no migration.

Install compiles canonical Mahler source into native agent artifacts:

- Codex project skills in `.agents/skills/`
- Codex project agents in `.codex/agents/`
- Claude project skills in `.claude/skills/`
- Claude project agents in `.claude/agents/`
- Shared config, policies, profiles, and install state in `.harness/`

Use `mahler profile <agent>` and `mahler can <agent> <skill>` to inspect the
active profile gate. Review, commit, PR, and handoff behavior lives in the
generated native skills rather than CLI workflow commands.

Run `mahler doctor <workspace>` after install (or any time) to verify the
configured repos, policies, skills, profiles, and adapter docs. It exits
non-zero with a clear message if anything is missing, and warns when a profile
allows a skill that is not installed.

### Customizing a workspace

The install set is discovered by scanning Mahler's canonical source, so new
policies, skills, and profiles install automatically. To adapt the workflow for
one workspace without forking Mahler, drop files under
`.harness/custom/{policies,skills,agents}/`:

- A custom file with the **same name** as a Mahler default **replaces** it.
- A custom file with a **new name** is **added** to the install set.
- Reinstall (`mahler install`) never overwrites anything under `.harness/custom/`.
- Composed markdown carries a provenance header (for example
  `> Mahler default was replaced by .harness/custom/policies/review.md`) so
  agents read a single file. A malformed override fails `install`.

See `.harness/custom/README.md` (written on install) and `INSTALL.md` for details.

Use `mahler linear-template issue|project` to print the JSON shape expected by
`--linear-file`. Agents should write temporary Linear MCP metadata under
`.harness/tmp/linear/` in the product workspace before invoking Mahler.

`mahler issue` creates an issue brief under `.harness/issues/<ISSUE>/`. It does
not create branches or worktrees. Agents choose branch names from policy and
create worktrees only for the configured repos needed by the task.

See `INSTALL.md` for agent-facing installation instructions.

`INSTALL.md` also includes a manual dogfood checklist for validating a fresh
Codex or Claude session against a real Linear issue using the generated native
skills and agent definitions.

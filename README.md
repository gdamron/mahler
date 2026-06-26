# Mahler

Mahler (as in Gustav, everyone's favorite composer/conductor) is a workflow
tool for multi-agent software work. An orchestrator agent coordinates the work
under a human developer who stays the final accountable authority. It installs
project-scoped instructions, policies, and helpers so agents can be prompted
with small requests such as:

```sh
work on ISSUE-123
work on project "My Project" in issue tracking
```

Mahler keeps code work task-scoped. Project prompts resolve to one task or
issue before any code workspace is created.

## Principles

- The human developer is the final accountable authority for quality,
  integration, merge, and release — not modeled as an agent.
- The orchestrator agent is the default coordinating role and the primary
  interface to the human: it plans, delegates to sub-agents, synthesizes their
  output, and surfaces risks. It is empowered to take any action directly when
  warranted — delegation is the common case, not a capability limit — and pauses
  at Tier 2 boundaries (push/PR) for human go-ahead.
- Sub-agent delegation uses native/runtime agent capabilities plus the installed
  `sub-agent-delegation` policy and brief template. Sub-agents are read-only by
  default unless an orchestrator brief explicitly grants scoped edit authority.
- Tasks (such as Linear issues) are the atomic unit for code changes, commits,
  and PRs.
- Agents create dedicated git worktrees only for the repos needed by a task,
  preferably under `workspaces/issues/<ISSUE>/repos/`.
- Policies live in canonical Mahler modules and are rendered into
  workspace-local Claude/Codex instruction surfaces.
- Skills compose policies into named workflows, and agent profiles declare
  which skills each role can use.
- Linear MCP is the preferred source of issue and project context. If an agent
  lacks Linear MCP access, it must ask for missing metadata instead of
  inventing it.

## Commands

```sh
npm install
npm run build
mahler install /path/to/product-workspace --linear-assignee gonzo --linear-label agent
mahler issue FUG-123 --workspace /path/to/product-workspace --agent codex
mahler project "Project X" --workspace /path/to/product-workspace --agent claude --linear-file project.json
mahler status --workspace /path/to/product-workspace
mahler profile codex --workspace /path/to/product-workspace
mahler can codex commit --workspace /path/to/product-workspace
mahler handoff FUG-123 --workspace /path/to/product-workspace --agent codex
mahler decide --rule scope --reason "expanded to fix adjacent bug" --issue FUG-123 --agent codex --workspace /path/to/product-workspace
mahler check --workspace /path/to/product-workspace [--repo <name>] [--issue FUG-123]
mahler doctor /path/to/product-workspace
mahler linear-template issue
mahler linear-template project
```

`mahler install` scans the target workspace for immediate child git repos and
writes them into `.harness/config.json`. Linear assignee and label filters are
explicit install options; Mahler does not ship a default assignee. When a repo
has a `package.json`, install pre-populates per-repo `checks` (test/lint/build
commands) from its scripts; edit `.harness/config.json` to adjust them.

`mahler check` is a local mirror of CI: it runs each repo's configured check
commands (in the issue worktree when `--issue` is given, otherwise the source
repo) and reports ok/fail per command. It is feedback, not a gate — the
forge/CI remains the Tier 3 authority.

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

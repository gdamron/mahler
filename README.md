# Mahler

Mahler (as in Gustav, everyone's favorite composer/conductor) is a human-
orchestrated workflow tool for multi-agent software work. It installs project-
scoped instructions, policies, and helpers so agents can be prompted with small
requests such as:

```sh
work on ISSUE-123
work on project "My Project" in issue tracking
```

Mahler keeps code work task-scoped. Project prompts resolve to one task or
issue before any code workspace is created.

## Principles

- The human is the orchestrator.
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
mahler doctor /path/to/product-workspace
mahler linear-template issue
mahler linear-template project
```

`mahler install` scans the target workspace for immediate child git repos and
writes them into `.harness/config.json`. Linear assignee and label filters are
explicit install options; Mahler does not ship a default assignee.

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
non-zero with a clear message if anything is missing.

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

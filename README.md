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
- Agents work in dedicated git worktrees under `workspaces/issues/`.
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
mahler handoff FUG-123 --workspace /path/to/product-workspace
```

`mahler install` scans the target workspace for immediate child git repos and
writes them into `.harness/config.json`. Linear assignee and label filters are
explicit install options; Mahler does not ship a default assignee.

Install also writes canonical policies, skills, and agent profiles into
`.harness/`. Claude/Codex adapters reference those installed files instead of
duplicating workflow rules.

See `INSTALL.md` for agent-facing installation instructions.

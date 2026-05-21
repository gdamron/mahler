# Harness

Harness is a human-orchestrated workflow tool for multi-agent software work.
It installs project-scoped instructions, policies, and helpers so agents can be
prompted with small requests such as:

```sh
work on FUG-123
work on project "MIDI performance" in Linear
```

The harness keeps code work issue-scoped. Project prompts resolve to one Linear
issue before any code workspace is created.

## Principles

- The human is the orchestrator.
- Linear issues are the atomic unit for code changes, commits, and PRs.
- Agents work in dedicated git worktrees under `workspaces/issues/`.
- Policies live in canonical harness modules and are rendered into
  workspace-local Claude/Codex instruction surfaces.
- Linear MCP is the preferred source of issue and project context. If an agent
  lacks Linear MCP access, it must ask for missing metadata instead of
  inventing it.

## Commands

```sh
npm install
npm run build
node dist/src/cli.js install /path/to/product-workspace
node dist/src/cli.js issue FUG-123 --workspace /path/to/product-workspace --agent codex
node dist/src/cli.js project "Project X" --workspace /path/to/product-workspace --agent claude --linear-file project.json
node dist/src/cli.js status --workspace /path/to/product-workspace
node dist/src/cli.js handoff FUG-123 --workspace /path/to/product-workspace
```

See `INSTALL.md` for agent-facing installation instructions.

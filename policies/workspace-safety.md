# Workspace Safety Policy

Agents must work only in generated issue workspaces.

Rules:

- Do not edit files from the product workspace root.
- Do not edit sibling issue workspaces.
- Do not reuse an issue workspace already owned by another active agent.
- Read `TASK.md`, `AGENT_SESSION.md`, and `HANDOFF.md` before changing code.
- Keep code edits inside repo worktrees under `workspaces/issues/<ISSUE>/repos/`.
- Stop and ask the human if the generated workspace is missing or inconsistent.

## Work Trees

For parallel AI agent work, use git worktrees to run multiple branches simultaneously:

```bash
# Create a worktree for a feature branch
git worktree add ../project-feature-a feature/task-creation
git worktree add ../project-feature-b feature/user-settings

# Each worktree is a separate directory with its own branch
# Agents can work in parallel without interfering
ls ../
  project/              ← main branch
  project-feature-a/    ← task-creation branch
  project-feature-b/    ← user-settings branch

# When done, merge and clean up
git worktree remove ../project-feature-a
```

Benefits:

- Multiple agents can work on different features simultaneously
- No branch switching needed (each directory has its own branch)
- If one experiment fails, delete the worktree — nothing is lost
- Changes are isolated until explicitly merged

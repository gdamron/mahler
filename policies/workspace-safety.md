# Workspace Safety Policy

Agents should work from Mahler issue briefs and selected issue worktrees.

Rules:

- Do not edit files from the product workspace root.
- Do not edit sibling issue workspaces.
- Do not reuse an issue workspace already owned by another active agent.
- Read `TASK.md`, `AGENT_SESSION.md`, and `HANDOFF.md` before changing code.
- Create git worktrees only for repos needed by the task.
- Prefer repo worktrees under `workspaces/issues/<ISSUE>/repos/<repo>`.
- Record deliberate workflow deviations in `HANDOFF.md`.
- Stop and ask the human if the issue brief is missing or inconsistent.

## Work Trees

For parallel AI agent work, use git worktrees to run multiple branches simultaneously. Choose branch names using the branching policy and create only the repo worktrees needed for the task.

```bash
# Create a worktree for a feature branch
git -C app worktree add ../workspaces/issues/ISSUE-123/repos/app feature/task-creation
git -C api worktree add ../workspaces/issues/ISSUE-123/repos/api feature/user-settings

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

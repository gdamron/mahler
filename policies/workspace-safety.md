# Workspace Safety Policy

Agents should work from Mahler issue briefs and selected issue worktrees.

Rules:

- Do not edit files from the product workspace root.
- Do not edit sibling issue workspaces.
- Do not reuse an issue workspace already owned by another active agent.
- Read `TASK.md`, `AGENT_SESSION.md`, and `HANDOFF.md` before changing code.
- Create git worktrees only for repos needed by the task.
- Prefer repo worktrees under `workspaces/issues/<ISSUE>/repos/<repo>`; when an
  issue has several slices in one repo, name the others `repos/<repo>-<slice>`.
- Record deliberate workflow deviations in `HANDOFF.md`.
- Stop and ask the human if the issue brief is missing or inconsistent.

## Worktree Cost

Every worktree is a full checkout, and a dependency install inside it is often
100k+ files. Each one costs disk, CPU for installs and builds, and on macOS,
Spotlight indexing that can keep `mds_stores` busy for hours.

- Create only the worktrees the task needs; prefer fewer slices.
- Install dependencies in a slice worktree only when its checks or tests need
  them; a slice that edits docs or config can skip the install.
- Remove an issue's worktrees with `mahler cleanup <ISSUE>` once its PRs are
  merged. It keeps branches and the issue brief, and refuses to remove a
  worktree with uncommitted or untracked changes.
- `mahler doctor` reports whether Spotlight is indexing the worktree root. The
  fix (System Settings → Spotlight → Search Privacy) is the human's to make.

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

# Workspace Safety Policy

Agents must work only in generated issue workspaces.

Rules:

- Do not edit files from the product workspace root.
- Do not edit sibling issue workspaces.
- Do not reuse an issue workspace already owned by another active agent.
- Read `TASK.md`, `AGENT_SESSION.md`, and `HANDOFF.md` before changing code.
- Keep code edits inside repo worktrees under `workspaces/issues/<ISSUE>/repos/`.
- Stop and ask the human if the generated workspace is missing or inconsistent.

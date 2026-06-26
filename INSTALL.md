# Installing Mahler Into a Product Workspace

These instructions are written for an agent asked to install Mahler in a
directory. They use a deterministic command path (`node dist/src/cli.js`)
that does not rely on any global setup such as `npm link`.

## Steps

1. Clone the `mahler` repository into a tools or temporary location.

   ```sh
   git clone <mahler-repo-url> mahler
   cd mahler
   ```

2. Install dependencies and build the CLI.

   ```sh
   npm install
   npm run build
   ```

   The build produces `dist/src/cli.js`. From here on, invoke the CLI via
   this absolute path so the steps work without any global install.

3. Install Mahler into the product workspace.

   ```sh
   node "$(pwd)/dist/src/cli.js" install /path/to/product-workspace \
     --linear-assignee <username> --linear-label agent
   ```

   Mahler scans the product workspace for immediate child git repositories
   and writes them into `.harness/config.json`. If the human has not
   provided a Linear username or label, install without those flags and
   leave the filters empty until they can be configured. Re-running install
   is safe: it overwrites Mahler-managed files but preserves any user
   content in `AGENTS.md` / `CLAUDE.md` outside the `<!-- HARNESS:START -->`
   block.

4. Verify the install with `mahler doctor`.

   ```sh
   node "$(pwd)/dist/src/cli.js" doctor /path/to/product-workspace
   ```

   The command exits non-zero with clear messages if config, repos,
   policies, skills, profiles, or adapter docs are missing. Treat a zero
   exit as the install gate.

5. (Optional) Expose the `mahler` command globally.

   If you have permission to run `npm link`, do so:

   ```sh
   npm link
   ```

   Otherwise, record the absolute command path in the product workspace
   config so future agent sessions can invoke Mahler without searching for
   it: edit `/path/to/product-workspace/.harness/config.json` and set
   `mahlerCommand` to `node /absolute/path/to/mahler/dist/src/cli.js`.

6. Keep only operational files in the product workspace.

   The installed product workspace should contain:
   - `WORKFLOW.md`
   - `.harness/`
   - `.agents/`
   - `.codex/`
   - `.claude/`
   - generated `.harness/issues/` briefs
   - optional agent-created `workspaces/`

   Do not copy `src/`, `tests/`, `package.json`, `tsconfig.json`, or other
   Mahler source files into the product workspace unless intentionally
   vendoring the tool.

   The `.harness/` directory contains Mahler config, shared policies,
   profile data, and runtime adapter notes. Native agent artifacts are
   generated into `.agents/skills/`, `.codex/agents/`, `.claude/skills/`,
   and `.claude/agents/`.

## After Install

Start a fresh agent in the product workspace and prompt it normally:

```text
work on FUG-123
```

or:

```text
work on project X in Linear
```

The installed instructions tell the agent to resolve Linear context, create or
select an issue brief, choose only the repos needed for the task, and create
project-local worktrees for those repos.

## Customizing This Workspace

Mahler is one canonical workflow source installed into many workspaces. To adapt
its policies, skills, or profiles for *this* workspace without forking Mahler,
use the customization overlay under `.harness/custom/`:

- `.harness/custom/policies/<name>.md` — override or add a workflow policy.
- `.harness/custom/skills/<name>/SKILL.md` — override or add a skill (must start
  with frontmatter containing `name: <name>` and `description:`).
- `.harness/custom/agents/<name>.json` — override or add an agent profile.

Rules:

1. A custom file named like a Mahler default **replaces** that default; a custom
   file with a new name is **added** to the install set.
2. Rerunning `mahler install` re-composes the canonical defaults but **never
   overwrites** anything under `.harness/custom/`.
3. Composed markdown gets a provenance header (for example
   `> Mahler default was replaced by .harness/custom/policies/review.md`) so an
   agent reads one file instead of chasing several.
4. A malformed override (bad profile JSON, a skill missing frontmatter, an empty
   policy) fails `install` instead of writing a broken workspace.

`mahler doctor` validates the overlay and warns if a profile allows a skill that
is not installed. See `.harness/custom/README.md` (written on install) for a
short in-tree reference.

## Manual Dogfood Checklist

Use this checklist when validating Mahler against a real Linear issue from a
fresh Codex or Claude session.

1. Start with a clean product workspace that contains at least one child git
   repository with a committed `main` or `master` branch.

2. Build Mahler and install it into the product workspace.

   ```sh
   npm install
   npm run build
   node "$(pwd)/dist/src/cli.js" install /path/to/product-workspace \
     --linear-assignee <agent-username> --linear-label agent
   node "$(pwd)/dist/src/cli.js" doctor /path/to/product-workspace
   ```

   Expected result: `doctor` exits 0 and reports configured repos, policies,
   Codex skills, Codex agents, Claude skills, Claude agents, root instruction
   files, and adapter docs as present.

3. Confirm the generated file tree in the product workspace.

   ```text
   AGENTS.md
   CLAUDE.md
   WORKFLOW.md
   .harness/config.json
   .harness/policies/
   .harness/agents/profiles/
   .harness/agents/codex/HARNESS.md
   .harness/agents/claude/HARNESS.md
   .agents/skills/<skill>/SKILL.md
   .codex/agents/<profile>.toml
   .claude/skills/<skill>/SKILL.md
   .claude/agents/<profile>.md
   ```

4. Start a fresh Codex or Claude session in `/path/to/product-workspace`.
   Prompt it with a real Linear issue:

   ```text
   work on MAH-5
   ```

   Expected result: the agent follows the generated native instructions, reads
   the active profile and native `work-on-issue` skill, fetches Linear metadata
   through Linear MCP, writes issue metadata under `.harness/tmp/linear/`, and
   invokes the configured Mahler command with `issue <ISSUE> --agent
   <codex|claude> --linear-file <issue.json>`.

5. Confirm the issue brief was created.

   ```text
   .harness/issues/<ISSUE>/
   .harness/issues/<ISSUE>/TASK.md
   .harness/issues/<ISSUE>/AGENT_SESSION.md
   .harness/issues/<ISSUE>/HANDOFF.md
   .harness/issues/<ISSUE>/linear-issue.json
   ```

   Expected command output includes `Issue brief ready:`, the recommended
   worktree root, configured repo guidance, and a suggested launch command for
   after the agent creates a repo worktree. `TASK.md` should name `linear-file`
   as the Linear source, `AGENT_SESSION.md` should name the active profile and
   configured repos, and `HANDOFF.md` should begin in a not-started state.

6. Confirm the agent, not Mahler, chooses worktrees and branches.

   The agent should create only the repo worktrees needed by the task,
   preferably under:

   ```text
   workspaces/issues/<ISSUE>/repos/<repo>/
   ```

   Branch names should follow `.harness/policies/branching.md`; Mahler does
   not force the branch name to the issue identifier.

7. Verify runtime ownership.

   Runtime orchestration happens through the generated native skills and agent
   definitions: `.agents/skills/`, `.codex/agents/`, `.claude/skills/`, and
   `.claude/agents/`. Mahler intentionally does not own separate CLI workflow
   commands for review, commit, or PR behavior; those prompts route through the
   generated native skills and shared policies.

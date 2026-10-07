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

### Model tiers

`models` in `.harness/config.json` controls which model and reasoning effort
each agent runs on, per runtime. It holds only this install's **changes** to
Mahler's defaults, so later default changes (a new model, say) still reach the
install; reinstall keeps your changes and drops any entry identical to a
default. `.harness/MODELS.md` (generated on install) shows the result.

- `models.tiers.<tier>.<claude|codex>` sets `model` and/or `effort`; unset
  fields inherit the parent session. An entry you write for a runtime replaces
  that runtime's default entry; `null` removes a default tier or a runtime's
  entry. Defaults:

  | Tier | Claude | Codex |
  |---|---|---|
  | `trivial` | haiku, high | gpt-6-luna, high |
  | `light` | sonnet, high | gpt-6.1-sol, medium |
  | `standard` | opus, medium | gpt-6.1-sol, high |
  | `deep` | opus, high | gpt-6-astra, high |

- `inherit` is a reserved tier: run on the launching session's model. The
  `composer` and `conductor` profiles default to it so a session keeps the
  model the human picked; the `reviewer`, only ever a sub-agent, defaults to
  `light`.
- `models.profiles.<profile>` sets `default` (written into the generated agent
  definition) and `allowed` (tiers a parent may pick per launch with the
  `delegate` skill); either field replaces the default's, and `null` removes
  the profile's tiers. Neither runtime reliably applies a launch-time effort
  (Claude's agent tool can't set one; Codex applies an agent's own settings
  over spawn values), so install also writes a `<profile>-<tier>` agent in
  `.claude/agents/` and `.codex/agents/` for each other allowed tier (for
  example `conductor-deep`), and parents pick a tier by agent name. Removing a
  tier from `allowed` and reinstalling removes its agents. A tier entry left
  empty for a runtime runs on the launching session's model there.
- A tier may hand the role to something else instead of a model: `skill`
  invokes a runtime skill, `agent` launches a runtime agent type. For example,
  to route Claude reviews to Codex while Codex sessions review natively:

  ```json
  "tiers": {
    "cross-check": {
      "claude": { "skill": "codex:review" },
      "codex": { "effort": "high" }
    }
  },
  "profiles": {
    "reviewer": { "default": "cross-check", "allowed": ["light", "standard", "cross-check"] }
  }
  ```

  The tier applies only to profiles that list it, so no review-skill override
  is needed.

`mahler doctor` warns about undefined tiers and invalid effort values.

### Concurrency

`concurrency` in `.harness/config.json` caps parallel work on this machine (like
`models`, it stores only your changes to the defaults):
`maxIssueAgents` (conductors per composer), `maxSliceAgents` (slice conductors
per conductor), `maxHeavyCommands` (full test suites, builds, or `mahler check`
at once), and `loadPerCore` (the 1-minute load per core above which agents hold
new work). `mahler capacity` prints the caps, the current load, and an
ok/busy verdict; agents run it before launching parallel work. Reinstall
preserves these values.

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

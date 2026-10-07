# Installing Mahler Into a Product Workspace

These instructions are written for an agent asked to install Mahler in a
directory.

## Recommended: a pinned global install

Install a tagged release globally. npm copies it into the global
`node_modules`, so it doesn't change when someone works in a Mahler checkout,
and every workspace can use `mahler` as its command. Each release on GitHub
carries the built CLI as a tarball (attached by the Release workflow when a
`v*` tag is pushed):

```sh
npm install -g https://github.com/gdamron/mahler/releases/download/v2026.10.0/mahler-2026.10.0.tgz
mahler --version
```

Don't use `npm install -g github:gdamron/mahler#<tag>`: npm installs a global
git dependency's build tools in the wrong place, so its build fails with
`tsc: command not found`. Without a release asset, build the tarball first:
`npm pack github:gdamron/mahler#<tag>`, then `npm install -g ./mahler-<version>.tgz`.

Then install into each product workspace and verify:

```sh
mahler install /path/to/product-workspace --linear-assignee <username> --linear-label agent
mahler doctor /path/to/product-workspace
```

`mahlerCommand` in `.harness/config.json` defaults to `mahler`, which is what
generated instructions tell agents to run.

### Upgrading

Install the new tag, then reinstall every workspace so its skills, policies,
and agents match the CLI:

```sh
npm install -g https://github.com/gdamron/mahler/releases/download/<tag>/mahler-<version>.tgz
mahler install /path/to/product-workspace
```

Versions are date-based, `<year>.<month>.<n>`: `n` counts releases within the
month from 0, and the month has no leading zero (npm rejects one), so January
2027's first release is `2027.1.0`. To cut a release, set `version` in
`package.json`, merge, then push a matching tag
(`git tag v2026.10.1 && git push origin v2026.10.1`). The Release
workflow runs the tests, checks the tag matches the version, and attaches the
tarball.

Install records the generating version in `.harness/install.json`;
`mahler doctor` warns when it differs from the running CLI, which catches a
CLI upgrade whose workspaces weren't reinstalled. Reinstall keeps the
human-set parts of `.harness/config.json` (see
[What reinstall keeps](#what-reinstall-keeps)).

## Alternative: run from a checkout

Use this when developing Mahler, or when a global install isn't allowed. A
workspace then runs whatever that checkout has built, so pointing a long-lived
workspace at a checkout you also develop in will change its behavior as you
switch branches.

### Steps

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
   block, and the human-set parts of `.harness/config.json` (see
   [What reinstall keeps](#what-reinstall-keeps)).

4. Verify the install with `mahler doctor`.

   ```sh
   node "$(pwd)/dist/src/cli.js" doctor /path/to/product-workspace
   ```

   The command exits non-zero with clear messages if config, repos,
   policies, skills, profiles, or adapter docs are missing. Treat a zero
   exit as the install gate.

5. Tell agents how to run this checkout's CLI: edit
   `/path/to/product-workspace/.harness/config.json`, set `mahlerCommand` to
   `node /absolute/path/to/mahler/dist/src/cli.js`, and rerun install so the
   generated instructions use it. (`npm link` also puts `mahler` on `PATH`,
   but as a link to the checkout, so it has the same drift.)

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
  invokes a runtime skill agents can call, `agent` launches a runtime agent
  type, and `command` runs a shell command whose output is the role's result
  (`<worktree>` and `<base>` placeholders are filled from the brief). A
  user-only slash command such as `/codex:review` can't be a `skill` route;
  call what it runs instead. For example, to have Claude sessions get their
  reviews from Codex through the Codex plugin's companion script, while Codex
  sessions review natively:

  ```json
  "tiers": {
    "cross-check": {
      "claude": {
        "command": "node \"$(ls -d ~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs | sort -V | tail -1)\" review --wait --cwd <worktree> --base <base>"
      },
      "codex": { "model": "gpt-6.1-sol", "effort": "high" }
    }
  },
  "profiles": {
    "reviewer": { "default": "cross-check", "allowed": ["trivial", "light", "standard", "deep", "cross-check"] }
  }
  ```

  The tier applies only to profiles that list it, so no review-policy override
  is needed. If the command can't run, the delegate skill falls back to another
  allowed tier.

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

### Guardrails and Definition of Done

`guardrails` (Tier 3 limits the forge and CI enforce, declared so agents can
anticipate them) and `definitionOfDone` (the team baseline every issue meets)
in `.harness/config.json` also store only your changes to Mahler's defaults,
so a guardrail or checklist item Mahler adds later still reaches the install:

```json
"guardrails": {
  "add": ["Deploys need on-call sign-off (enforced by the deploy tool)."],
  "remove": ["PRs larger than about 1000 lines should be split into smaller, stacked PRs."]
},
"definitionOfDone": { "add": ["Release notes are drafted."], "remove": [] }
```

`add` entries follow the defaults; `remove` drops a default by its exact text.
The effective lists appear in the `AGENTS.md` / `CLAUDE.md` block and in each
issue's `TASK.md` and `AGENT_SESSION.md`. A config from before this format,
which holds the whole list, is read as additions: entries that aren't current
defaults are kept, retired defaults are dropped, and newer defaults are added.

### What reinstall keeps

`mahler install` regenerates `.harness/config.json` on every run. It keeps:

- `mahlerCommand`, `workspaceDir`, and the Linear filters (a
  `--linear-assignee` or `--linear-label` flag replaces its filter);
- each repo's `checks`, `merge` labels, and the `models`, `concurrency`,
  `guardrails`, and `definitionOfDone` overrides;
- each runtime's `profile` and `role` under `agents` (for example, switching
  Claude's default profile from `composer` to `conductor`), plus whole entries
  for runtimes Mahler doesn't define. Each runtime's `skills` and `policies`
  lists are refreshed from Mahler's defaults; use the custom overlay to change
  what a profile may do.

The repo list itself is rediscovered on every run.

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

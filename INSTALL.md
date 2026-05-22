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
   - generated `workspaces/`

   Do not copy `src/`, `tests/`, `package.json`, `tsconfig.json`, or other
   Mahler source files into the product workspace unless intentionally
   vendoring the tool.

   The `.harness/` directory contains installed policies, skills, agent
   profiles, and runtime-specific adapter instructions. Policies are
   canonical rules, skills compose policies into workflows, and profiles
   define which skills an agent role may use.

## After Install

Start a fresh agent in the product workspace and prompt it normally:

```text
work on FUG-123
```

or:

```text
work on project X in Linear
```

The installed instructions tell the agent to resolve Linear context, create
or select the issue workspace, and work only inside that workspace.

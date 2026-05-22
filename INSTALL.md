# Installing Mahler Into a Product Workspace

These instructions are written for an agent asked to install Mahler in a
directory.

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
   npm link
   ```

3. Install Mahler into the product workspace.

   ```sh
   mahler install /path/to/product-workspace --linear-assignee <username> --linear-label agent
   ```

   Mahler scans the product workspace for immediate child git repositories and
   writes them into `.harness/config.json`. If the human has not provided a
   Linear username or label, install without those flags and leave the filters
   empty until they can be configured.

4. Ensure future agent sessions can run Mahler.

   Prefer adding the built CLI to `PATH`, for example with `npm link`, or record
   the absolute command path in `/path/to/product-workspace/.harness/config.json`.

5. Keep only operational files in the product workspace.

   The installed product workspace should contain:
   - `WORKFLOW.md`
   - `.harness/`
   - generated `workspaces/`

   Do not copy `src/`, `tests/`, `package.json`, `tsconfig.json`, or other
   Mahler source files into the product workspace unless intentionally
   vendoring the tool.

   The `.harness/` directory contains installed policies, skills, agent
   profiles, and runtime-specific adapter instructions. Policies are canonical
   rules, skills compose policies into workflows, and profiles define which
   skills an agent role may use.

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
select the issue workspace, and work only inside that workspace.

# Installing Harness Into a Product Workspace

These instructions are written for an agent asked to install the harness in a
directory.

## Steps

1. Clone the harness repository into a tools or temporary location.

   ```sh
   git clone <harness-repo-url> harness
   cd harness
   ```

2. Install dependencies and build the CLI.

   ```sh
   npm install
   npm run build
   ```

3. Install the harness into the product workspace.

   ```sh
   node dist/src/cli.js install /path/to/product-workspace
   ```

4. Ensure future agent sessions can run the harness.

   Prefer adding the built CLI to `PATH`, for example with `npm link`, or record
   the absolute command path in `/path/to/product-workspace/.harness/config.json`.

5. Keep only operational files in the product workspace.

   The installed product workspace should contain:

   - `WORKFLOW.md`
   - `.harness/`
   - generated `workspaces/`

   Do not copy `src/`, `tests/`, `package.json`, `tsconfig.json`, or other
   harness source files into the product workspace unless intentionally
   vendoring the tool.

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

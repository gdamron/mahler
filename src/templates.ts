import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { repoRoot } from "./util.js";

// ---------------------------------------------------------------------------
// Markdown templates
//
// Generated markdown lives in `templates/<name>.md` at the Mahler source root,
// next to `policies/`, `skills/`, and `agents/`. Templates use `{{key}}`
// placeholders; every placeholder must be supplied, so a typo fails loudly
// instead of leaking `{{...}}` into an installed workspace.
// ---------------------------------------------------------------------------

export function renderTemplate(
  name: string,
  vars: Record<string, string> = {},
): string {
  const path = resolve(repoRoot(), "templates", `${name}.md`);
  return readFileSync(path, "utf8").replace(
    /\{\{(\w+)\}\}/g,
    (_, key: string) => {
      const value = vars[key];
      if (value === undefined) {
        throw new Error(`Template ${name}.md has no value for {{${key}}}`);
      }
      return value;
    },
  );
}

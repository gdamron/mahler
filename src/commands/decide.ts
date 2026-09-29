import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { type Flags, required, stringFlag, workspaceFlag } from "../args.js";
import { renderTemplate } from "../templates.js";
import { ensureDir, slugify, writeFileEnsured } from "../util.js";

export function decide(flags: Flags): void {
  const workspace = workspaceFlag(flags);
  const rule = required(
    stringFlag(flags, "rule"),
    "--rule is required (the Tier-1 norm you are deviating from, e.g. skill-outside-profile, commit-size, scope)",
  );
  const reason = required(
    stringFlag(flags, "reason"),
    "--reason is required (what you decided and why it improves outcome, safety, or efficiency)",
  );
  const issue = stringFlag(flags, "issue") ?? "unassigned";
  const agent = stringFlag(flags, "agent") ?? "unknown";
  const date = new Date().toISOString().slice(0, 10);
  const slug = slugify(stringFlag(flags, "slug") ?? rule) || "deviation";
  const dir = resolve(workspace, ".harness", "decisions");
  ensureDir(dir);
  const path = uniqueDecisionPath(dir, date, slug);
  writeFileEnsured(
    path,
    renderTemplate("decision-note", {
      date,
      issue,
      agent,
      rule,
      reason: reason.trim(),
    }),
  );
  console.log(`Recorded decision: ${path}`);
  console.log(
    `Reference it from the issue's HANDOFF.md under "Workflow Deviations". This ledger is append-only — never edit or delete entries.`,
  );
}

/** First non-colliding `<date>-<slug>.md` path in `dir`, suffixing -2, -3, … so appends never overwrite. */
function uniqueDecisionPath(dir: string, date: string, slug: string): string {
  const base = `${date}-${slug}`;
  let candidate = resolve(dir, `${base}.md`);
  let counter = 2;
  while (existsSync(candidate)) {
    candidate = resolve(dir, `${base}-${counter}.md`);
    counter += 1;
  }
  return candidate;
}

import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { type Flags, required, stringFlag, workspaceFlag } from "../args.js";
import { loadConfig } from "../config.js";
import { decisionsDir, ledgerIndex } from "../knowledge.js";
import { syncLedger } from "../knowledge-repo.js";
import type { HarnessConfig } from "../types.js";
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
  const description = stringFlag(flags, "description")?.replace(/\s+/g, " ").trim();
  const issue = stringFlag(flags, "issue") ?? "unassigned";
  const agent = stringFlag(flags, "agent") ?? "unknown";
  const date = new Date().toISOString().slice(0, 10);
  const slug = slugify(stringFlag(flags, "slug") ?? rule) || "deviation";
  const dir = decisionsDir(workspace);
  ensureDir(dir);
  const path = uniqueDecisionPath(dir, date, slug);
  writeFileEnsured(
    path,
    renderTemplate("decision-note", {
      date,
      issue,
      agent,
      rule,
      description: description ? `\ndescription: ${JSON.stringify(description)}` : "",
      reason: reason.trim(),
    }),
  );
  writeFileEnsured(resolve(dir, "INDEX.md"), ledgerIndex(dir));
  console.log(`Recorded decision: ${path}`);
  console.log(
    `Reference it from the issue's HANDOFF.md under "Workflow Deviations". This ledger is append-only — never edit or delete entries.`,
  );
  publishLedger(workspace, loadConfig(workspace), `decisions: add ${basename(path, ".md")}`, path);
}

/**
 * With `decisions.repo`, back up what was just written. The note is saved
 * either way, so a failure only warns: the next sync pushes it.
 */
export function publishLedger(workspace: string, config: HarnessConfig, message: string, file: string): void {
  try {
    const result = syncLedger(workspace, config, { message });
    if (!result) return;
    if (result.published) console.log(result.summary);
    else console.warn(result.summary);
  } catch (error) {
    console.warn(`${file} is saved locally, but backing it up failed: ${(error as Error).message}`);
  }
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

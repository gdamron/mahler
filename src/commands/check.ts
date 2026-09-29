import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { type Flags, stringFlag, workspaceFlag } from "../args.js";
import { issuePaths, loadConfig } from "../config.js";
import type { Finding } from "../types.js";
import { abs } from "../util.js";

export function check(flags: Flags): void {
  const checkOrder = ["test", "lint", "build"] as const;
  const workspace = workspaceFlag(flags);
  const config = loadConfig(workspace);
  const repoFilter = stringFlag(flags, "repo");
  const issue = stringFlag(flags, "issue");
  let repos = config.repos;
  if (repoFilter) {
    repos = repos.filter((repo) => repo.name === repoFilter);
    if (repos.length === 0) {
      throw new Error(
        `Unknown repo "${repoFilter}". Configured repos: ${config.repos.map((repo) => repo.name).join(", ") || "(none)"}`,
      );
    }
  }
  if (repos.length === 0) {
    throw new Error(
      "No repos configured. Run `mahler install` in a workspace containing git repos or edit .harness/config.json.",
    );
  }
  console.log(
    "Running configured checks — a local mirror of what CI (Tier 3) will run.\n",
  );
  const results: Finding[] = [];
  let failures = 0;
  for (const repo of repos) {
    const cwd = issue
      ? resolve(
          issuePaths(workspace, config, issue).worktreeRoot,
          "repos",
          repo.name,
        )
      : abs(workspace, repo.path);
    if (!existsSync(cwd)) {
      results.push({
        level: "warn",
        message: `${repo.name}: skipped — no working dir at ${cwd}`,
      });
      continue;
    }
    const entries = checkOrder
      .map((name) => ({ name, command: repo.checks?.[name] }))
      .filter(
        (
          entry,
        ): entry is { name: (typeof checkOrder)[number]; command: string } =>
          Boolean(entry.command),
      );
    if (entries.length === 0) {
      results.push({
        level: "warn",
        message: `${repo.name}: no checks configured — add checks in .harness/config.json`,
      });
      continue;
    }
    for (const entry of entries) {
      console.log(
        `--- ${repo.name}/${entry.name}: ${entry.command} (in ${cwd})`,
      );
      const run = spawnSync(entry.command, {
        cwd,
        shell: true,
        stdio: "inherit",
      });
      if (run.status === 0) {
        results.push({
          level: "ok",
          message: `${repo.name}/${entry.name}: ${entry.command}`,
        });
      } else {
        failures += 1;
        results.push({
          level: "error",
          message: `${repo.name}/${entry.name}: ${entry.command} (exit ${run.status ?? "signal"})`,
        });
      }
    }
  }
  console.log("");
  for (const result of results) {
    const prefix =
      result.level === "ok"
        ? "ok  "
        : result.level === "warn"
          ? "warn"
          : "fail";
    console.log(`${prefix} ${result.message}`);
  }
  if (failures > 0) {
    console.log(
      `\n${failures} check(s) failed. CI will fail the same way — fix before opening a PR.`,
    );
    process.exit(1);
  }
  console.log(
    "\nAll configured checks passed. This mirrors CI; the forge remains the authority.",
  );
}

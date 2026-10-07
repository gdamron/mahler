import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { type Flags, stringFlag, workspaceFlag } from "../args.js";
import { issuePaths, loadConfig } from "../config.js";
import { gitCommonDir } from "../repos.js";
import type { Finding, HarnessConfig, RepoConfig } from "../types.js";
import { abs, listDirectories } from "../util.js";

/** One working directory to run a repo's checks in. */
interface CheckTarget {
  repo: RepoConfig;
  cwd: string;
  /** `repo` for the repo's own worktree, `repo (dir)` for a slice worktree. */
  label: string;
}

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
  const results: Finding[] = [];
  const targets = checkTargets(
    workspace,
    config,
    repos,
    repoFilter ? repos[0] : undefined,
    stringFlag(flags, "path"),
    issue,
    results,
  );
  console.log(
    "Running configured checks — a local mirror of what CI (Tier 3) will run.\n",
  );
  let failures = 0;
  for (const { repo, cwd, label } of targets) {
    if (!existsSync(cwd)) {
      results.push({
        level: "warn",
        message: `${label}: skipped — no working dir at ${cwd}`,
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
        message: `${label}: no checks configured — add checks in .harness/config.json`,
      });
      continue;
    }
    for (const entry of entries) {
      console.log(
        `--- ${label}/${entry.name}: ${entry.command} (in ${cwd})`,
      );
      const run = spawnSync(entry.command, {
        cwd,
        shell: true,
        stdio: "inherit",
      });
      if (run.status === 0) {
        results.push({
          level: "ok",
          message: `${label}/${entry.name}: ${entry.command}`,
        });
      } else {
        failures += 1;
        results.push({
          level: "error",
          message: `${label}/${entry.name}: ${entry.command} (exit ${run.status ?? "signal"})`,
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

/**
 * Resolves where to run checks. `--path` checks one worktree; `--issue` checks
 * every worktree under the issue's `repos/` dir, including slice worktrees
 * such as `repos/<repo>-<slice>`; otherwise each repo's own checkout.
 */
function checkTargets(
  workspace: string,
  config: HarnessConfig,
  repos: RepoConfig[],
  explicitRepo: RepoConfig | undefined,
  path: string | undefined,
  issue: string | undefined,
  results: Finding[],
): CheckTarget[] {
  if (path) {
    const cwd = resolve(path);
    if (!existsSync(cwd)) {
      throw new Error(`No working dir at ${cwd}`);
    }
    const repo = explicitRepo ?? repoForDir(workspace, repos, cwd);
    if (!repo) {
      throw new Error(
        `Cannot tell which configured repo ${cwd} belongs to. Pass --repo <name>.`,
      );
    }
    return [{ repo, cwd, label: targetLabel(repo, cwd) }];
  }
  if (!issue) {
    return repos.map((repo) => ({
      repo,
      cwd: abs(workspace, repo.path),
      label: repo.name,
    }));
  }
  const root = resolve(issuePaths(workspace, config, issue).worktreeRoot, "repos");
  const targets: CheckTarget[] = [];
  for (const dir of listDirectories(root)) {
    const cwd = resolve(root, dir);
    const repo = repoForDir(workspace, config.repos, cwd);
    if (!repo) {
      results.push({
        level: "warn",
        message: `${dir}: skipped — not a worktree of a configured repo`,
      });
      continue;
    }
    if (repos.includes(repo)) {
      targets.push({ repo, cwd, label: targetLabel(repo, cwd) });
    }
  }
  if (targets.length === 0) {
    throw new Error(
      `No worktrees to check under ${root}. Create worktrees for the repos this issue touches, or pass --path.`,
    );
  }
  return targets;
}

/** Matches a worktree to its repo by shared git dir, falling back to the dir name. */
function repoForDir(
  workspace: string,
  repos: RepoConfig[],
  dir: string,
): RepoConfig | undefined {
  const common = gitCommonDir(dir);
  if (common) {
    const match = repos.find(
      (repo) => gitCommonDir(abs(workspace, repo.path)) === common,
    );
    if (match) return match;
  }
  return repos.find((repo) => repo.name === basename(dir));
}

function targetLabel(repo: RepoConfig, cwd: string): string {
  const dir = basename(cwd);
  return dir === repo.name ? repo.name : `${repo.name} (${dir})`;
}

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, matchesGlob, resolve } from "node:path";
import { type Flags, stringFlag, workspaceFlag } from "../args.js";
import { issuePaths, loadConfig } from "../config.js";
import { repoForDir } from "../repos.js";
import { baseRef, frozenAcceptanceFindings, issueOwning, testerWorktreeFindings } from "./acceptance.js";
import type { Finding, HarnessConfig, RepoChecks, RepoConfig } from "../types.js";
import { abs, listDirectories, writeFileEnsured } from "../util.js";

/** One working directory to run a repo's checks in. */
interface CheckTarget {
  repo: RepoConfig;
  cwd: string;
  /** `repo` for the repo's own worktree, `repo (dir)` for a slice worktree. */
  label: string;
}

/** Well-known check names, run first and in this order; other names follow in config order. */
const knownCheckOrder = ["test", "lint", "typecheck", "build"];

/**
 * Splits a repo's configured checks into the ones to run, in run order, and
 * the names skipped because they have no runnable command, so none is dropped
 * silently.
 */
export function plannedChecks(checks: RepoChecks | undefined): {
  entries: { name: string; command: string }[];
  skipped: string[];
} {
  const configured = Object.keys(checks ?? {});
  const names = [
    ...knownCheckOrder.filter((name) => configured.includes(name)),
    ...configured.filter((name) => !knownCheckOrder.includes(name)),
  ];
  const entries: { name: string; command: string }[] = [];
  const skipped: string[] = [];
  for (const name of names) {
    const command = checks?.[name];
    if (typeof command === "string" && command.trim() !== "") {
      entries.push({ name, command });
    } else {
      skipped.push(name);
    }
  }
  return { entries, skipped };
}

export function check(flags: Flags): void {
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
  const fresh = flags.fresh === true;
  const cache = readPassCache(workspace);
  for (const { repo, cwd, label } of targets) {
    if (!existsSync(cwd)) {
      results.push({
        level: "warn",
        message: `${label}: skipped — no working dir at ${cwd}`,
      });
      continue;
    }
    const { entries, skipped } = plannedChecks(repo.checks);
    for (const name of skipped) {
      results.push({
        level: "warn",
        message: `${label}/${name}: skipped — configured without a command; set a shell command or remove it from .harness/config.json`,
      });
    }
    for (const finding of frozenAcceptanceFindings(workspace, config, repo, cwd, label, issue)) {
      if (finding.level === "error") failures += 1;
      results.push(finding);
    }
    const humanPaths = humanReviewChanges(workspace, config, repo, cwd);
    if (humanPaths.length > 0) {
      results.push({
        level: "info",
        message: `${label}: changes paths in merge.humanReviewPaths, so a human merges this PR unless an agent-merge label pre-approves it: ${humanPaths.join(", ")}`,
      });
    }
    if (entries.length === 0) {
      results.push({
        level: "warn",
        message: `${label}: no checks configured — add checks in .harness/config.json`,
      });
      continue;
    }
    // One tree per target: a check that passes can't dirty it for the next.
    const tree = cleanTree(cwd);
    for (const entry of entries) {
      const key = tree ? passKey(repo, entry.command, tree) : undefined;
      const passedAt = key && !fresh ? cache[key] : undefined;
      if (passedAt) {
        results.push({
          level: "ok",
          message: `${label}/${entry.name}: ${entry.command} (not rerun: passed on this exact tree at ${passedAt}; --fresh reruns it)`,
        });
        continue;
      }
      console.log(
        `--- ${label}/${entry.name}: ${entry.command} (in ${cwd})`,
      );
      const run = spawnSync(entry.command, {
        cwd,
        shell: true,
        stdio: "inherit",
      });
      if (run.status === 0) {
        if (key) {
          cache[key] = new Date().toISOString();
          writePassCache(workspace, cache);
        }
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
  const pathFlag = stringFlag(flags, "path");
  const owner = issue ?? (pathFlag ? issueOwning(workspace, config, resolve(pathFlag)) : undefined);
  if (owner) {
    for (const finding of testerWorktreeFindings(workspace, config, owner, repos)) {
      if (finding.level === "error") failures += 1;
      results.push(finding);
    }
  }
  console.log("");
  for (const result of results) {
    const prefix =
      result.level === "ok"
        ? "ok  "
        : result.level === "warn"
          ? "warn"
          : result.level === "info"
            ? "info"
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

/** Passing checks, keyed by repo, command, and tree: `key -> when it passed`. */
type PassCache = Record<string, string>;

const passCacheDays = 14;

function passCachePath(workspace: string): string {
  return resolve(workspace, ".harness", "tmp", "check-cache.json");
}

function readPassCache(workspace: string): PassCache {
  try {
    const parsed = JSON.parse(readFileSync(passCachePath(workspace), "utf8")) as PassCache;
    const cutoff = Date.now() - passCacheDays * 24 * 60 * 60 * 1000;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, at]) => typeof at === "string" && Date.parse(at) >= cutoff),
    );
  } catch {
    return {};
  }
}

function writePassCache(workspace: string, cache: PassCache): void {
  writeFileEnsured(passCachePath(workspace), `${JSON.stringify(cache, null, 2)}\n`);
}

/**
 * The tree id of HEAD when the worktree has nothing uncommitted or untracked,
 * so the id says exactly what a check would run on. A rebase that leaves the
 * content alone keeps the id; any change to a tracked file changes it.
 */
function cleanTree(cwd: string): string | undefined {
  const tree = spawnSync("git", ["rev-parse", "--verify", "--quiet", "HEAD^{tree}"], { cwd, encoding: "utf8" });
  if (tree.status !== 0) return undefined;
  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd, encoding: "utf8" });
  if (status.status !== 0 || status.stdout.trim() !== "") return undefined;
  return tree.stdout.trim();
}

function passKey(repo: RepoConfig, command: string, tree: string): string {
  return createHash("sha256").update([repo.name, command, tree].join("\0")).digest("hex");
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

/**
 * Files changed since the branch left its base, including uncommitted ones,
 * that match `merge.humanReviewPaths`. Checking a repo's own checkout on its
 * base branch finds none.
 */
function humanReviewChanges(
  workspace: string,
  config: HarnessConfig,
  repo: RepoConfig,
  cwd: string,
): string[] {
  const patterns = config.merge.humanReviewPaths;
  if (patterns.length === 0) return [];
  return changedFiles(workspace, repo, cwd).filter((file) =>
    patterns.some((pattern) => matchesGlob(file, pattern)),
  );
}

/**
 * Repo-relative files changed since the branch in `cwd` left its base,
 * including uncommitted and untracked ones. Empty on the base branch itself.
 */
export function changedFiles(workspace: string, repo: RepoConfig, cwd: string): string[] {
  const base = spawnSync(
    "git", ["merge-base", "HEAD", baseRef(abs(workspace, repo.path), repo)],
    { cwd, encoding: "utf8" },
  );
  if (base.status !== 0) return [];
  const diff = spawnSync("git", ["diff", "--name-only", "--no-renames", base.stdout.trim()], {
    cwd,
    encoding: "utf8",
  });
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "--full-name", ":/"], {
    cwd,
    encoding: "utf8",
  });
  return [...new Set(`${diff.stdout}\n${untracked.stdout}`.split("\n").filter(Boolean))];
}

function targetLabel(repo: RepoConfig, cwd: string): string {
  const dir = basename(cwd);
  return dir === repo.name ? repo.name : `${repo.name} (${dir})`;
}

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, matchesGlob, resolve } from "node:path";
import { type Flags, stringFlag, workspaceFlag } from "../args.js";
import { issuePaths, loadConfig } from "../config.js";
import { recordEvent } from "../events.js";
import { readGit, repoForDir } from "../repos.js";
import { baseRef, frozenAcceptanceFindings, issueOwning, testerSuiteFindings, testerWorktreeFindings } from "./acceptance.js";
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
  const startedAt = Date.now();
  const timed: Array<{ check: string; ms: number; ok: boolean; cached: boolean }> = [];
  const branches: Array<{ repo: string; worktree: string; branch: string; head: string }> = [];
  const fresh = flags.fresh === true;
  const cache = readPassCache(workspace);
  let guardedUnmet = 0;
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
    for (const finding of guardedSuiteFindings(workspace, repo, cwd, label, cache, {
      run: flags.guarded === true,
      strict: flags.strict === true,
    })) {
      if (finding.level === "error") failures += 1;
      if (finding.level === "warn") guardedUnmet += 1;
      results.push(finding);
    }
    if (entries.length === 0) {
      results.push({
        level: "warn",
        message: `${label}: no checks configured — add checks in .harness/config.json`,
      });
      continue;
    }
    branches.push({
      repo: repo.name,
      worktree: basename(cwd),
      branch: readGit(cwd, ["branch", "--show-current"]),
      head: readGit(cwd, ["rev-parse", "--short=12", "HEAD"]),
    });
    // One tree per target: a check that passes can't dirty it for the next.
    const tree = cleanTree(cwd);
    for (const entry of entries) {
      const key = tree ? passKey(repo, entry.command, tree) : undefined;
      const passedAt = key && !fresh ? cache[key] : undefined;
      if (passedAt) {
        timed.push({ check: `${label}/${entry.name}`, ms: 0, ok: true, cached: true });
        results.push({
          level: "ok",
          message: `${label}/${entry.name}: ${entry.command} (not rerun: passed on this exact tree at ${passedAt}; --fresh reruns it)`,
        });
        continue;
      }
      console.log(
        `--- ${label}/${entry.name}: ${entry.command} (in ${cwd})`,
      );
      const began = Date.now();
      const run = spawnSync(entry.command, {
        cwd,
        shell: true,
        stdio: "inherit",
      });
      timed.push({ check: `${label}/${entry.name}`, ms: Date.now() - began, ok: run.status === 0, cached: false });
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
  let suiteUnmet = 0;
  if (owner) {
    const suite = testerSuiteFindings(workspace, config, owner, repos, flags.strict === true);
    suiteUnmet = suite.filter((finding) => finding.level === "warn").length;
    for (const finding of [...testerWorktreeFindings(workspace, config, owner, repos), ...suite]) {
      if (finding.level === "error") failures += 1;
      results.push(finding);
    }
  }
  if (owner) {
    recordEvent(workspace, config, owner, "check", {
      ms: Date.now() - startedAt,
      passed: failures === 0,
      checks: timed,
      branches,
    });
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
    suiteUnmet + guardedUnmet > 0
      ? `\nConfigured checks passed, but ${suiteUnmet + guardedUnmet} suite(s) that run only locally have no pass on this tree (see the warnings above); that blocks reporting PRs ready and merging. This mirrors CI; the forge remains the authority.`
      : "\nAll configured checks passed. This mirrors CI; the forge remains the authority.",
  );
}

/**
 * Findings for a repo's guarded suites: heavy suites that stay out of CI and
 * out of the everyday check. A suite is asked for only when the change in
 * `cwd` touches a path it guards; changes elsewhere don't pay for it. It
 * needs a pass on this exact tree, which `--guarded` runs and records.
 * Without one the finding is a warning, and an error with `--strict`.
 */
function guardedSuiteFindings(
  workspace: string,
  repo: RepoConfig,
  cwd: string,
  label: string,
  cache: PassCache,
  options: { run: boolean; strict: boolean },
): Finding[] {
  const suites = repo.guardedSuites ?? [];
  if (suites.length === 0) return [];
  const changed = changedFiles(workspace, repo, cwd);
  const findings: Finding[] = [];
  for (const suite of suites) {
    const touched = changed.filter((file) => suite.paths.some((pattern) => matchesGlob(file, pattern)));
    if (touched.length === 0) continue;
    const name = `${label}/${suite.name}`;
    const why = `this change touches ${touched.length} path(s) it guards (${touched.slice(0, 3).join(", ")}${touched.length > 3 ? ", ..." : ""})`;
    const tree = cleanTree(cwd);
    // Keyed apart from the everyday checks, so the same command passing as a check is not this suite's pass.
    const key = tree ? passKey(repo, `guarded:${suite.name}\0${suite.run}`, tree) : undefined;
    if (key && cache[key]) {
      findings.push({ level: "ok", message: `${name}: guarded suite passed on this exact tree at ${cache[key]}; ${why}` });
      continue;
    }
    if (!options.run) {
      findings.push({
        level: options.strict ? "error" : "warn",
        message: `${name}: guarded suite has no pass on this tree, and ${why}; ${
          tree ? "" : "commit your changes, then "
        }run it with \`mahler check --path ${cwd} --guarded\`${options.strict ? "" : " (--strict fails on this)"}`,
      });
      continue;
    }
    console.log(`--- ${name}: ${suite.run} (in ${cwd})`);
    const run = spawnSync(suite.run, { cwd, shell: true, stdio: "inherit" });
    if (run.status !== 0) {
      findings.push({ level: "error", message: `${name}: ${suite.run} (exit ${run.status ?? "signal"}); ${why}` });
    } else if (key) {
      cache[key] = new Date().toISOString();
      writePassCache(workspace, cache);
      findings.push({ level: "ok", message: `${name}: ${suite.run}; ${why}` });
    } else {
      findings.push({
        level: options.strict ? "error" : "warn",
        message: `${name}: passed, but not recorded: the worktree has uncommitted or untracked changes. Commit them and run it again`,
      });
    }
  }
  return findings;
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

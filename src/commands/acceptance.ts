import { existsSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { type Flags, stringFlag, workspaceFlag } from "../args.js";
import { issuePaths, loadConfig } from "../config.js";
import type { Finding, HarnessConfig, RepoConfig } from "../types.js";
import { recordEvent } from "../events.js";
import { repoForDir } from "../repos.js";
import { abs, listDirectories, slugify, writeFileEnsured } from "../util.js";

/**
 * Acceptance tests written by a tester, pinned by content. `mahler check`
 * fails when the copy of any of these files in the worktree the set names
 * differs from what was frozen (see policies/verification.md). The comparison
 * is by content, so a rebase or restack that leaves the files alone needs no
 * new freeze.
 */
export interface FrozenSet {
  repo: string;
  /** Full SHA the tests were frozen at. A record of where they came from. */
  commit: string;
  /** Repo-relative paths the tester added or changed. */
  files: string[];
  /**
   * Each file's git blob id at `commit`: the frozen content itself. Records
   * written before content freezes lack it and are read from `commit`.
   */
  blobs?: Record<string, string>;
  /**
   * Issue scope only: the worktree the tests are compared in. `tests/<dir>`
   * is a tester worktree under the issue's `tests/`; a bare name is a
   * worktree under `repos/`.
   */
  worktree?: string;
  frozenAt: string;
}

interface AcceptanceRecord {
  frozen: FrozenSet[];
  /**
   * Earlier freezes a re-freeze replaced, with the reason (a dispute decision)
   * and the commit of the freeze that replaced it.
   */
  history: Array<FrozenSet & { replacedAt: string; reason: string; supersededBy?: string }>;
}

interface Scope {
  kind: "issue" | "project";
  name: string;
  /** Where the scope's records live: the issue brief or the project dir. */
  dir: string;
}

const recordFile = "acceptance.json";

export function acceptance(action: string, flags: Flags): void {
  const workspace = workspaceFlag(flags);
  const config = loadConfig(workspace);
  if (action === "freeze") return freeze(workspace, config, flags);
  if (action === "manifest") {
    const path = writeManifest(workspace, config, flags);
    console.log(`Revision manifest written: ${path}`);
    return;
  }
  if (action === "run") return run(workspace, config, flags);
  throw new Error(
    `Unknown acceptance action "${action}". Expected freeze, manifest, or run.`,
  );
}

function freeze(workspace: string, config: HarnessConfig, flags: Flags): void {
  const scope = scopeFrom(workspace, config, flags);
  const repo = repoNamed(config, stringFlag(flags, "repo"));
  const commitArg = stringFlag(flags, "commit");
  if (!commitArg) throw new Error("--commit <sha> or --commit <base>..<sha> is required");
  if (scope.kind === "project" && stringFlag(flags, "worktree")) {
    throw new Error("--worktree applies to issue freezes only; a project freeze applies to every worktree that contains its commit.");
  }
  const source = abs(workspace, repo.path);
  const commit = frozenCommit(source, commitArg);
  const reposRoot = scope.kind === "issue" ? issueReposRoot(workspace, config, scope.name) : undefined;
  const record = readRecord(scope.dir);
  const worktree = reposRoot
    ? worktreeFlagKey(reposRoot, stringFlag(flags, "worktree") ?? defaultWorktreeKey(reposRoot, record, repo))
    : undefined;
  const now = new Date().toISOString();
  // Older records may key the same worktree by a path; they match it too.
  const existing = record.frozen.filter(
    (set) =>
      set.repo === repo.name &&
      (reposRoot ? storedWorktreeKey(reposRoot, set, repo) === worktree : set.worktree === undefined),
  );
  const reason = stringFlag(flags, "reason");
  if (existing.length > 0 && !reason) {
    throw new Error(
      `${scope.kind} ${scope.name} already has acceptance tests frozen in ${repo.name} at ${existing[0].commit.slice(0, 12)}. Changing them needs a dispute decision: pass --reason with it (see the verification policy). A rebase or restack that leaves the files unchanged needs no new freeze.`,
    );
  }
  const dropped = (stringFlag(flags, "drop") ?? "").split(",").map((file) => file.trim()).filter(Boolean);
  const changed = frozenFiles(source, commitArg, commit, existing.length > 0);
  // A re-freeze pins the whole suite at the new commit, not only what that commit changed.
  const carried = [...new Set(existing.flatMap((set) => set.files))].filter((file) => !changed.includes(file));
  const files = [...carried, ...changed].filter((file) => !dropped.includes(file));
  const gone = files.filter((file) => !existsAt(source, commit, file));
  if (gone.length > 0) {
    throw new Error(
      `${gone.join(", ")} ${gone.length === 1 ? "is" : "are"} frozen for ${scope.kind} ${scope.name} but missing at ${commit.slice(0, 12)}. Freeze a commit that has ${gone.length === 1 ? "it" : "them"}, or, if the dispute decision removes ${gone.length === 1 ? "it" : "them"}, pass --drop ${gone.join(",")}.`,
    );
  }
  if (files.length === 0) {
    throw new Error(`Nothing left to freeze in ${repo.name} at ${commit.slice(0, 12)}.`);
  }
  for (const set of existing) {
    record.history.push({ ...set, replacedAt: now, reason: reason ?? "", supersededBy: commit });
  }
  record.frozen = record.frozen.filter((set) => !existing.includes(set));
  record.frozen.push({
    repo: repo.name,
    commit,
    files,
    blobs: Object.fromEntries(files.map((file) => [file, gitOrThrow(source, ["rev-parse", "--verify", `${commit}:${file}`])])),
    ...(worktree ? { worktree } : {}),
    frozenAt: now,
  });
  writeFileEnsured(resolve(scope.dir, recordFile), `${JSON.stringify(record, null, 2)}\n`);
  if (scope.kind === "issue") {
    recordEvent(workspace, config, scope.name, "freeze", {
      repo: repo.name,
      files: files.length,
      refreeze: existing.length > 0,
      ...(reason ? { reason } : {}),
    });
  }
  console.log(
    `Froze ${files.length} acceptance file(s) in ${repo.name} at ${commit.slice(0, 12)} for ${scope.kind} ${scope.name}${worktree && worktree !== repo.name ? ` (worktree ${worktree})` : ""}:`,
  );
  for (const file of files) console.log(`- ${file}${carried.includes(file) ? " (from the previous freeze)" : ""}`);
  const droppedFrozen = dropped.filter((file) => existing.some((set) => set.files.includes(file)));
  for (const file of droppedFrozen) console.log(`Dropped from the freeze: ${file}`);
  if (existing.length > 0) {
    console.log(`Replaced the freeze at ${existing.map((set) => set.commit.slice(0, 12)).join(", ")}; it is kept in history.`);
  }
  console.log(
    worktree
      ? `\`mahler check --issue ${scope.name}\` now fails if ${worktreeLabel(worktree)} changes them.`
      : "`mahler check` now fails if a checked worktree changes them.",
  );
}

const testsPrefix = "tests/";

/** `tests/<dir>` for a tester worktree's key, `repos/<dir>` for an issue worktree's. */
function worktreeLabel(key: string): string {
  return key.startsWith(testsPrefix) ? key : `repos/${key}`;
}

/**
 * Where a freeze applies when `--worktree` isn't given: the worktree the
 * issue's one existing freeze for this repo names, else the tester worktree
 * `tests/<repo>` when it exists, else the issue worktree `repos/<repo>`.
 */
function defaultWorktreeKey(reposRoot: string, record: AcceptanceRecord, repo: RepoConfig): string {
  const existing = record.frozen.filter((set) => set.repo === repo.name);
  if (existing.length === 1) return storedWorktreeKey(reposRoot, existing[0], repo);
  return existsSync(resolve(reposRoot, "..", "tests", repo.name)) ? `${testsPrefix}${repo.name}` : repo.name;
}

/** Where an issue's worktrees live: `<workspaceDir>/issues/<ISSUE>/repos`. */
function issueReposRoot(workspace: string, config: HarnessConfig, issue: string): string {
  return resolve(issuePaths(workspace, config, issue).worktreeRoot, "repos");
}

/**
 * The key `mahler check` matches an issue freeze by: `tests/<dir>` for a
 * tester worktree under the issue's `tests/`, or the directory name of a
 * worktree under its `repos/`. A path to a worktree becomes its key, so one
 * worktree never gets two freezes.
 */
function worktreeFlagKey(reposRoot: string, value: string): string {
  const trimmed = value.trim().replace(/[\\/]+$/, "");
  if (!isAbsolute(trimmed) && !/[\\/]/.test(trimmed)) return trimmed;
  const testsRoot = resolve(reposRoot, "..", "tests");
  const literal = /^tests[\\/]([^\\/]+)$/.exec(trimmed);
  if (literal) return `${testsPrefix}${literal[1]}`;
  const tester = keyUnder(testsRoot, resolve(trimmed));
  if (tester) return `${testsPrefix}${tester}`;
  const key = keyUnder(reposRoot, resolve(trimmed));
  if (!key) {
    throw new Error(
      `--worktree ${value} is not a worktree of this issue (under ${reposRoot} or ${testsRoot}). Pass tests/<dir> for a tester worktree, or the directory name of one under repos/, such as ${basename(trimmed)}.`,
    );
  }
  return key;
}

/** A stored freeze's worktree key, reading an older path-valued key as its directory name. */
function storedWorktreeKey(reposRoot: string, set: FrozenSet, repo: RepoConfig): string {
  const value = set.worktree ?? repo.name;
  return isAbsolute(value) ? (keyUnder(reposRoot, value) ?? value) : value;
}

/**
 * Frozen files whose content in the worktree at `cwd` differs from the
 * freeze, or that are missing there. Reads the working tree, so uncommitted
 * edits count. `undefined` when the frozen content can't be determined: an
 * older record without blob ids whose commit is gone.
 */
function changedFrozenFiles(cwd: string, set: FrozenSet): string[] | undefined {
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).stdout.trim() || cwd;
  const changed: string[] = [];
  for (const file of set.files) {
    let expected = set.blobs?.[file];
    if (!expected) {
      const at = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${set.commit}:${file}`], { cwd: top, encoding: "utf8" });
      if (at.status !== 0) return undefined;
      expected = at.stdout.trim();
    }
    const actual = existsSync(resolve(top, file))
      ? spawnSync("git", ["hash-object", "--", file], { cwd: top, encoding: "utf8" }).stdout.trim()
      : "";
    if (actual !== expected) changed.push(file);
  }
  return changed;
}

function comparison(cwd: string, label: string, set: FrozenSet, scope: string): Finding {
  const short = set.commit.slice(0, 12);
  const changed = changedFrozenFiles(cwd, set);
  if (changed === undefined) {
    return {
      level: "error",
      message: `${label}: cannot compare frozen acceptance tests for ${scope} (commit ${short} not found)`,
    };
  }
  return changed.length === 0
    ? { level: "ok", message: `${label}: ${set.files.length} frozen acceptance file(s) for ${scope} match ${short}` }
    : {
        level: "error",
        message: `${label}: frozen acceptance tests for ${scope} differ from ${short} (missing or changed: ${changed.join(", ")}); only the tester changes them, after a dispute decision`,
      };
}

/**
 * Findings for an issue's freezes that live in tester worktrees
 * (`<issue root>/tests/<dir>`), which `mahler check` doesn't run checks in:
 * the suite never joins the issue branch, so it is compared where it is.
 */
export function testerWorktreeFindings(
  workspace: string,
  config: HarnessConfig,
  issue: string,
  repos: RepoConfig[],
): Finding[] {
  const reposRoot = issueReposRoot(workspace, config, issue);
  const findings: Finding[] = [];
  for (const set of readRecord(issuePaths(workspace, config, issue).meta).frozen) {
    const repo = repos.find((candidate) => candidate.name === set.repo);
    if (!repo) continue;
    const key = storedWorktreeKey(reposRoot, set, repo);
    if (!key.startsWith(testsPrefix)) continue;
    const cwd = resolve(reposRoot, "..", key);
    const label = `${repo.name} (${key})`;
    findings.push(
      existsSync(cwd)
        ? comparison(cwd, label, set, `issue ${issue}`)
        : {
            level: "warn",
            message: `${label}: the tester worktree is gone, so issue ${issue}'s frozen acceptance tests were not compared`,
          },
    );
  }
  return findings;
}

/** The issue a `--path` worktree belongs to, when it sits under an issue's `repos/`. */
export function issueOwning(workspace: string, config: HarnessConfig, dir: string): string | undefined {
  return issueForDir(workspace, config, dir);
}

/** The first directory of `path` under `root`, comparing real paths too (macOS /var is /private/var). */
function keyUnder(root: string, path: string): string | undefined {
  const real = (value: string) => (existsSync(value) ? realpathSync(value) : value);
  for (const [from, to] of [[root, path], [real(root), real(path)]]) {
    const rel = relative(from, to);
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel.split(sep)[0];
  }
  return undefined;
}

function existsAt(source: string, commit: string, file: string): boolean {
  return spawnSync("git", ["cat-file", "-e", `${commit}:${file}`], { cwd: source }).status === 0;
}

/**
 * Writes the revision manifest the acceptance suite runs against: for an
 * issue, each repo's issue worktree when it has one and its base branch
 * otherwise; for a project, every repo's base branch.
 */
function writeManifest(workspace: string, config: HarnessConfig, flags: Flags): string {
  const issue = stringFlag(flags, "issue");
  const project = stringFlag(flags, "project");
  if (!issue && !project) throw new Error("Pass --issue <ISSUE> or --project <slug>.");
  const worktrees = issue ? issueWorktrees(workspace, config, issue, flags) : new Map<string, string>();
  const repos: Record<string, { rev: string; from: "worktree" | "base"; ref?: string; path?: string }> = {};
  for (const repo of config.repos) {
    const worktree = worktrees.get(repo.name);
    if (worktree) {
      repos[repo.name] = {
        rev: gitOrThrow(worktree, ["rev-parse", "HEAD"]),
        from: "worktree",
        path: worktree,
      };
      continue;
    }
    const source = abs(workspace, repo.path);
    const ref = baseRef(source, repo);
    repos[repo.name] = {
      rev: gitOrThrow(source, ["rev-parse", "--verify", `${ref}^{commit}`]),
      from: "base",
      ref,
    };
  }
  const manifest = {
    generatedAt: new Date().toISOString(),
    ...(issue ? { issue } : {}),
    ...(project ? { project: slugify(project) } : {}),
    repos,
  };
  const dir = issue
    ? issuePaths(workspace, config, issue).meta
    : resolve(workspace, ".harness", "projects", slugify(project ?? ""));
  const path = resolve(stringFlag(flags, "out") ?? resolve(dir, "acceptance-manifest.json"));
  writeFileEnsured(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return path;
}

function run(workspace: string, config: HarnessConfig, flags: Flags): void {
  const { repo: name, run: command } = config.acceptance;
  if (!name || !command) {
    throw new Error(
      "No acceptance suite configured. Set `acceptance.repo` and `acceptance.run` in .harness/config.json (see the verification policy).",
    );
  }
  const repo = repoNamed(config, name);
  const project = stringFlag(flags, "project");
  if (command.includes("<project>") && !project) {
    throw new Error("`acceptance.run` uses <project>: pass --project <slug>.");
  }
  const manifest = writeManifest(workspace, config, flags);
  const issue = stringFlag(flags, "issue");
  const issueCheckout = issue
    ? issueWorktrees(workspace, config, issue, flags).get(repo.name)
    : undefined;
  const cwd = issueCheckout ?? abs(workspace, repo.path);
  if (!issueCheckout) {
    const branch = spawnSync("git", ["branch", "--show-current"], { cwd, encoding: "utf8" }).stdout.trim();
    if (branch !== repo.baseBranch) {
      console.log(`warn: running the suite from ${cwd} on "${branch || "a detached HEAD"}", not ${repo.baseBranch}.`);
    }
  }
  const filled = command
    .replaceAll("<manifest>", shellQuote(manifest))
    .replaceAll("<project>", shellQuote(slugify(project ?? "")));
  console.log(`--- acceptance: ${filled} (in ${cwd})`);
  const began = Date.now();
  const result = spawnSync(filled, { cwd, shell: true, stdio: "inherit" });
  if (issue) {
    recordEvent(workspace, config, issue, "acceptance-run", {
      ms: Date.now() - began,
      passed: result.status === 0,
      ...(project ? { project: slugify(project) } : {}),
    });
  }
  if (result.status !== 0) {
    console.log(`\nAcceptance suite failed (exit ${result.status ?? "signal"}).`);
    process.exit(1);
  }
  console.log("\nAcceptance suite passed.");
}

/**
 * Frozen-acceptance findings for one checked worktree. An issue's own sets
 * apply to the worktree they name; a project's sets apply to any worktree of
 * their repo that already contains the frozen commit.
 */
export function frozenAcceptanceFindings(
  workspace: string,
  config: HarnessConfig,
  repo: RepoConfig,
  cwd: string,
  label: string,
  issue: string | undefined,
): Finding[] {
  const findings: Finding[] = [];
  const owner = issue ?? issueForDir(workspace, config, cwd);
  const sets: Array<{ set: FrozenSet; scope: string }> = [];
  if (owner) {
    const reposRoot = issueReposRoot(workspace, config, owner);
    // Freezes in a tester worktree are compared there (testerWorktreeFindings).
    const own = readRecord(issuePaths(workspace, config, owner).meta).frozen
      .filter((set) => set.repo === repo.name && !storedWorktreeKey(reposRoot, set, repo).startsWith(testsPrefix));
    const matched = own.filter((set) => storedWorktreeKey(reposRoot, set, repo) === basename(cwd));
    for (const set of matched) sets.push({ set, scope: `issue ${owner}` });
    if (own.length > 0 && matched.length === 0) {
      findings.push({
        level: "warn",
        message: `${label}: issue ${owner} has acceptance tests frozen in ${repo.name} for ${own.map((set) => storedWorktreeKey(reposRoot, set, repo)).join(", ")}, not ${basename(cwd)}; they were not compared here`,
      });
    }
  }
  const projects = resolve(workspace, ".harness", "projects");
  for (const project of listDirectories(projects)) {
    for (const set of readRecord(resolve(projects, project)).frozen) {
      if (set.repo !== repo.name) continue;
      const contains = spawnSync(
        "git", ["merge-base", "--is-ancestor", set.commit, "HEAD"], { cwd },
      );
      if (contains.status === 0) sets.push({ set, scope: `project ${project}` });
    }
  }
  for (const { set, scope } of sets) findings.push(comparison(cwd, label, set, scope));
  return findings;
}

/** The issue whose worktree root contains `dir`, if any. */
function issueForDir(workspace: string, config: HarnessConfig, dir: string): string | undefined {
  const root = resolve(workspace, config.workspaceDir, "issues");
  const rel = relative(root, resolve(dir));
  if (!rel || rel.startsWith("..")) return undefined;
  const [issue, repos] = rel.split(sep);
  return repos === "repos" ? issue : undefined;
}

/** The commit a `--commit <sha>` or `--commit <base>..<sha>` freeze pins. */
function frozenCommit(source: string, commitArg: string): string {
  const [from, to] = splitRange(commitArg);
  if (from !== undefined && (!from || !to)) {
    throw new Error(`--commit ${commitArg}: a range needs both ends, as in <base>..<sha>.`);
  }
  return gitOrThrow(source, ["rev-parse", "--verify", `${to}^{commit}`]);
}

/**
 * Files the tester added or changed. A range counts only the range's own
 * commits (from the merge base), so base-branch changes made after the
 * tester branched are not frozen. A merge commit counts against its first
 * parent.
 */
function frozenFiles(source: string, commitArg: string, commit: string, refreeze: boolean): string[] {
  const [from] = splitRange(commitArg);
  const parents = gitOrThrow(source, ["rev-list", "--parents", "-n", "1", commit]).split(" ").length - 1;
  const listed = from
    ? gitOrThrow(source, ["diff", "--name-only", "--no-renames", "--diff-filter=AM", `${from}...${commit}`])
    : parents === 0
      ? gitOrThrow(source, ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", "--diff-filter=AM", commit])
      : gitOrThrow(source, ["diff", "--name-only", "--no-renames", "--diff-filter=AM", `${commit}^1`, commit]);
  const files = listed.split("\n").filter(Boolean);
  if (files.length === 0 && !refreeze) {
    throw new Error(`${commitArg} adds or changes no files; nothing to freeze.`);
  }
  return files;
}

function splitRange(commitArg: string): [string | undefined, string] {
  const match = /^(.*?)\.\.\.?(.*)$/.exec(commitArg);
  return match ? [match[1], match[2]] : [undefined, commitArg];
}

/**
 * Each repo's worktree for an issue. A repo with several worktrees (slices)
 * needs `--worktree <dir>[,<dir>...]` to say which one to test.
 */
function issueWorktrees(
  workspace: string,
  config: HarnessConfig,
  issue: string,
  flags: Flags,
): Map<string, string> {
  const root = resolve(issuePaths(workspace, config, issue).worktreeRoot, "repos");
  const picked = (stringFlag(flags, "worktree") ?? "").split(",").map((dir) => dir.trim()).filter(Boolean);
  const byRepo = new Map<string, string[]>();
  for (const dir of listDirectories(root)) {
    const repo = repoForDir(workspace, config.repos, resolve(root, dir));
    if (!repo) continue;
    byRepo.set(repo.name, [...(byRepo.get(repo.name) ?? []), dir]);
  }
  const result = new Map<string, string>();
  for (const [name, dirs] of byRepo) {
    const chosen = dirs.length === 1 ? dirs : dirs.filter((dir) => picked.includes(dir));
    if (chosen.length !== 1) {
      throw new Error(
        `Issue ${issue} has several worktrees of ${name} (${dirs.join(", ")}). Pass --worktree <dir> to pick the one to test.`,
      );
    }
    result.set(name, resolve(root, chosen[0]));
  }
  return result;
}

function scopeFrom(workspace: string, config: HarnessConfig, flags: Flags): Scope {
  const issue = stringFlag(flags, "issue");
  const project = stringFlag(flags, "project");
  if (issue && project) throw new Error("Pass --issue or --project, not both.");
  if (issue) return { kind: "issue", name: issue, dir: issuePaths(workspace, config, issue).meta };
  if (project) {
    const slug = slugify(project);
    return { kind: "project", name: slug, dir: resolve(workspace, ".harness", "projects", slug) };
  }
  throw new Error("Pass --issue <ISSUE> or --project <slug>.");
}

function repoNamed(config: HarnessConfig, name: string | undefined): RepoConfig {
  if (!name) throw new Error("--repo <name> is required");
  const repo = config.repos.find((candidate) => candidate.name === name);
  if (!repo) {
    throw new Error(
      `Unknown repo "${name}". Configured repos: ${config.repos.map((r) => r.name).join(", ") || "(none)"}`,
    );
  }
  return repo;
}

function readRecord(dir: string): AcceptanceRecord {
  const path = resolve(dir, recordFile);
  if (!existsSync(path)) return { frozen: [], history: [] };
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<AcceptanceRecord>;
  return { frozen: parsed.frozen ?? [], history: parsed.history ?? [] };
}

/** `<remote>/<base>` when the remote branch is known locally, else the local base branch. */
export function baseRef(source: string, repo: RepoConfig): string {
  const remote = `${repo.remote ?? "origin"}/${repo.baseBranch}`;
  const known = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${remote}^{commit}`], { cwd: source });
  return known.status === 0 ? remote : repo.baseBranch;
}

function gitOrThrow(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

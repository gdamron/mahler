import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, relative, resolve, sep } from "node:path";
import { type Flags, stringFlag, workspaceFlag } from "../args.js";
import { issuePaths, loadConfig } from "../config.js";
import type { Finding, HarnessConfig, RepoConfig } from "../types.js";
import { repoForDir } from "../repos.js";
import { abs, listDirectories, slugify, writeFileEnsured } from "../util.js";

/**
 * Acceptance tests written by a tester, pinned to the commit that holds them.
 * `mahler check` fails when a checked worktree's copy of any of these files
 * differs from that commit (see policies/verification.md).
 */
export interface FrozenSet {
  repo: string;
  /** Full SHA whose contents are the frozen version of `files`. */
  commit: string;
  /** Repo-relative paths the tester added or changed. */
  files: string[];
  /** Issue scope only: the worktree dir under `repos/` the tests belong to. */
  worktree?: string;
  frozenAt: string;
}

interface AcceptanceRecord {
  frozen: FrozenSet[];
  /** Earlier freezes a re-freeze replaced, with the reason (a dispute decision). */
  history: Array<FrozenSet & { replacedAt: string; reason: string }>;
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
  const source = abs(workspace, repo.path);
  const commit = frozenCommit(source, commitArg);
  const files = frozenFiles(source, commitArg, commit);
  if (files.length === 0) {
    throw new Error(`${commitArg} adds or changes no files in ${repo.name}; nothing to freeze.`);
  }
  if (scope.kind === "project" && stringFlag(flags, "worktree")) {
    throw new Error("--worktree applies to issue freezes only; a project freeze applies to every worktree that contains its commit.");
  }
  const worktree =
    scope.kind === "issue" ? (stringFlag(flags, "worktree") ?? repo.name) : undefined;
  const record = readRecord(scope.dir);
  const now = new Date().toISOString();
  const existing = record.frozen.find(
    (set) => set.repo === repo.name && set.worktree === worktree,
  );
  if (existing) {
    const reason = stringFlag(flags, "reason");
    if (!reason) {
      throw new Error(
        `${scope.kind} ${scope.name} already has acceptance tests frozen in ${repo.name} at ${existing.commit.slice(0, 12)}. Changing them needs a dispute decision: pass --reason with it (see the verification policy).`,
      );
    }
    record.history.push({ ...existing, replacedAt: now, reason });
    record.frozen = record.frozen.filter((set) => set !== existing);
  }
  record.frozen.push({
    repo: repo.name,
    commit,
    files,
    ...(worktree ? { worktree } : {}),
    frozenAt: now,
  });
  writeFileEnsured(resolve(scope.dir, recordFile), `${JSON.stringify(record, null, 2)}\n`);
  console.log(
    `Froze ${files.length} acceptance file(s) in ${repo.name} at ${commit.slice(0, 12)} for ${scope.kind} ${scope.name}:`,
  );
  for (const file of files) console.log(`- ${file}`);
  console.log("`mahler check` now fails if a checked worktree changes them.");
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
  const result = spawnSync(filled, { cwd, shell: true, stdio: "inherit" });
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
    const own = readRecord(issuePaths(workspace, config, owner).meta).frozen
      .filter((set) => set.repo === repo.name);
    const matched = own.filter((set) => (set.worktree ?? repo.name) === basename(cwd));
    for (const set of matched) sets.push({ set, scope: `issue ${owner}` });
    if (own.length > 0 && matched.length === 0) {
      findings.push({
        level: "warn",
        message: `${label}: issue ${owner} has acceptance tests frozen in ${repo.name} for ${own.map((set) => set.worktree ?? repo.name).join(", ")}, not ${basename(cwd)}; they were not compared here`,
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
  for (const { set, scope } of sets) {
    const diff = spawnSync(
      "git", ["diff", "--name-only", set.commit, "--", ...set.files.map((file) => `:(top,literal)${file}`)],
      { cwd, encoding: "utf8" },
    );
    const short = set.commit.slice(0, 12);
    if (diff.status !== 0) {
      findings.push({
        level: "error",
        message: `${label}: cannot compare frozen acceptance tests for ${scope} (commit ${short} not found)`,
      });
      continue;
    }
    const changed = diff.stdout.split("\n").filter(Boolean);
    findings.push(
      changed.length === 0
        ? { level: "ok", message: `${label}: ${set.files.length} frozen acceptance file(s) for ${scope} match ${short}` }
        : {
            level: "error",
            message: `${label}: frozen acceptance tests for ${scope} differ from ${short} (missing or changed: ${changed.join(", ")}); only the tester changes them, after a dispute decision`,
          },
    );
  }
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
function frozenFiles(source: string, commitArg: string, commit: string): string[] {
  const [from] = splitRange(commitArg);
  const parents = gitOrThrow(source, ["rev-list", "--parents", "-n", "1", commit]).split(" ").length - 1;
  const listed = from
    ? gitOrThrow(source, ["diff", "--name-only", "--no-renames", "--diff-filter=AM", `${from}...${commit}`])
    : parents === 0
      ? gitOrThrow(source, ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", "--diff-filter=AM", commit])
      : gitOrThrow(source, ["diff", "--name-only", "--no-renames", "--diff-filter=AM", `${commit}^1`, commit]);
  const files = listed.split("\n").filter(Boolean);
  if (files.length === 0) {
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

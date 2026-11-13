import { existsSync, readdirSync, realpathSync, rmdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { type Flags, workspaceFlag } from "../args.js";
import { issuePaths, loadConfig } from "../config.js";
import { gitCommonDir, readGit } from "../repos.js";
import type { Finding } from "../types.js";
import { listDirectories } from "../util.js";

/**
 * Remove an issue's worktrees once its work is merged, so finished issues stop
 * costing disk, CPU, and Spotlight indexing. Issue branches and the issue
 * brief stay. Tester worktrees under `tests/` go too, with their local
 * branches: a tester's suite never joins the issue branch (the tests worth
 * keeping were promoted into it), so the branch is deleted whether or not
 * anything contains it, and its tip is printed for recovery. A worktree with
 * uncommitted or untracked changes is kept: only the human may discard work.
 * A tester branch's remote copy is deleted only with `--remote`.
 */
export function cleanup(identifier: string, flags: Flags): void {
  const workspace = workspaceFlag(flags);
  const dryRun = flags["dry-run"] === true;
  const remote = flags.remote === true;
  const { worktreeRoot } = issuePaths(workspace, loadConfig(workspace), identifier);
  const reposDir = resolve(worktreeRoot, "repos");
  const testsDir = resolve(worktreeRoot, "tests");
  const issueDirs = listDirectories(reposDir).map((dir) => resolve(reposDir, dir));
  // Testers first: their branches are merged into the issue branches, which
  // the issue worktrees still have checked out.
  const findings = [
    ...listDirectories(testsDir).map((dir) =>
      cleanupWorktree(workspace, resolve(testsDir, dir), dryRun, { remote }),
    ),
    ...issueDirs.map((dir) => cleanupWorktree(workspace, dir, dryRun)),
  ];
  if (findings.length === 0) {
    findings.push({
      level: "info",
      message: `no worktrees under ${relative(workspace, reposDir)} or ${relative(workspace, testsDir)}`,
    });
  }
  if (!dryRun) {
    removeIfEmpty(reposDir);
    removeIfEmpty(testsDir);
    removeIfEmpty(worktreeRoot);
  }
  for (const finding of findings) {
    console.log(`${finding.level.padEnd(5)}${finding.message}`);
  }
  if (findings.some((finding) => finding.level === "error")) process.exitCode = 1;
}

/**
 * Remove one worktree. `tester` marks a tester worktree: its local branch is
 * then deleted, and its remote branch too when `tester.remote` is set.
 */
function cleanupWorktree(workspace: string, dir: string, dryRun: boolean, tester?: { remote: boolean }): Finding {
  const label = relative(workspace, dir);
  const common = gitCommonDir(dir);
  if (!common) {
    return { level: "warn", message: `${label}: not a git worktree; left in place` };
  }
  // A linked worktree has its own git dir under the common one; a main
  // checkout's git dir is the common dir (even with --separate-git-dir).
  const gitDir = readGit(dir, ["rev-parse", "--absolute-git-dir"]);
  if (!gitDir || realpathSync(gitDir) === common) {
    return { level: "warn", message: `${label}: a main checkout, not a worktree; left in place` };
  }
  // Ask for untracked files explicitly: with `status.showUntrackedFiles=no`,
  // plain status reports clean and `git worktree remove` deletes them.
  if (readGit(dir, ["status", "--porcelain", "--untracked-files=all"])) {
    return {
      level: "error",
      message: `${label}: has uncommitted or untracked changes; kept — commit, push, or ask the human before discarding`,
    };
  }
  const branch = readGit(dir, ["branch", "--show-current"]);
  // Removing a worktree drops its HEAD reflog, so commits only a detached
  // HEAD reaches would become unreachable and eligible for garbage collection.
  if (!branch && readGit(dir, ["rev-list", "-n", "1", "HEAD", "--not", "--branches", "--tags", "--remotes"])) {
    return {
      level: "error",
      message: `${label}: detached HEAD has commits on no branch, tag, or remote; kept — create a branch for them or ask the human before discarding`,
    };
  }
  // Tester branches stay local by design, so "on no remote" is only news for
  // an issue branch.
  const unpushed = branch && !tester
    ? readGit(dir, ["log", "--oneline", branch, "--not", "--remotes"])
    : "";
  const upstream = branch && tester ? testerUpstream(dir, branch) : undefined;
  const tip = branch && tester ? readGit(dir, ["rev-parse", "--short=12", "HEAD"]) : "";
  const remoteWord = upstream
    ? tester?.remote
      ? ` and ${upstream.label}`
      : `; its remote branch ${upstream.label} is left (pass --remote to delete it)`
    : "";
  const note = !branch
    ? ""
    : tester
      ? ` (branch ${branch}${tester.remote && upstream ? remoteWord : ""} would be deleted${tester.remote ? "" : remoteWord})`
      : unpushed
        ? ` (branch ${branch} has commits on no remote; the branch is kept)`
        : ` (branch ${branch} kept)`;
  if (dryRun) {
    return { level: "info", message: `${label}: would remove${note}` };
  }
  // Address the repository by its common git dir: with --separate-git-dir,
  // that dir's parent is not necessarily a checkout.
  const result = spawnSync("git", ["--git-dir", common, "worktree", "remove", dir], {
    cwd: dirname(dir),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return { level: "error", message: `${label}: git worktree remove failed: ${result.stderr.trim()}` };
  }
  if (!tester || !branch) {
    return { level: unpushed ? "warn" : "ok", message: `${label}: removed${note}` };
  }
  // -D, not -d: by design nothing contains a tester branch, least of all
  // after a squash merge. The tip is printed so the suite can be recovered
  // (`git branch <name> <tip>`) until git collects it.
  const deleted = spawnSync("git", ["--git-dir", common, "branch", "-D", branch], { encoding: "utf8" });
  if (deleted.status !== 0) {
    return {
      level: "warn",
      message: `${label}: removed (branch ${branch} could not be deleted: ${deleted.stderr.trim().split("\n")[0]}; kept)`,
    };
  }
  let remoteNote = remoteWord;
  if (upstream && tester.remote) {
    const pushed = spawnSync(
      "git", ["--git-dir", common, "push", "--quiet", upstream.remote, "--delete", upstream.branch],
      { encoding: "utf8" },
    );
    if (pushed.status !== 0) {
      return {
        level: "warn",
        message: `${label}: removed (branch ${branch} deleted, was at ${tip}; its remote branch ${upstream.label} could not be deleted: ${pushed.stderr.trim().split("\n")[0]})`,
      };
    }
    remoteNote = `; remote branch ${upstream.label} deleted`;
  }
  return { level: "ok", message: `${label}: removed (branch ${branch} deleted, was at ${tip}${remoteNote})` };
}

/** A tester branch's configured upstream, when it tracks a branch on a remote. */
function testerUpstream(dir: string, branch: string): { remote: string; branch: string; label: string } | undefined {
  const remote = readGit(dir, ["config", "--get", `branch.${branch}.remote`]);
  const merge = readGit(dir, ["config", "--get", `branch.${branch}.merge`]);
  if (!remote || remote === "." || !merge) return undefined;
  const name = merge.replace(/^refs\/heads\//, "");
  return { remote, branch: name, label: `${remote}/${name}` };
}

function removeIfEmpty(dir: string): void {
  if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
}

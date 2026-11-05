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
 * brief stay. Tester worktrees under `tests/` go too, and their local branches
 * are deleted with `git branch -d`, which refuses unmerged work. A worktree
 * with uncommitted or untracked changes is kept: only the human may discard
 * work. Remote branches are never touched.
 */
export function cleanup(identifier: string, flags: Flags): void {
  const workspace = workspaceFlag(flags);
  const dryRun = flags["dry-run"] === true;
  const { worktreeRoot } = issuePaths(workspace, loadConfig(workspace), identifier);
  const reposDir = resolve(worktreeRoot, "repos");
  const testsDir = resolve(worktreeRoot, "tests");
  const issueDirs = listDirectories(reposDir).map((dir) => resolve(reposDir, dir));
  // Testers first: their branches are merged into the issue branches, which
  // the issue worktrees still have checked out.
  const findings = [
    ...listDirectories(testsDir).map((dir) =>
      cleanupWorktree(workspace, resolve(testsDir, dir), dryRun, issueDirs),
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
 * Remove one worktree. `issueDirs` marks a tester worktree: its branch is then
 * deleted locally if one of those worktrees (or the main checkout) reaches it.
 */
function cleanupWorktree(workspace: string, dir: string, dryRun: boolean, issueDirs?: string[]): Finding {
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
  const tester = issueDirs !== undefined;
  // Tester branches stay local by design, so "on no remote" is only news for
  // an issue branch.
  const unpushed = branch && !tester
    ? readGit(dir, ["log", "--oneline", branch, "--not", "--remotes"])
    : "";
  const upstream = branch && tester ? readGit(dir, ["rev-parse", "--abbrev-ref", `${branch}@{upstream}`]) : "";
  const note = !branch
    ? ""
    : tester
      ? ` (branch ${branch} would be deleted if merged)`
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
  const remoteNote = upstream ? `; its remote branch ${upstream} is left for the human` : "";
  const refusal = deleteMergedBranch(common, branch, issueDirs);
  if (refusal === undefined) {
    return { level: "ok", message: `${label}: removed (branch ${branch} deleted${remoteNote})` };
  }
  const why = /not fully merged/i.test(refusal)
    ? "is not merged into the issue branch or the main checkout's HEAD"
    : `could not be deleted: ${refusal.split("\n")[0]}`;
  return {
    level: "warn",
    message: `${label}: removed (branch ${branch} ${why}; kept — check its commits landed, or ask the human before deleting it${remoteNote})`,
  };
}

/**
 * Delete a branch with `git branch -d`, which refuses one that HEAD (or the
 * branch's upstream) doesn't reach. Tries each issue worktree of the same
 * repository, whose HEAD is the issue branch the tester's work was merged
 * into, then the main checkout. Returns git's last refusal, or `undefined`
 * once deleted. Never deletes a remote branch.
 */
function deleteMergedBranch(common: string, branch: string, issueDirs: string[]): string | undefined {
  const places = [
    ...issueDirs.filter((dir) => gitCommonDir(dir) === common).map((dir) => ["-C", dir]),
    ["--git-dir", common],
  ];
  let refusal = "";
  for (const place of places) {
    const result = spawnSync("git", [...place, "branch", "-d", branch], { encoding: "utf8" });
    if (result.status === 0) return undefined;
    refusal = result.stderr.trim();
  }
  return refusal;
}

function removeIfEmpty(dir: string): void {
  if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
}

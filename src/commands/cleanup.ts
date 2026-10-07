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
 * costing disk, CPU, and Spotlight indexing. Branches and the issue brief stay.
 * A worktree with uncommitted or untracked changes is kept: only the human may
 * discard work.
 */
export function cleanup(identifier: string, flags: Flags): void {
  const workspace = workspaceFlag(flags);
  const dryRun = flags["dry-run"] === true;
  const { worktreeRoot } = issuePaths(workspace, loadConfig(workspace), identifier);
  const reposDir = resolve(worktreeRoot, "repos");
  const findings = listDirectories(reposDir).map((dir) =>
    cleanupWorktree(workspace, resolve(reposDir, dir), dryRun),
  );
  if (findings.length === 0) {
    findings.push({ level: "info", message: `no worktrees under ${relative(workspace, reposDir)}` });
  }
  if (!dryRun) removeIfEmpty(reposDir) && removeIfEmpty(worktreeRoot);
  for (const finding of findings) {
    console.log(`${finding.level.padEnd(5)}${finding.message}`);
  }
  if (findings.some((finding) => finding.level === "error")) process.exitCode = 1;
}

function cleanupWorktree(workspace: string, dir: string, dryRun: boolean): Finding {
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
  const unpushed = branch
    ? readGit(dir, ["log", "--oneline", branch, "--not", "--remotes"])
    : "";
  const note = unpushed
    ? ` (branch ${branch} has commits on no remote; the branch is kept)`
    : branch
      ? ` (branch ${branch} kept)`
      : "";
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
  return { level: unpushed ? "warn" : "ok", message: `${label}: removed${note}` };
}

function removeIfEmpty(dir: string): boolean {
  if (!existsSync(dir) || readdirSync(dir).length > 0) return false;
  rmdirSync(dir);
  return true;
}

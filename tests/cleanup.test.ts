import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { spotlightFinding } from "../src/spotlight.js";

const git = (cwd: string, args: string[]) =>
  spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

/** A workspace whose `app` repo has two worktrees for MAH-1: `app` and `app-docs`. */
function workspaceWithWorktrees(): { workspace: string; app: string; repos: string } {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-cleanup-"));
  const app = resolve(workspace, "app");
  spawnSync("git", ["init", "-q", "-b", "main", app]);
  writeFileSync(resolve(app, ".gitignore"), "node_modules/\n");
  git(app, ["add", "."]);
  git(app, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init"]);
  assert.equal(spawnSync("node", ["dist/src/cli.js", "install", workspace]).status, 0);
  const repos = resolve(workspace, "workspaces", "issues", "MAH-1", "repos");
  mkdirSync(repos, { recursive: true });
  for (const [dir, branch] of [["app", "mah-1-core"], ["app-docs", "mah-1-docs"]]) {
    assert.equal(git(app, ["worktree", "add", "-q", "-b", branch, resolve(repos, dir)]).status, 0);
  }
  return { workspace, app, repos };
}

function runCleanup(workspace: string, extra: string[] = []) {
  return spawnSync("node", ["dist/src/cli.js", "cleanup", "MAH-1", "--workspace", workspace, ...extra], {
    encoding: "utf8",
  });
}

test("cleanup removes clean worktrees, ignored installs included, and keeps branches", () => {
  const { workspace, app, repos } = workspaceWithWorktrees();
  mkdirSync(resolve(repos, "app", "node_modules", "dep"), { recursive: true });
  writeFileSync(resolve(repos, "app", "node_modules", "dep", "index.js"), "");

  const result = runCleanup(workspace);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /app: removed/);
  assert.equal(existsSync(resolve(workspace, "workspaces", "issues", "MAH-1")), false);
  assert.match(git(app, ["branch", "--list", "mah-1-*"]).stdout, /mah-1-core[\s\S]*mah-1-docs/);
  // The brief is history, not a worktree.
  assert.equal(existsSync(resolve(workspace, ".harness")), true);
});

test("cleanup keeps a worktree with uncommitted changes and exits non-zero", () => {
  const { workspace, repos } = workspaceWithWorktrees();
  writeFileSync(resolve(repos, "app-docs", "draft.md"), "unsaved work\n");

  const result = runCleanup(workspace);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /app-docs: has uncommitted or untracked changes; kept/);
  assert.equal(existsSync(resolve(repos, "app-docs", "draft.md")), true);
  assert.equal(existsSync(resolve(repos, "app")), false, "clean siblings are still removed");
});

test("cleanup --dry-run reports without removing", () => {
  const { workspace, repos } = workspaceWithWorktrees();
  const result = runCleanup(workspace, ["--dry-run"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /app: would remove/);
  assert.equal(existsSync(resolve(repos, "app")), true);
});

test("cleanup keeps a detached worktree whose commits no branch reaches", () => {
  const { workspace, repos } = workspaceWithWorktrees();
  const wt = resolve(repos, "app-docs");
  git(wt, ["checkout", "-q", "--detach"]);
  git(wt, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "orphan"]);

  const result = runCleanup(workspace);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /app-docs: detached HEAD has commits on no branch, tag, or remote; kept/);
  assert.equal(existsSync(wt), true);
});

test("cleanup removes worktrees of a repo with a separate git dir", () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-cleanup-sep-"));
  const app = resolve(workspace, "app");
  spawnSync("git", ["init", "-q", "-b", "main", `--separate-git-dir=${resolve(workspace, "store.git")}`, app]);
  git(app, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"]);
  assert.equal(spawnSync("node", ["dist/src/cli.js", "install", workspace]).status, 0);
  const wt = resolve(workspace, "workspaces", "issues", "MAH-1", "repos", "app");
  mkdirSync(resolve(wt, ".."), { recursive: true });
  assert.equal(git(app, ["worktree", "add", "-q", "-b", "mah-1", wt]).status, 0);

  const result = runCleanup(workspace);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /app: removed/);
  assert.equal(existsSync(wt), false);
});

test("spotlightFinding is ok at zero and warns with the fix otherwise", () => {
  assert.equal(spotlightFinding("/w/workspaces", "workspaces", 0)?.level, "ok");
  const warn = spotlightFinding("/w/workspaces", "workspaces", 1234);
  assert.equal(warn?.level, "warn");
  assert.match(warn?.message ?? "", /1234 items under workspaces\//);
  assert.match(warn?.message ?? "", /Search Privacy/);
  assert.equal(spotlightFinding("/w/workspaces", "workspaces", undefined), undefined);
});

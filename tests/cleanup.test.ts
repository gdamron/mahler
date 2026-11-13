import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { spotlightFinding, spotlightIndexedCount } from "../src/spotlight.js";

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

test("cleanup sees untracked files even when git is configured to hide them", () => {
  const { workspace, app, repos } = workspaceWithWorktrees();
  git(app, ["config", "status.showUntrackedFiles", "no"]);
  writeFileSync(resolve(repos, "app", "notes.md"), "untracked work\n");

  const result = runCleanup(workspace);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /app: has uncommitted or untracked changes; kept/);
  assert.equal(existsSync(resolve(repos, "app", "notes.md")), true);
});

test("spotlightIndexedCount skips the check when mdfind can't run", () => {
  const path = process.env.PATH;
  process.env.PATH = "";
  try {
    assert.equal(spotlightIndexedCount(tmpdir()), undefined);
  } finally {
    process.env.PATH = path;
  }
});

test("cleanup --dry-run reports without removing", () => {
  const { workspace, repos } = workspaceWithWorktrees();
  const result = runCleanup(workspace, ["--dry-run"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /app: would remove/);
  assert.equal(existsSync(resolve(repos, "app")), true);
});

for (const extra of [["--help"], ["-h"], ["--dry-run", "--help"]]) {
  test(`cleanup <ISSUE> ${extra.join(" ")} prints usage and touches nothing`, () => {
    const { workspace, app, repos } = workspaceWithWorktrees();
    const before = git(app, ["worktree", "list", "--porcelain"]).stdout;

    const result = runCleanup(workspace, extra);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^Usage: mahler cleanup <ISSUE>/);
    assert.doesNotMatch(result.stdout, /^(ok|info|warn|error) /m, "cleanup reported results");
    assert.equal(existsSync(resolve(repos, "app")), true);
    assert.equal(existsSync(resolve(repos, "app-docs")), true);
    assert.equal(git(app, ["worktree", "list", "--porcelain"]).stdout, before);
  });
}

for (const extra of [["--force"], ["--dry-run", "yes"], ["extra"], ["-n"], ["--workspace"]]) {
  test(`cleanup refuses ${extra.join(" ")} and touches nothing`, () => {
    const { workspace, repos } = workspaceWithWorktrees();
    const result = runCleanup(workspace, extra);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /unknown option|unexpected argument|needs a value|given twice/);
    assert.match(result.stderr, /Usage: mahler cleanup <ISSUE>/);
    assert.equal(result.stdout, "");
    assert.equal(existsSync(resolve(repos, "app")), true);
    assert.equal(existsSync(resolve(repos, "app-docs")), true);
  });
}

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

const commit = (cwd: string, message: string) =>
  git(cwd, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", message]);

/** Adds MAH-1's tester worktree `tests/app` on `mah-1-acceptance`, with one commit. */
function addTester(app: string, workspace: string): string {
  const tests = resolve(workspace, "workspaces", "issues", "MAH-1", "tests", "app");
  mkdirSync(resolve(tests, ".."), { recursive: true });
  assert.equal(git(app, ["worktree", "add", "-q", "-b", "mah-1-acceptance", tests, "main"]).status, 0);
  writeFileSync(resolve(tests, "acceptance.test.js"), "// AC1\n");
  git(tests, ["add", "."]);
  commit(tests, "Add acceptance tests");
  return tests;
}

test("cleanup removes a tester worktree and deletes its branch, which nothing contains", () => {
  const { workspace, app } = workspaceWithWorktrees();
  const tests = addTester(app, workspace);
  const tip = git(tests, ["rev-parse", "--short=12", "HEAD"]).stdout.trim();

  const dry = runCleanup(workspace, ["--dry-run"]);
  assert.match(dry.stdout, /tests\/app: would remove \(branch mah-1-acceptance would be deleted\)/);
  assert.equal(existsSync(tests), true);

  const result = runCleanup(workspace);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(
    result.stdout,
    new RegExp(`^ok   .*tests/app: removed \\(branch mah-1-acceptance deleted, was at ${tip}\\)$`, "m"),
  );
  assert.equal(existsSync(resolve(workspace, "workspaces", "issues", "MAH-1")), false);
  assert.equal(git(app, ["branch", "--list", "mah-1-acceptance"]).stdout, "");
  assert.match(git(app, ["branch", "--list", "mah-1-*"]).stdout, /mah-1-core[\s\S]*mah-1-docs/);
  // The suite stays recoverable from the printed tip until git collects it.
  assert.equal(git(app, ["cat-file", "-e", `${tip}^{commit}`]).status, 0);
});

test("cleanup keeps a tester worktree with uncommitted changes", () => {
  const { workspace, app } = workspaceWithWorktrees();
  const tests = addTester(app, workspace);
  writeFileSync(resolve(tests, "draft.test.js"), "// AC2\n");

  const result = runCleanup(workspace);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /tests\/app: has uncommitted or untracked changes; kept/);
  assert.equal(existsSync(resolve(tests, "draft.test.js")), true);
  assert.match(git(app, ["branch", "--list", "mah-1-acceptance"]).stdout, /mah-1-acceptance/);
});

/** A tester worktree whose branch was pushed to a bare `origin`. */
function pushedTester(): { workspace: string; app: string } {
  const { workspace, app } = workspaceWithWorktrees();
  const remote = resolve(workspace, "remote.git");
  spawnSync("git", ["init", "-q", "--bare", remote]);
  git(app, ["remote", "add", "origin", remote]);
  const tests = addTester(app, workspace);
  assert.equal(git(tests, ["push", "-q", "-u", "origin", "mah-1-acceptance"]).status, 0);
  return { workspace, app };
}

test("cleanup leaves a pushed tester branch on the remote unless asked", () => {
  const { workspace, app } = pushedTester();

  const result = runCleanup(workspace);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(
    result.stdout,
    /tests\/app: removed \(branch mah-1-acceptance deleted, was at [0-9a-f]{12}; its remote branch origin\/mah-1-acceptance is left \(pass --remote to delete it\)\)/,
  );
  assert.equal(git(app, ["branch", "--list", "mah-1-acceptance"]).stdout, "");
  assert.match(git(app, ["ls-remote", "--heads", "origin"]).stdout, /refs\/heads\/mah-1-acceptance/);
});

test("cleanup --remote deletes a pushed tester branch from its remote, and no issue branch", () => {
  const { workspace, app } = pushedTester();
  assert.equal(git(app, ["push", "-q", "origin", "mah-1-core"]).status, 0);

  const dry = runCleanup(workspace, ["--dry-run", "--remote"]);
  assert.match(dry.stdout, /tests\/app: would remove \(branch mah-1-acceptance and origin\/mah-1-acceptance would be deleted\)/);

  const result = runCleanup(workspace, ["--remote"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /tests\/app: removed \(branch mah-1-acceptance deleted, was at [0-9a-f]{12}; remote branch origin\/mah-1-acceptance deleted\)/);
  const heads = git(app, ["ls-remote", "--heads", "origin"]).stdout;
  assert.doesNotMatch(heads, /mah-1-acceptance/);
  assert.match(heads, /refs\/heads\/mah-1-core/);
});

test("spotlightFinding is ok at zero and warns with the fix otherwise", () => {
  assert.equal(spotlightFinding("/w/workspaces", "workspaces", 0)?.level, "ok");
  const warn = spotlightFinding("/w/workspaces", "workspaces", 1234);
  assert.equal(warn?.level, "warn");
  assert.match(warn?.message ?? "", /1234 items under workspaces\//);
  assert.match(warn?.message ?? "", /Search Privacy/);
  assert.equal(spotlightFinding("/w/workspaces", "workspaces", undefined), undefined);
});

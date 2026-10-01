import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { HarnessConfig } from "../src/types.js";

const cli = ["node", "dist/src/cli.js"] as const;

function installWorkspaceWithRepo(scripts: Record<string, string> | undefined): string {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-check-"));
  const repoDir = resolve(workspace, "app");
  spawnSync("git", ["init", "-q", "-b", "main", repoDir]);
  if (scripts) {
    writeFileSync(resolve(repoDir, "package.json"), `${JSON.stringify({ name: "app", scripts }, null, 2)}\n`);
  }
  const result = spawnSync(cli[0], [cli[1], "install", workspace], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return workspace;
}

function loadConfig(workspace: string): HarnessConfig {
  return JSON.parse(readFileSync(resolve(workspace, ".harness", "config.json"), "utf8")) as HarnessConfig;
}

function saveConfig(workspace: string, config: HarnessConfig): void {
  writeFileSync(resolve(workspace, ".harness", "config.json"), `${JSON.stringify(config, null, 2)}\n`);
}

function runCheck(workspace: string, extra: string[] = []): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(cli[0], [cli[1], "check", "--workspace", workspace, ...extra], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("install populates checks from package.json scripts", () => {
  const workspace = installWorkspaceWithRepo({ test: "node -e \"process.exit(0)\"", lint: "node -e \"process.exit(0)\"" });
  const config = loadConfig(workspace);
  assert.equal(config.repos[0].checks?.test, "npm test");
  assert.equal(config.repos[0].checks?.lint, "npm run lint");
  assert.equal(config.repos[0].checks?.build, undefined);
});

test("install leaves checks unset when repo has no package.json", () => {
  const workspace = installWorkspaceWithRepo(undefined);
  const config = loadConfig(workspace);
  assert.equal(config.repos[0].checks, undefined);
});

test("check exits 0 and prints ok when configured checks pass", () => {
  const workspace = installWorkspaceWithRepo(undefined);
  const config = loadConfig(workspace);
  config.repos[0].checks = { test: "node -e \"process.exit(0)\"" };
  saveConfig(workspace, config);
  const { status, stdout } = runCheck(workspace);
  assert.equal(status, 0, stdout);
  assert.match(stdout, /ok {2}\s*app\/test/);
  assert.match(stdout, /mirrors CI/);
});

test("check exits non-zero and prints fail when a check fails", () => {
  const workspace = installWorkspaceWithRepo(undefined);
  const config = loadConfig(workspace);
  config.repos[0].checks = { test: "node -e \"process.exit(1)\"" };
  saveConfig(workspace, config);
  const { status, stdout } = runCheck(workspace);
  assert.notEqual(status, 0);
  assert.match(stdout, /fail app\/test/);
});

test("check warns but exits 0 for a repo without checks", () => {
  const workspace = installWorkspaceWithRepo(undefined);
  const { status, stdout } = runCheck(workspace);
  assert.equal(status, 0, stdout);
  assert.match(stdout, /warn app: no checks configured/);
});

test("check errors on an unknown --repo", () => {
  const workspace = installWorkspaceWithRepo(undefined);
  const { status, stderr } = runCheck(workspace, ["--repo", "nope"]);
  assert.notEqual(status, 0);
  assert.match(stderr, /Unknown repo "nope"/);
});

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t"
};

// Fails when a FAIL marker file exists in the working dir, so one worktree can fail alone.
const markerCheck = "node -e \"process.exit(require('fs').existsSync('FAIL') ? 1 : 0)\"";

/** Installs a workspace whose `app` repo has two slice worktrees for MAH-1. */
function workspaceWithSlices(): { workspace: string; repos: string } {
  const workspace = installWorkspaceWithRepo(undefined);
  const config = loadConfig(workspace);
  config.repos[0].checks = { test: markerCheck };
  saveConfig(workspace, config);
  const app = resolve(workspace, "app");
  spawnSync("git", ["-C", app, "commit", "--allow-empty", "-q", "-m", "init"], { env: gitEnv });
  const repos = resolve(workspace, "workspaces", "issues", "MAH-1", "repos");
  for (const [dir, branch] of [["app", "t/mah-1-api"], ["app-parser", "t/mah-1-parser"]]) {
    const added = spawnSync("git", ["-C", app, "worktree", "add", "-q", "-b", branch, resolve(repos, dir)], { encoding: "utf8" });
    assert.equal(added.status, 0, added.stderr);
  }
  return { workspace, repos };
}

test("check with --issue fails when the issue has no worktrees", () => {
  const workspace = installWorkspaceWithRepo(undefined);
  const config = loadConfig(workspace);
  config.repos[0].checks = { test: "node -e \"process.exit(0)\"" };
  saveConfig(workspace, config);
  const { status, stderr } = runCheck(workspace, ["--issue", "MAH-1"]);
  assert.notEqual(status, 0);
  assert.match(stderr, /No worktrees to check/);
});

test("check with --issue runs every slice worktree of a repo", () => {
  const { workspace, repos } = workspaceWithSlices();
  mkdirSync(resolve(repos, "scratch"));
  const { status, stdout } = runCheck(workspace, ["--issue", "MAH-1"]);
  assert.equal(status, 0, stdout);
  assert.match(stdout, /ok {2}\s*app\/test/);
  assert.match(stdout, /ok {2}\s*app \(app-parser\)\/test/);
  assert.match(stdout, /warn scratch: skipped — not a worktree of a configured repo/);
});

test("check with --issue fails when any slice worktree fails", () => {
  const { workspace, repos } = workspaceWithSlices();
  writeFileSync(resolve(repos, "app-parser", "FAIL"), "");
  const { status, stdout } = runCheck(workspace, ["--issue", "MAH-1"]);
  assert.notEqual(status, 0);
  assert.match(stdout, /ok {2}\s*app\/test/);
  assert.match(stdout, /fail app \(app-parser\)\/test/);
});

test("check with --path runs only that worktree and infers its repo", () => {
  const { workspace, repos } = workspaceWithSlices();
  writeFileSync(resolve(repos, "app", "FAIL"), "");
  const { status, stdout } = runCheck(workspace, ["--path", resolve(repos, "app-parser")]);
  assert.equal(status, 0, stdout);
  assert.match(stdout, /ok {2}\s*app \(app-parser\)\/test/);
  assert.doesNotMatch(stdout, /app\/test/);

  const missing = runCheck(workspace, ["--path", resolve(repos, "nope")]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /No working dir/);
});

test("doctor warns when a configured repo has no checks", () => {
  const workspace = installWorkspaceWithRepo(undefined);
  const result = spawnSync(cli[0], [cli[1], "doctor", workspace], { encoding: "utf8" });
  assert.match(result.stdout, /repo app has no checks configured/);
});

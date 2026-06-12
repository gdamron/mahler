import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

test("check with --issue runs in the issue worktree and skips missing dirs", () => {
  const workspace = installWorkspaceWithRepo(undefined);
  const config = loadConfig(workspace);
  config.repos[0].checks = { test: "node -e \"process.exit(0)\"" };
  saveConfig(workspace, config);
  const { status, stdout } = runCheck(workspace, ["--issue", "MAH-1"]);
  assert.equal(status, 0, stdout);
  assert.match(stdout, /warn app: skipped — no working dir/);
});

test("doctor warns when a configured repo has no checks", () => {
  const workspace = installWorkspaceWithRepo(undefined);
  const result = spawnSync(cli[0], [cli[1], "doctor", workspace], { encoding: "utf8" });
  assert.match(result.stdout, /repo app has no checks configured/);
});

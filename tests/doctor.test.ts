import test from "node:test";
import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const cli = ["node", "dist/src/cli.js"] as const;

function installWorkspace(): string {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-doctor-"));
  const result = spawnSync(cli[0], [cli[1], "install", workspace], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return workspace;
}

function runDoctor(workspace: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(cli[0], [cli[1], "doctor", workspace], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("doctor reports ok on a freshly installed workspace (with repos warning ignored)", () => {
  const workspace = installWorkspace();
  const { status, stdout } = runDoctor(workspace);
  assert.match(stdout, /no repos configured/);
  assert.notEqual(status, 0);
});

test("doctor exits 0 when repos are configured and everything is wired", () => {
  const workspace = installWorkspace();
  const repoDir = resolve(workspace, "app");
  spawnSync("git", ["init", "-q", "-b", "main", repoDir]);
  spawnSync("git", ["-C", repoDir, "commit", "--allow-empty", "-m", "init", "-q"], {
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }
  });
  const reinstall = spawnSync(cli[0], [cli[1], "install", workspace], { encoding: "utf8" });
  assert.equal(reinstall.status, 0, reinstall.stderr);
  const { status, stdout } = runDoctor(workspace);
  assert.equal(status, 0, stdout);
  assert.match(stdout, /repo app present/);
});

test("doctor warns (but passes) when a profile allows an uninstalled skill", () => {
  const workspace = installWorkspace();
  const repoDir = resolve(workspace, "app");
  spawnSync("git", ["init", "-q", "-b", "main", repoDir]);
  spawnSync("git", ["-C", repoDir, "commit", "--allow-empty", "-m", "init", "-q"], {
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }
  });
  const customAgents = resolve(workspace, ".harness", "custom", "agents");
  mkdirSync(customAgents, { recursive: true });
  writeFileSync(
    resolve(customAgents, "scoped.json"),
    JSON.stringify({ name: "scoped", allowedSkills: ["made-up-skill"], deniedSkills: [] }, null, 2)
  );
  const reinstall = spawnSync(cli[0], [cli[1], "install", workspace], { encoding: "utf8" });
  assert.equal(reinstall.status, 0, reinstall.stderr);
  const { status, stdout } = runDoctor(workspace);
  assert.equal(status, 0, stdout);
  assert.match(stdout, /profile scoped allowedSkills references uninstalled skill "made-up-skill"/);
});

test("doctor fails when .harness/config.json is missing", () => {
  const workspace = installWorkspace();
  rmSync(resolve(workspace, ".harness", "config.json"));
  const { status, stdout } = runDoctor(workspace);
  assert.notEqual(status, 0);
  assert.match(stdout, /missing \.harness\/config\.json/);
});

test("doctor fails when a required skill file is missing", () => {
  const workspace = installWorkspace();
  rmSync(resolve(workspace, ".agents", "skills", "work-on-issue", "SKILL.md"));
  const { status, stdout } = runDoctor(workspace);
  assert.notEqual(status, 0);
  assert.match(stdout, /missing Codex skill: \.agents\/skills\/work-on-issue\/SKILL\.md/);
});

test("doctor fails when an adapter HARNESS.md is missing required references", () => {
  const workspace = installWorkspace();
  writeFileSync(resolve(workspace, ".harness", "agents", "codex", "HARNESS.md"), "stub without references\n");
  const { status, stdout } = runDoctor(workspace);
  assert.notEqual(status, 0);
  assert.match(stdout, /adapter agents\/codex\/HARNESS\.md missing/);
});

test("install is idempotent and preserves user content in AGENTS.md", () => {
  const workspace = installWorkspace();
  const agentsPath = resolve(workspace, "AGENTS.md");
  appendFileSync(agentsPath, "\n## User notes\nHello from the human.\n");
  const second = spawnSync(cli[0], [cli[1], "install", workspace], { encoding: "utf8" });
  assert.equal(second.status, 0, second.stderr);
  const body = readFileSync(agentsPath, "utf8");
  assert.match(body, /Hello from the human\./);
  const startMatches = body.match(/<!-- HARNESS:START -->/g) ?? [];
  assert.equal(startMatches.length, 1, "harness block should not be duplicated");
});

test("doctor warns when the acceptance suite names an unknown repo or has no run command", () => {
  const workspace = installWorkspace();
  const configFile = resolve(workspace, ".harness", "config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  config.acceptance = { repo: "suite", path: "acceptance" };
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  assert.match(runDoctor(workspace).stdout, /warn acceptance\.repo "suite" is not a configured repo/);

  config.repos = [{ name: "suite", path: "suite", baseBranch: "main" }];
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  assert.match(runDoctor(workspace).stdout, /warn acceptance\.repo is "suite" but acceptance\.run is not set/);
});

test("doctor reports gh support for attachments and stacks", async () => {
  const { ghFindings } = await import("../src/commands/doctor.js");
  assert.deepEqual(ghFindings(undefined, undefined).map((f) => f.level), ["info"]);
  const current = ghFindings("gh version 2.100.0 (2026-09-03)\n", "gh stack version 0.1.0\n");
  assert.deepEqual(current.map((f) => f.level), ["ok", "ok"]);
  const old = ghFindings("gh version 2.98.1 (2026-07-01)\n", "");
  assert.equal(old[0].level, "warn");
  assert.match(old[0].message, /predates --attach/);
  assert.equal(old[1].level, "info");
  assert.equal(ghFindings("gh version 3.0.0\n", undefined)[0].level, "ok");
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const cli = ["node", "dist/src/cli.js"] as const;

function installWorkspace(): string {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-profile-"));
  const result = spawnSync(cli[0], [cli[1], "install", workspace], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return workspace;
}

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(cli[0], [cli[1], ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function setCodexProfile(workspace: string, profile: string): void {
  const configPath = resolve(workspace, ".harness", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as { agents: { codex: { profile: string } } };
  config.agents.codex.profile = profile;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

test("profile prints active profile permissions", () => {
  const workspace = installWorkspace();
  const result = run(["profile", "codex", "--workspace", workspace]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Agent: codex/);
  assert.match(result.stdout, /Profile: implementer/);
  assert.match(result.stdout, /Allowed skills: select-project-issue, work-on-issue, handoff/);
  assert.match(result.stdout, /Denied skills: commit, pr/);
});

test("can enforces allowed and denied skills", () => {
  const workspace = installWorkspace();
  const allowed = run(["can", "codex", "handoff", "--workspace", workspace]);
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.match(allowed.stdout, /codex can use handoff/);

  const denied = run(["can", "codex", "commit", "--workspace", workspace]);
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /Profile gate denied/);
  assert.match(denied.stderr, /Ask the human/);
});

test("commit and pr are allowed for committer and full-stack profiles", () => {
  const workspace = installWorkspace();
  mkdirSync(resolve(workspace, "workspaces", "issues", "MAH-4"), { recursive: true });

  setCodexProfile(workspace, "committer");
  const commit = run(["commit", "MAH-4", "--workspace", workspace, "--agent", "codex"]);
  assert.equal(commit.status, 0, commit.stderr);
  assert.match(commit.stdout, /commit workflow allowed/);

  setCodexProfile(workspace, "full-stack");
  const pr = run(["pr", "MAH-4", "--workspace", workspace, "--agent", "codex"]);
  assert.equal(pr.status, 0, pr.stderr);
  assert.match(pr.stdout, /pr workflow allowed/);
});

test("implementer profile cannot use commit workflow", () => {
  const workspace = installWorkspace();
  const result = run(["commit", "MAH-4", "--workspace", workspace, "--agent", "codex"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Profile gate denied/);
  assert.match(result.stderr, /cannot use skill "commit"/);
});

test("generated agent session records active profile details", () => {
  const workspace = installWorkspace();
  const repoDir = resolve(workspace, "app");
  spawnSync("git", ["init", "-q", "-b", "main", repoDir]);
  spawnSync("git", ["-C", repoDir, "commit", "--allow-empty", "-m", "init", "-q"], {
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }
  });
  const reinstall = run(["install", workspace]);
  assert.equal(reinstall.status, 0, reinstall.stderr);

  const issue = run(["issue", "MAH-4", "--workspace", workspace, "--agent", "codex", "--title", "Profile gate"]);
  assert.equal(issue.status, 0, issue.stderr);
  const session = readFileSync(resolve(workspace, "workspaces", "issues", "MAH-4", "AGENT_SESSION.md"), "utf8");
  assert.match(session, /Profile: implementer/);
  assert.match(session, /Allowed skills: select-project-issue, work-on-issue, handoff/);
  assert.match(session, /Denied skills: commit, pr/);
});

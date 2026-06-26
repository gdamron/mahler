import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  assert.match(result.stdout, /Profile: orchestrator/);
  assert.match(result.stdout, /Allowed skills: select-project-issue, work-on-issue, interview, review, commit, pr, handoff/);
  assert.match(result.stdout, /Denied skills: \(none\)/);
});

test("can reports allowed skills for the empowered orchestrator default", () => {
  const workspace = installWorkspace();
  // The default orchestrator is empowered to take any action, including commit.
  for (const skill of ["handoff", "commit", "pr", "review"]) {
    const allowed = run(["can", "codex", skill, "--workspace", workspace]);
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.match(allowed.stdout, new RegExp(`codex can use ${skill}`));
  }
});

test("can advises on out-of-profile skills for scoped profiles", () => {
  const workspace = installWorkspace();
  // A scoped profile (reviewer) still emits the Tier-1 advisory path.
  setCodexProfile(workspace, "reviewer");
  const outOfProfile = run(["can", "codex", "commit", "--workspace", workspace]);
  assert.equal(outOfProfile.status, 0, outOfProfile.stderr);
  assert.match(outOfProfile.stdout, /Advisory/);
  assert.match(outOfProfile.stdout, /Workflow Deviations/);
  assert.match(outOfProfile.stdout, /judgment\.md/);
  assert.match(outOfProfile.stdout, /only append a durable note/);
});

test("commit and pr diagnostics are allowed for committer and full-stack profiles", () => {
  const workspace = installWorkspace();

  setCodexProfile(workspace, "committer");
  const commit = run(["can", "codex", "commit", "--workspace", workspace]);
  assert.equal(commit.status, 0, commit.stderr);
  assert.match(commit.stdout, /codex can use commit/);

  setCodexProfile(workspace, "full-stack");
  const pr = run(["can", "codex", "pr", "--workspace", workspace]);
  assert.equal(pr.status, 0, pr.stderr);
  assert.match(pr.stdout, /codex can use pr/);
});

test("commands gated by requireSkill proceed with an advisory for out-of-profile skills", () => {
  const workspace = installWorkspace();
  const repoDir = resolve(workspace, "app");
  spawnSync("git", ["init", "-q", "-b", "main", repoDir]);
  spawnSync("git", ["-C", repoDir, "commit", "--allow-empty", "-m", "init", "-q"], {
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }
  });
  const reinstall = run(["install", workspace]);
  assert.equal(reinstall.status, 0, reinstall.stderr);

  setCodexProfile(workspace, "reviewer");
  const issue = run(["issue", "MAH-5", "--workspace", workspace, "--agent", "codex", "--title", "Advisory gate"]);
  assert.equal(issue.status, 0, issue.stderr);
  assert.match(issue.stderr, /Advisory/);
  assert.match(issue.stderr, /Workflow Deviations/);
  assert.match(issue.stdout, /Issue brief ready/);
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
  const session = readFileSync(resolve(workspace, ".harness", "issues", "MAH-4", "AGENT_SESSION.md"), "utf8");
  assert.match(session, /Profile: orchestrator/);
  assert.match(session, /Allowed skills: select-project-issue, work-on-issue, interview, review, commit, pr, handoff/);
  assert.match(session, /Denied skills: \(none\)/);
});

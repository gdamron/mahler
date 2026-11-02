import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { HarnessConfig } from "../src/types.js";

const cli = ["node", "dist/src/cli.js"] as const;
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(cli[0], [cli[1], ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: gitEnv });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function editConfig(workspace: string, change: (config: HarnessConfig) => void): void {
  const path = resolve(workspace, ".harness", "config.json");
  const config = JSON.parse(readFileSync(path, "utf8")) as HarnessConfig;
  change(config);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * A workspace with one repo `app`, a passing check, an issue worktree for
 * MAH-1, and a tester branch `tests` that adds `tests/accept.txt`.
 */
function setup(): { workspace: string; app: string; worktree: string } {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-acceptance-"));
  const app = resolve(workspace, "app");
  spawnSync("git", ["init", "-q", "-b", "main", app]);
  writeFileSync(resolve(app, "README.md"), "app\n");
  git(app, "add", ".");
  git(app, "commit", "-qm", "init");
  assert.equal(run(["install", workspace]).status, 0);
  editConfig(workspace, (config) => {
    config.repos[0].checks = { test: "node -e \"process.exit(0)\"" };
  });
  const worktree = resolve(workspace, "workspaces", "issues", "MAH-1", "repos", "app");
  git(app, "worktree", "add", "-q", "-b", "t/mah-1", worktree);
  git(app, "checkout", "-q", "-b", "tests", "main");
  mkdirSync(resolve(app, "tests"));
  writeFileSync(resolve(app, "tests", "accept.txt"), "frozen\n");
  git(app, "add", ".");
  git(app, "commit", "-qm", "acceptance tests");
  git(app, "checkout", "-q", "main");
  return { workspace, app, worktree };
}

const check = (workspace: string, issue = "MAH-1") =>
  run(["check", "--workspace", workspace, "--issue", issue]);

test("frozen acceptance tests block check until they are in the issue branch, and catch changes", () => {
  const { workspace, worktree } = setup();
  const frozen = run([
    "acceptance", "freeze", "--workspace", workspace, "--issue", "MAH-1",
    "--repo", "app", "--commit", "tests",
  ]);
  assert.equal(frozen.status, 0, frozen.stderr);
  assert.match(frozen.stdout, /Froze 1 acceptance file\(s\) in app/);
  assert.match(frozen.stdout, /- tests\/accept\.txt/);

  const missing = check(workspace);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stdout, /fail app: frozen acceptance tests for issue MAH-1 differ .*tests\/accept\.txt/);

  git(worktree, "merge", "-q", "tests");
  const passing = check(workspace);
  assert.equal(passing.status, 0, passing.stdout);
  assert.match(passing.stdout, /ok {3}app: 1 frozen acceptance file\(s\) for issue MAH-1 match/);

  writeFileSync(resolve(worktree, "tests", "accept.txt"), "loosened\n");
  const tampered = check(workspace);
  assert.notEqual(tampered.status, 0);
  assert.match(tampered.stdout, /fail app: frozen acceptance tests for issue MAH-1 differ/);
});

test("re-freezing needs a dispute reason and keeps the replaced freeze in history", () => {
  const { workspace, app } = setup();
  const args = ["acceptance", "freeze", "--workspace", workspace, "--issue", "MAH-1", "--repo", "app"];
  assert.equal(run([...args, "--commit", "tests"]).status, 0);

  git(app, "checkout", "-q", "tests");
  writeFileSync(resolve(app, "tests", "accept.txt"), "corrected\n");
  git(app, "commit", "-qam", "fix a wrong test");
  git(app, "checkout", "-q", "main");

  const refused = run([...args, "--commit", "main..tests"]);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /needs a dispute decision: pass --reason/);

  const replaced = run([...args, "--commit", "main..tests", "--reason", "composer: test assumed the wrong unit"]);
  assert.equal(replaced.status, 0, replaced.stderr);
  const record = JSON.parse(
    readFileSync(resolve(workspace, ".harness", "issues", "MAH-1", "acceptance.json"), "utf8"),
  );
  assert.equal(record.frozen.length, 1);
  assert.equal(record.frozen[0].commit, git(app, "rev-parse", "tests"));
  assert.deepEqual(record.frozen[0].files, ["tests/accept.txt"]);
  assert.equal(record.history.length, 1);
  assert.equal(record.history[0].reason, "composer: test assumed the wrong unit");
});

test("a project's frozen tests apply only to worktrees that contain them, and in a shared repo", () => {
  const { workspace, app, worktree } = setup();
  // The project's tests merge into the shared repo's base branch first.
  git(app, "merge", "-q", "tests");
  const frozen = run([
    "acceptance", "freeze", "--workspace", workspace, "--project", "Musical Time",
    "--repo", "app", "--commit", "main",
  ]);
  assert.equal(frozen.status, 0, frozen.stderr);
  assert.match(frozen.stdout, /for project musical-time/);

  // The issue branch predates the merge: the project's tests don't apply yet.
  const before = check(workspace);
  assert.equal(before.status, 0, before.stdout);
  assert.doesNotMatch(before.stdout, /project musical-time/);

  git(worktree, "merge", "-q", "main");
  writeFileSync(resolve(worktree, "tests", "accept.txt"), "edited by an implementer\n");
  const edited = check(workspace);
  assert.notEqual(edited.status, 0);
  assert.match(edited.stdout, /fail app: frozen acceptance tests for project musical-time differ/);
});

test("manifest takes issue worktrees where they exist and base branches elsewhere", () => {
  const { workspace, app, worktree } = setup();
  const api = resolve(workspace, "api");
  spawnSync("git", ["init", "-q", "-b", "main", api]);
  git(api, "commit", "--allow-empty", "-qm", "init");
  assert.equal(run(["install", workspace]).status, 0);

  const written = run(["acceptance", "manifest", "--workspace", workspace, "--issue", "MAH-1"]);
  assert.equal(written.status, 0, written.stderr);
  const manifest = JSON.parse(
    readFileSync(resolve(workspace, ".harness", "issues", "MAH-1", "acceptance-manifest.json"), "utf8"),
  );
  assert.equal(manifest.issue, "MAH-1");
  assert.deepEqual(manifest.repos.app, {
    rev: git(worktree, "rev-parse", "HEAD"),
    from: "worktree",
    path: worktree,
  });
  assert.deepEqual(manifest.repos.api, {
    rev: git(api, "rev-parse", "main"),
    from: "base",
    ref: "main",
  });
  assert.equal(git(app, "rev-parse", "main"), manifest.repos.app.rev);
});

test("acceptance run fills the manifest and project into the configured command", () => {
  const { workspace } = setup();
  const unconfigured = run(["acceptance", "run", "--workspace", workspace, "--project", "p"]);
  assert.notEqual(unconfigured.status, 0);
  assert.match(unconfigured.stderr, /No acceptance suite configured/);

  editConfig(workspace, (config) => {
    config.acceptance = {
      repo: "app",
      path: "acceptance",
      run: "node -e \"const m=require(process.argv[1]); console.log('suite', process.argv[2], Object.keys(m.repos).join(','))\" <manifest> <project>",
    };
  });
  const passed = run(["acceptance", "run", "--workspace", workspace, "--project", "Musical Time"]);
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /suite musical-time app/);
  assert.match(passed.stdout, /Acceptance suite passed/);

  editConfig(workspace, (config) => {
    config.acceptance.run = "node -e \"process.exit(3)\" <project>";
  });
  const failed = run(["acceptance", "run", "--workspace", workspace, "--project", "p"]);
  assert.notEqual(failed.status, 0);
  assert.match(failed.stdout, /Acceptance suite failed \(exit 3\)/);

  const noProject = run(["acceptance", "run", "--workspace", workspace, "--issue", "MAH-1"]);
  assert.notEqual(noProject.status, 0);
  assert.match(noProject.stderr, /uses <project>: pass --project/);
});

test("check reports changes to human-review paths", () => {
  const { workspace, worktree } = setup();
  editConfig(workspace, (config) => {
    config.merge.humanReviewPaths = ["**/migrations/**"];
  });
  mkdirSync(resolve(worktree, "db", "migrations"), { recursive: true });
  writeFileSync(resolve(worktree, "db", "migrations", "001.sql"), "drop table users;\n");
  const result = check(workspace);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /info app: changes paths in merge\.humanReviewPaths.*db\/migrations\/001\.sql/);
});

test("a range freeze takes only the tester's commits, and a merge commit counts against its first parent", () => {
  const { workspace, app } = setup();
  // The base branch moves on after the tester branched.
  writeFileSync(resolve(app, "unrelated.txt"), "base work\n");
  git(app, "add", ".");
  git(app, "commit", "-qm", "base moves on");

  const ranged = run([
    "acceptance", "freeze", "--workspace", workspace, "--issue", "MAH-1",
    "--repo", "app", "--commit", "main..tests",
  ]);
  assert.equal(ranged.status, 0, ranged.stderr);
  assert.match(ranged.stdout, /Froze 1 acceptance file/);
  assert.doesNotMatch(ranged.stdout, /unrelated\.txt/);

  git(app, "merge", "-q", "--no-ff", "-m", "merge tests", "tests");
  const merged = run([
    "acceptance", "freeze", "--workspace", workspace, "--project", "p",
    "--repo", "app", "--commit", "main",
  ]);
  assert.equal(merged.status, 0, merged.stderr);
  assert.match(merged.stdout, /- tests\/accept\.txt/);
  assert.doesNotMatch(merged.stdout, /unrelated\.txt/);

  const halfRange = run([
    "acceptance", "freeze", "--workspace", workspace, "--issue", "MAH-2",
    "--repo", "app", "--commit", "main..",
  ]);
  assert.notEqual(halfRange.status, 0);
  assert.match(halfRange.stderr, /a range needs both ends/);
});

test("manifest needs --worktree when an issue has several worktrees of one repo", () => {
  const { workspace, app, worktree } = setup();
  const slice = resolve(workspace, "workspaces", "issues", "MAH-1", "repos", "app-ui");
  git(app, "worktree", "add", "-q", "-b", "t/mah-1-ui", slice, "tests");

  const ambiguous = run(["acceptance", "manifest", "--workspace", workspace, "--issue", "MAH-1"]);
  assert.notEqual(ambiguous.status, 0);
  assert.match(ambiguous.stderr, /several worktrees of app \(app, app-ui\)\. Pass --worktree/);

  const picked = run(["acceptance", "manifest", "--workspace", workspace, "--issue", "MAH-1", "--worktree", "app-ui"]);
  assert.equal(picked.status, 0, picked.stderr);
  const manifest = JSON.parse(
    readFileSync(resolve(workspace, ".harness", "issues", "MAH-1", "acceptance-manifest.json"), "utf8"),
  );
  assert.equal(manifest.repos.app.rev, git(slice, "rev-parse", "HEAD"));
  assert.notEqual(manifest.repos.app.rev, git(worktree, "rev-parse", "HEAD"));
});

test("check warns when an issue's frozen tests belong to a different worktree", () => {
  const { workspace } = setup();
  const frozen = run([
    "acceptance", "freeze", "--workspace", workspace, "--issue", "MAH-1",
    "--repo", "app", "--commit", "tests", "--worktree", "app-ui",
  ]);
  assert.equal(frozen.status, 0, frozen.stderr);
  const result = check(workspace);
  assert.match(result.stdout, /warn app: issue MAH-1 has acceptance tests frozen in app for app-ui, not app/);
});

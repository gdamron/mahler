import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
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

const readRecord = (workspace: string, issue = "MAH-1") =>
  JSON.parse(readFileSync(resolve(workspace, ".harness", "issues", issue, "acceptance.json"), "utf8"));

/** A commit on `tests` that rewrites one acceptance file. */
function amendTest(app: string, file: string, content: string): string {
  git(app, "checkout", "-q", "tests");
  writeFileSync(resolve(app, file), content);
  git(app, "commit", "-qam", `amend ${file}`);
  git(app, "checkout", "-q", "main");
  return git(app, "rev-parse", "tests");
}

test("re-freezing with a path to the worktree replaces the freeze for that worktree", () => {
  const { workspace, app, worktree } = setup();
  const args = ["acceptance", "freeze", "--workspace", workspace, "--issue", "MAH-1", "--repo", "app"];
  assert.equal(run([...args, "--commit", "tests", "--worktree", "app"]).status, 0);
  const first = git(app, "rev-parse", "tests");

  const second = amendTest(app, "tests/accept.txt", "corrected\n");
  // The real path, as `pwd -P` gives it, which differs from the workspace path when a parent is a symlink.
  const replaced = run([...args, "--commit", second, "--worktree", realpathSync(worktree), "--reason", "test fixed after a dispute"]);
  assert.equal(replaced.status, 0, replaced.stderr);

  const record = readRecord(workspace);
  assert.equal(record.frozen.length, 1);
  assert.equal(record.frozen[0].worktree, "app");
  assert.equal(record.frozen[0].commit, second);
  assert.equal(record.history.length, 1);
  assert.equal(record.history[0].commit, first);
  assert.equal(record.history[0].supersededBy, second);
  assert.equal(record.history[0].reason, "test fixed after a dispute");

  git(worktree, "merge", "-q", "tests");
  const checked = check(workspace);
  assert.equal(checked.status, 0, checked.stdout);
  assert.match(checked.stdout, /ok {3}app: 1 frozen acceptance file\(s\) for issue MAH-1 match/);
  assert.doesNotMatch(checked.stdout, /were not compared here/);
});

test("a freeze keyed by a worktree path in an older record is compared and replaced", () => {
  const { workspace, app, worktree } = setup();
  const args = ["acceptance", "freeze", "--workspace", workspace, "--issue", "MAH-1", "--repo", "app"];
  assert.equal(run([...args, "--commit", "tests"]).status, 0);
  const path = resolve(workspace, ".harness", "issues", "MAH-1", "acceptance.json");
  const legacy = readRecord(workspace);
  legacy.frozen[0].worktree = worktree;
  writeFileSync(path, `${JSON.stringify(legacy, null, 2)}\n`);

  git(worktree, "merge", "-q", "tests");
  const checked = check(workspace);
  assert.equal(checked.status, 0, checked.stdout);
  assert.match(checked.stdout, /ok {3}app: 1 frozen acceptance file\(s\) for issue MAH-1 match/);
  assert.doesNotMatch(checked.stdout, /were not compared here/);

  const second = amendTest(app, "tests/accept.txt", "corrected\n");
  assert.equal(run([...args, "--commit", second, "--reason", "test fixed after a dispute"]).status, 0);
  const record = readRecord(workspace);
  assert.deepEqual(record.frozen.map((set: { worktree: string }) => set.worktree), ["app"]);
  assert.equal(record.history.length, 1);
  assert.equal(record.history[0].supersededBy, second);
});

test("--worktree must be a worktree of the issue", () => {
  const { workspace, app } = setup();
  const result = run([
    "acceptance", "freeze", "--workspace", workspace, "--issue", "MAH-1",
    "--repo", "app", "--commit", "tests", "--worktree", app,
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /is not a worktree of this issue/);
});

test("re-freezing at a commit that changes one file keeps the whole suite frozen", () => {
  const { workspace, app, worktree } = setup();
  const suite = ["accept.txt", ...[2, 3, 4, 5, 6, 7].map((n) => `accept-${n}.txt`)].map((name) => `tests/${name}`);
  git(app, "checkout", "-q", "tests");
  for (const file of suite.slice(1)) writeFileSync(resolve(app, file), `${file}\n`);
  git(app, "add", ".");
  git(app, "commit", "-qm", "more acceptance tests");
  git(app, "checkout", "-q", "main");
  const args = ["acceptance", "freeze", "--workspace", workspace, "--issue", "MAH-1", "--repo", "app"];
  const frozen = run([...args, "--commit", "main..tests"]);
  assert.equal(frozen.status, 0, frozen.stderr);
  assert.match(frozen.stdout, /Froze 7 acceptance file/);

  const second = amendTest(app, "tests/accept-4.txt", "corrected\n");
  const replaced = run([...args, "--commit", second, "--reason", "test fixed after a dispute"]);
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.match(replaced.stdout, /Froze 7 acceptance file/);
  const record = readRecord(workspace);
  assert.equal(record.frozen.length, 1);
  assert.equal(record.frozen[0].commit, second);
  assert.deepEqual([...record.frozen[0].files].sort(), [...suite].sort());

  git(worktree, "merge", "-q", "tests");
  const checked = check(workspace);
  assert.equal(checked.status, 0, checked.stdout);
  assert.match(checked.stdout, /ok {3}app: 7 frozen acceptance file\(s\) for issue MAH-1 match/);

  writeFileSync(resolve(worktree, "tests", "accept-2.txt"), "loosened\n");
  const tampered = check(workspace);
  assert.notEqual(tampered.status, 0);
  assert.match(tampered.stdout, /differ .*tests\/accept-2\.txt/);
});

test("re-freezing at a commit that deletes a frozen file fails unless the file is dropped", () => {
  const { workspace, app } = setup();
  git(app, "checkout", "-q", "tests");
  writeFileSync(resolve(app, "tests", "extra.txt"), "extra\n");
  git(app, "add", ".");
  git(app, "commit", "-qm", "another test");
  git(app, "checkout", "-q", "main");
  const args = ["acceptance", "freeze", "--workspace", workspace, "--issue", "MAH-1", "--repo", "app"];
  assert.equal(run([...args, "--commit", "main..tests"]).status, 0);

  git(app, "checkout", "-q", "tests");
  git(app, "rm", "-q", "tests/extra.txt");
  writeFileSync(resolve(app, "tests", "accept.txt"), "covers extra too\n");
  git(app, "commit", "-qam", "fold extra into accept");
  git(app, "checkout", "-q", "main");
  const reason = ["--reason", "extra was a duplicate"];

  const refused = run([...args, "--commit", "tests", ...reason]);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /tests\/extra\.txt is frozen for issue MAH-1 but missing at .*pass --drop tests\/extra\.txt/);
  assert.equal(readRecord(workspace).history.length, 0);

  const dropped = run([...args, "--commit", "tests", ...reason, "--drop", "tests/extra.txt"]);
  assert.equal(dropped.status, 0, dropped.stderr);
  assert.match(dropped.stdout, /Dropped from the freeze: tests\/extra\.txt/);
  const record = readRecord(workspace);
  assert.deepEqual(record.frozen[0].files, ["tests/accept.txt"]);
  assert.deepEqual([...record.history[0].files].sort(), ["tests/accept.txt", "tests/extra.txt"]);
});

/** Adds MAH-1's tester worktree `tests/app` on the `tests` branch from setup(). */
function testerWorktree(workspace: string, app: string): string {
  const tests = resolve(workspace, "workspaces", "issues", "MAH-1", "tests", "app");
  mkdirSync(resolve(tests, ".."), { recursive: true });
  git(app, "worktree", "add", "-q", tests, "tests");
  return tests;
}

test("a freeze defaults to the tester worktree, and check compares it there without the issue branch having it", () => {
  const { workspace, app, worktree } = setup();
  const tests = testerWorktree(workspace, app);
  const frozen = run([
    "acceptance", "freeze", "--workspace", workspace, "--issue", "MAH-1", "--repo", "app", "--commit", "tests",
  ]);
  assert.equal(frozen.status, 0, frozen.stderr);
  assert.match(frozen.stdout, /now fails if tests\/app changes them/);
  const [set] = readRecord(workspace).frozen;
  assert.equal(set.worktree, "tests/app");
  assert.equal(set.blobs["tests/accept.txt"], git(app, "rev-parse", "tests:tests/accept.txt"));

  // The suite never joins the issue branch, and the issue worktree isn't failed for lacking it.
  const passing = check(workspace);
  assert.equal(passing.status, 0, passing.stdout);
  assert.match(passing.stdout, /ok {3}app \(tests\/app\): 1 frozen acceptance file\(s\) for issue MAH-1 match/);
  assert.doesNotMatch(passing.stdout, /were not compared here/);

  // Running the suite against the implementation merges the issue branch into the tester's worktree.
  writeFileSync(resolve(worktree, "feature.txt"), "implementation\n");
  git(worktree, "add", ".");
  git(worktree, "commit", "-qm", "implement");
  git(tests, "merge", "-q", "--no-edit", "t/mah-1");
  assert.equal(check(workspace).status, 0);
  const byPath = run(["check", "--workspace", workspace, "--path", worktree]);
  assert.match(byPath.stdout, /ok {3}app \(tests\/app\): 1 frozen acceptance file/);

  writeFileSync(resolve(tests, "tests", "accept.txt"), "loosened, not committed\n");
  const tampered = check(workspace);
  assert.notEqual(tampered.status, 0);
  assert.match(tampered.stdout, /fail app \(tests\/app\): frozen acceptance tests for issue MAH-1 differ .*tests\/accept\.txt/);
});

test("a frozen set survives a rebase that rewrites its commit, with no new freeze", () => {
  const { workspace, app, worktree } = setup();
  const args = ["acceptance", "freeze", "--workspace", workspace, "--issue", "MAH-1", "--repo", "app"];
  git(worktree, "merge", "-q", "tests");
  assert.equal(run([...args, "--commit", "tests"]).status, 0);
  const frozenAt = readRecord(workspace).frozen[0].commit;

  // main moves, the issue branch is rebased onto it, and the frozen commit is no longer in its history.
  writeFileSync(resolve(app, "CHANGELOG.md"), "moved\n");
  git(app, "add", ".");
  git(app, "commit", "-qm", "main moves");
  git(worktree, "rebase", "-q", "main");
  assert.notEqual(spawnSync("git", ["merge-base", "--is-ancestor", frozenAt, "HEAD"], { cwd: worktree }).status, 0);

  const checked = check(workspace);
  assert.equal(checked.status, 0, checked.stdout);
  assert.match(checked.stdout, /ok {3}app: 1 frozen acceptance file\(s\) for issue MAH-1 match/);

  // Even an older record's content is read from the blob ids, not the commit.
  const path = resolve(workspace, ".harness", "issues", "MAH-1", "acceptance.json");
  const record = readRecord(workspace);
  record.frozen[0].commit = "0".repeat(40);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  assert.equal(check(workspace).status, 0);
  delete record.frozen[0].blobs;
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  assert.match(check(workspace).stdout, /fail app: cannot compare frozen acceptance tests for issue MAH-1/);
});

test("an issue with a freeze in repos/ keeps it there when a tester worktree exists", () => {
  const { workspace, app } = setup();
  const args = ["acceptance", "freeze", "--workspace", workspace, "--issue", "MAH-1", "--repo", "app"];
  assert.equal(run([...args, "--commit", "tests"]).status, 0);
  testerWorktree(workspace, app);
  git(resolve(workspace, "workspaces", "issues", "MAH-1", "tests", "app"), "commit", "-q", "--allow-empty", "-m", "dispute fix");
  assert.equal(run([...args, "--commit", "tests", "--reason", "dispute"]).status, 0);
  const record = readRecord(workspace);
  assert.deepEqual(record.frozen.map((set: { worktree: string }) => set.worktree), ["app"]);

  const explicit = run([...args, "--commit", "main..tests", "--worktree", "tests/app"]);
  assert.equal(explicit.status, 0, explicit.stderr);
  assert.deepEqual(readRecord(workspace).frozen.map((set: { worktree: string }) => set.worktree).sort(), ["app", "tests/app"]);
});

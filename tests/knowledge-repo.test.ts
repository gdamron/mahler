import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { withLock } from "../src/knowledge-repo.js";

const cliPath = resolve("dist/src/cli.js");
// Commits need an identity, and CI machines may have none.
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

function run(args: string[], extraEnv: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("node", [cliPath, ...args], { encoding: "utf8", env: { ...env, ...extraEnv } });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

/** A bare repo standing in for the shared knowledge remote. */
function remote(): string {
  const dir = resolve(mkdtempSync(resolve(tmpdir(), "mahler-remote-")), "knowledge.git");
  spawnSync("git", ["init", "-q", "--bare", "-b", "main", dir]);
  return dir;
}

/** An installed workspace with one repo, optionally switched to repo mode and reinstalled. */
function workspace(repo?: string, notes: string[] = []): string {
  const dir = mkdtempSync(resolve(tmpdir(), "mahler-ws-"));
  const app = resolve(dir, "app");
  spawnSync("git", ["init", "-q", "-b", "main", app]);
  writeFileSync(resolve(app, "README.md"), "x\n");
  git(app, ["add", "."]);
  git(app, ["commit", "-q", "-m", "init"]);
  assert.equal(run(["install", dir]).status, 0);
  for (const title of notes) assert.equal(learn(dir, title).status, 0);
  if (repo) setRepo(dir, { repo });
  return dir;
}

function setRepo(
  dir: string,
  knowledge: Record<string, string>,
  extraEnv: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string } {
  const file = resolve(dir, ".harness/config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  config.knowledge = { ...config.knowledge, ...knowledge };
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return run(["install", dir], extraEnv);
}

function learn(dir: string, title: string, extraEnv: Record<string, string> = {}) {
  return run(["learn", "--workspace", dir, "--title", title, "--description", `${title}.`], extraEnv);
}

const store = (dir: string) => resolve(dir, ".harness/knowledge");
const noteFile = (dir: string, slug: string) => resolve(store(dir), "notes", `${slug}.md`);

test("two workspaces sharing a knowledge repo each see the other's notes after sync", () => {
  const shared = remote();
  const a = workspace(shared);
  const b = workspace(shared);
  assert.ok(existsSync(resolve(store(a), ".git")), "install cloned the store");

  const first = learn(a, "Builds need the seed step");
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Knowledge sync: committed local changes; pushed 1 commit\./);
  assert.equal(git(store(a), ["log", "-1", "--format=%s"]), "knowledge: add builds-need-the-seed-step");

  const second = learn(b, "Cache keys are case-sensitive");
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /pulled 1 commit; pushed 1 commit/);
  assert.ok(existsSync(noteFile(b, "builds-need-the-seed-step")));

  const synced = run(["knowledge", "sync", "--workspace", a]);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /pulled 1 commit/);
  assert.ok(existsSync(noteFile(a, "cache-keys-are-case-sensitive")));
  assert.match(readFileSync(resolve(store(a), "INDEX.md"), "utf8"), /Cache keys are case-sensitive/);

  const tracked = git(shared, ["ls-tree", "-r", "--name-only", "main"]).split("\n");
  assert.ok(tracked.includes("notes/builds-need-the-seed-step.md"));
  assert.ok(tracked.includes("README.md"));
  assert.ok(!tracked.includes("INDEX.md"), "the generated index stays out of the repo");
  assert.match(run(["knowledge", "sync", "--workspace", a]).stdout, /already up to date/);
});

test("an offline write stays local, and the next sync rebases it onto the remote", () => {
  const shared = remote();
  const a = workspace(shared);
  const b = workspace(shared);
  const away = `${shared}.away`;
  renameSync(shared, away);
  const offline = learn(b, "Written offline");
  assert.equal(offline.status, 0, offline.stderr);
  assert.match(offline.stderr, /couldn't reach .*; run `mahler knowledge sync` later to publish/);
  renameSync(away, shared);

  assert.equal(learn(a, "Written online").status, 0);
  const synced = run(["knowledge", "sync", "--workspace", b]);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /pulled 1 commit; pushed 1 commit/);
  assert.deepEqual(
    git(shared, ["log", "--format=%s", "main"]).split("\n").slice(0, 2),
    ["knowledge: add written-offline", "knowledge: add written-online"],
  );
});

test("a conflicting edit stops the sync with the local commit kept", () => {
  const shared = remote();
  const a = workspace(shared);
  assert.equal(learn(a, "Shared fact").status, 0);
  const b = workspace(shared);
  writeFileSync(noteFile(a, "shared-fact"), readFileSync(noteFile(a, "shared-fact"), "utf8").replace("Shared fact.", "Edited in a."));
  writeFileSync(noteFile(b, "shared-fact"), readFileSync(noteFile(b, "shared-fact"), "utf8").replace("Shared fact.", "Edited in b."));
  assert.equal(run(["knowledge", "sync", "--workspace", a]).status, 0);
  const conflict = run(["knowledge", "sync", "--workspace", b]);
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /conflict with the remote in notes\/shared-fact\.md\. Your commit is kept locally/);
  assert.ok(!existsSync(resolve(store(b), ".git/rebase-merge")), "the rebase was aborted");
  assert.match(readFileSync(noteFile(b, "shared-fact"), "utf8"), /Edited in b\./);
  assert.equal(git(store(b), ["log", "-1", "--format=%s"]), "knowledge: update notes");
});

test("switching a local store to a repo carries its notes into the clone", () => {
  const shared = remote();
  const seeded = workspace(shared, []);
  assert.equal(learn(seeded, "Remote fact").status, 0);

  const local = workspace(undefined, ["Local fact"]);
  const installed = setRepo(local, { repo: shared });
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /Copied 1 local note into the clone; `mahler knowledge sync` publishes them\.\nThe old folder is at .*knowledge\.before-clone;/);
  assert.ok(existsSync(noteFile(local, "remote-fact")));
  assert.ok(existsSync(noteFile(local, "local-fact")));
  assert.ok(existsSync(resolve(local, ".harness/knowledge.before-clone/notes/local-fact.md")));
  assert.match(run(["knowledge", "sync", "--workspace", local]).stdout, /pushed 1 commit/);
  assert.ok(git(shared, ["ls-tree", "-r", "--name-only", "main"]).split("\n").includes("notes/local-fact.md"));

  // A note that differs on both sides stops the switch with nothing changed.
  const clash = workspace(undefined, ["Remote fact"]);
  writeFileSync(noteFile(clash, "remote-fact"), `${readFileSync(noteFile(clash, "remote-fact"), "utf8")}\nA local edit.\n`);
  const refused = setRepo(clash, { repo: shared });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /differ between the local store and the repo: notes\/remote-fact\.md/);
  assert.ok(!existsSync(resolve(store(clash), ".git")));
  assert.ok(!existsSync(`${store(clash)}.cloning`));
});

test("doctor reports the store's mode and state", () => {
  const shared = remote();
  const local = workspace();
  assert.match(run(["doctor", local]).stdout, /knowledge store: local folder/);
  const a = workspace(shared);
  assert.match(run(["doctor", a]).stdout, /knowledge store: clone of .*knowledge\.git on main/);
  writeFileSync(resolve(store(a), "notes/hand-written.md"), "---\ntitle: Hand written\n---\n");
  const dirty = run(["doctor", a]).stdout;
  assert.match(dirty, /uncommitted changes; the next sync commits and publishes them/);
  assert.match(dirty, /knowledge INDEX\.md is out of date/);

  // Repo set in config but not reinstalled: the folder isn't a clone yet.
  const file = resolve(local, ".harness/config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  config.knowledge.repo = shared;
  writeFileSync(file, JSON.stringify(config));
  assert.match(run(["doctor", local]).stdout, /knowledge store: .* exists but isn't a clone of/);
  const blocked = learn(local, "Not yet shared");
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /notes\/not-yet-shared\.md is saved locally, but publishing it failed/);
});

test("PR publish mode refuses to publish until it is supported", () => {
  const a = workspace(remote());
  setRepo(a, { publish: "pr" });
  const refused = learn(a, "Needs review");
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /knowledge\.publish "pr" is not supported yet/);
  assert.match(run(["doctor", a]).stdout, /knowledge\.publish "pr" is not supported yet/);
});

test("the store lock reclaims a dead holder's lock and waits for a live one", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mahler-lock-"));
  const lock = resolve(dir, ".harness/tmp/locks/knowledge.lock");
  mkdirSync(lock, { recursive: true });
  writeFileSync(resolve(lock, "owner"), "999999999\n");
  assert.equal(withLock(dir, "knowledge", () => "ran"), "ran");
  assert.ok(!existsSync(lock), "released after running");

  // A lock taken over while running isn't released by the old holder.
  withLock(dir, "knowledge", () => writeFileSync(resolve(lock, "owner"), "someone else\n"));
  assert.ok(existsSync(lock));
  rmSync(lock, { recursive: true });

  mkdirSync(lock, { recursive: true });
  writeFileSync(resolve(lock, "owner"), `${process.pid}\n`);
  assert.throws(() => withLock(dir, "knowledge", () => "ran", 300), /Timed out waiting for .*knowledge\.lock/);
});

test("a relative or rewritten repo URL still counts as the store's origin", () => {
  const shared = remote();
  const near = workspace();
  const installed = setRepo(near, { repo: relative(near, shared) });
  assert.equal(installed.status, 0, installed.stderr);
  const learned = learn(near, "Relative remotes work");
  assert.equal(learned.status, 0, learned.stderr);
  assert.match(learned.stdout, /pushed 1 commit/);

  // insteadOf maps the configured URL onto the bare repo, as it might map
  // https onto ssh; the clone's remote get-url then differs from config.
  const rewrite = {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.${shared}.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://git.example.invalid/knowledge.git",
  };
  const far = workspace();
  assert.equal(setRepo(far, { repo: "https://git.example.invalid/knowledge.git" }, rewrite).status, 0);
  const synced = learn(far, "Rewritten remotes work", rewrite);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /pushed 1 commit/);
  assert.ok(existsSync(noteFile(far, "relative-remotes-work")), "the clone has the other workspace's note");
  assert.match(run(["doctor", far], rewrite).stdout, /ok +knowledge store: clone of/);
});

test("generated and editor files the remote tracks are untracked, so they can't conflict", () => {
  const shared = remote();
  const seed = mkdtempSync(resolve(tmpdir(), "mahler-seed-"));
  spawnSync("git", ["clone", "-q", shared, seed], { env });
  mkdirSync(resolve(seed, ".obsidian"));
  writeFileSync(resolve(seed, ".obsidian/workspace.json"), "{}\n");
  writeFileSync(resolve(seed, "INDEX.md"), "# Knowledge Index\n");
  git(seed, ["add", "-A"]);
  git(seed, ["commit", "-q", "-m", "seed"]);
  git(seed, ["push", "-q", "origin", "HEAD:main"]);

  const a = workspace(shared);
  const b = workspace(shared);
  writeFileSync(resolve(store(a), ".obsidian/workspace.json"), '{"open":"a"}\n');
  writeFileSync(resolve(store(b), ".obsidian/workspace.json"), '{"open":"b"}\n');
  assert.equal(learn(a, "First from a").status, 0);
  const second = learn(b, "First from b");
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /pushed 1 commit/);
  const tracked = git(shared, ["ls-tree", "-r", "--name-only", "main"]).split("\n");
  assert.ok(!tracked.includes("INDEX.md"));
  assert.ok(!tracked.includes(".obsidian/workspace.json"));
  assert.match(readFileSync(resolve(store(b), ".obsidian/workspace.json"), "utf8"), /"b"/, "the local file stays");
});

test("switching keeps the old folder even when no notes carry over", () => {
  const shared = remote();
  const local = workspace();
  writeFileSync(resolve(store(local), "README.md"), "# Our own readme\n");
  const installed = setRepo(local, { repo: shared });
  assert.equal(installed.status, 0, installed.stderr);
  assert.doesNotMatch(installed.stdout, /Copied/);
  assert.match(installed.stdout, /The old folder is at .*knowledge\.before-clone;/);
  assert.match(readFileSync(resolve(local, ".harness/knowledge.before-clone/README.md"), "utf8"), /Our own readme/);

  // A second switch doesn't overwrite the first backup.
  rmSync(resolve(store(local), ".git"), { recursive: true });
  assert.match(setRepo(local, { repo: shared }).stdout, /knowledge\.before-clone-2/);
});

test("a branch the remote doesn't have yet starts empty", () => {
  const shared = remote();
  const a = workspace(shared);
  assert.equal(learn(a, "Only on main").status, 0);
  const b = workspace();
  assert.equal(setRepo(b, { repo: shared, branch: "other" }).status, 0);
  assert.ok(!existsSync(noteFile(b, "only-on-main")));
  assert.equal(learn(b, "Only on other").status, 0);
  const onOther = git(shared, ["ls-tree", "-r", "--name-only", "other"]).split("\n");
  assert.ok(onOther.includes("notes/only-on-other.md"));
  assert.ok(!onOther.includes("notes/only-on-main.md"));
});

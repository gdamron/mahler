import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { env, git, learn, noteFile, remote, run, setRepo, store, workspace } from "./knowledge-fixtures.js";

interface FakePr {
  url: string;
  base: string;
  head: string;
  title: string;
  body: string;
  state: string;
}

/**
 * A stand-in for the GitHub CLI: `pr create` records the PR in a JSON file
 * and prints its URL, `pr view <url> --json state` prints its state, and
 * `pr list --head <branch>` lists PRs from a branch. FAKE_GH_FAIL makes
 * `pr create` fail, as it would offline; FAKE_GH_LOSE makes it create the PR
 * and then fail, as when the reply is lost.
 */
function forge(): { env: Record<string, string>; prs: () => FakePr[]; setState: (url: string, state: string) => void } {
  const bin = mkdtempSync(resolve(tmpdir(), "mahler-gh-"));
  const stateFile = resolve(bin, "prs.json");
  writeFileSync(
    resolve(bin, "gh"),
    `#!/usr/bin/env node
const fs = require("fs");
const file = process.env.FAKE_GH_STATE;
const prs = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
if (args[0] === "pr" && args[1] === "create") {
  if (process.env.FAKE_GH_FAIL) { console.error("error connecting to api.github.com"); process.exit(1); }
  const url = "https://forge.example/pr/" + (prs.length + 1);
  prs.push({ url, base: flag("--base"), head: flag("--head"), title: flag("--title"), body: flag("--body"), state: "OPEN" });
  fs.writeFileSync(file, JSON.stringify(prs));
  if (process.env.FAKE_GH_LOSE) { console.error("timed out reading the response"); process.exit(1); }
  console.log(url);
} else if (args[0] === "pr" && args[1] === "list") {
  for (const pr of prs.filter((candidate) => candidate.head === flag("--head")).reverse()) console.log(pr.url + " " + pr.state);
} else if (args[0] === "pr" && args[1] === "edit") {
  const pr = prs.find((candidate) => candidate.url === args[2]);
  Object.assign(pr, { title: flag("--title"), body: flag("--body") });
  fs.writeFileSync(file, JSON.stringify(prs));
} else if (args[0] === "pr" && args[1] === "view") {
  const pr = prs.find((candidate) => candidate.url === args[2]);
  if (!pr) { console.error("no such PR"); process.exit(1); }
  console.log(pr.state);
} else {
  console.error("fake gh: unsupported " + args.join(" "));
  process.exit(1);
}
`,
  );
  chmodSync(resolve(bin, "gh"), 0o755);
  const prs = () => (existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, "utf8")) as FakePr[]) : []);
  return {
    env: { PATH: `${bin}:${process.env.PATH}`, FAKE_GH_STATE: stateFile },
    prs,
    setState: (url, state) =>
      writeFileSync(stateFile, JSON.stringify(prs().map((pr) => (pr.url === url ? { ...pr, state } : pr)))),
  };
}

/** Squash-merge a PR's branch into main, as a reviewer would, optionally editing a file first. */
function squashMerge(shared: string, pr: FakePr, edit?: { path: string; text: string }): void {
  const clone = resolve(mkdtempSync(resolve(tmpdir(), "mahler-review-")), "repo");
  spawnSync("git", ["clone", "-q", shared, clone], { env });
  git(clone, ["fetch", "-q", "origin", pr.head]);
  git(clone, ["merge", "-q", "--squash", "FETCH_HEAD"]);
  if (edit) {
    writeFileSync(resolve(clone, edit.path), edit.text);
    git(clone, ["add", edit.path]);
  }
  git(clone, ["commit", "-q", "-m", pr.title]);
  git(clone, ["push", "-q", "origin", "HEAD:main"]);
}

/** A workspace in PR publish mode, on a remote whose main already has a seed note. */
function prWorkspace(): { shared: string; ws: string; gh: ReturnType<typeof forge> } {
  const shared = remote();
  const ws = workspace(shared);
  assert.equal(learn(ws, "Seed note").status, 0);
  const gh = forge();
  assert.equal(setRepo(ws, { publish: "pr" }, gh.env).status, 0);
  return { shared, ws, gh };
}

const pending = (ws: string, slug: string) => resolve(store(ws), "pending", `${slug}.md`);
const sync = (ws: string, gh: ReturnType<typeof forge>) => run(["knowledge", "sync", "--workspace", ws], gh.env);
const onMain = (shared: string) => git(shared, ["ls-tree", "-r", "--name-only", "main"]).split("\n");

test("a pending note is searchable before its PR merges and leaves pending/ after", () => {
  const { shared, ws, gh } = prWorkspace();
  const learned = learn(ws, "Retries need jitter", gh.env);
  assert.equal(learned.status, 0, learned.stderr);
  assert.match(learned.stdout, /Recorded knowledge \(pending review\): .*pending\/retries-need-jitter\.md/);
  assert.match(learned.stdout, /opened https:\/\/forge\.example\/pr\/1 for retries-need-jitter/);
  assert.ok(existsSync(pending(ws, "retries-need-jitter")));
  assert.ok(!existsSync(noteFile(ws, "retries-need-jitter")));
  assert.match(readFileSync(pending(ws, "retries-need-jitter"), "utf8"), /^pr: https:\/\/forge\.example\/pr\/1$/m);

  const found = run(["knowledge", "search", "jitter", "--workspace", ws]);
  assert.match(found.stdout, /Retries need jitter.*\(pending review\)/);
  assert.match(readFileSync(resolve(store(ws), "INDEX.md"), "utf8"), /Retries need jitter/);

  const [pr] = gh.prs();
  assert.equal(pr.base, "main");
  assert.match(pr.head, /^knowledge\/retries-need-jitter-[0-9a-f]{4}$/);
  assert.equal(pr.title, "Knowledge: Retries need jitter");
  assert.match(pr.body, /Retries need jitter\./);
  assert.ok(!onMain(shared).includes("notes/retries-need-jitter.md"), "nothing lands on main before review");
  const proposed = git(shared, ["show", `${pr.head}:notes/retries-need-jitter.md`]);
  assert.doesNotMatch(proposed, /^pr(-branch)?:/m, "PR bookkeeping stays on this machine");
  assert.equal(git(store(ws), ["status", "--porcelain"]), "", "the clone itself is untouched");

  squashMerge(shared, pr);
  const synced = sync(ws, gh);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /pulled 1 commit; 1 pending note merged/);
  assert.ok(!existsSync(pending(ws, "retries-need-jitter")));
  assert.ok(existsSync(noteFile(ws, "retries-need-jitter")));
  assert.equal(readNotesNamed(ws, "jitter"), 1, "found once, not as both pending and merged");
});

function readNotesNamed(ws: string, term: string): number {
  return run(["knowledge", "search", term, "--workspace", ws]).stdout.split("\n").filter((line) => line.startsWith("- ")).length;
}

test("a pending note whose PR closes unmerged is dropped", () => {
  const { shared, ws, gh } = prWorkspace();
  assert.equal(learn(ws, "Rejected idea", gh.env).status, 0);
  gh.setState(gh.prs()[0].url, "CLOSED");
  const synced = sync(ws, gh);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /dropped pending note rejected-idea \(its PR was closed unmerged\)/);
  assert.ok(!existsSync(pending(ws, "rejected-idea")));
  assert.ok(!onMain(shared).includes("notes/rejected-idea.md"));
  assert.equal(gh.prs().length, 1, "no new PR for a dropped note");
});

test("edits to existing notes batch into one PR, settled when it merges or closes", () => {
  const { shared, ws, gh } = prWorkspace();
  const verified = run(["knowledge", "verify", "seed-note", "--workspace", ws], gh.env);
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(verified.stdout, /The next `mahler knowledge sync`/);
  assert.equal(gh.prs().length, 0, "verify alone opens no PR");
  writeFileSync(noteFile(ws, "seed-note"), `${readFileSync(noteFile(ws, "seed-note"), "utf8")}\nA correction.\n`);

  const first = sync(ws, gh);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /proposed 1 edit in https:\/\/forge\.example\/pr\/1/);
  assert.equal(gh.prs()[0].title, "Knowledge: update notes/seed-note.md");
  assert.match(sync(ws, gh).stdout, /already up to date/, "the same edit isn't proposed twice");

  // The reviewer merges with a wording change of their own.
  const reviewed = readFileSync(noteFile(ws, "seed-note"), "utf8").replace("A correction.", "A reviewed correction.");
  squashMerge(shared, gh.prs()[0], { path: "notes/seed-note.md", text: reviewed });
  gh.setState(gh.prs()[0].url, "MERGED");
  const merged = sync(ws, gh);
  assert.equal(merged.status, 0, merged.stderr);
  assert.match(merged.stdout, /https:\/\/forge\.example\/pr\/1 merged; pulled 1 commit/);
  assert.equal(git(store(ws), ["status", "--porcelain"]), "");
  assert.match(readFileSync(noteFile(ws, "seed-note"), "utf8"), /A reviewed correction\./);

  // A closed batch puts the notes back as they are on main.
  writeFileSync(noteFile(ws, "seed-note"), "---\ntitle: Seed note\n---\nWrong.\n");
  assert.match(sync(ws, gh).stdout, /proposed 1 edit in https:\/\/forge\.example\/pr\/2/);
  gh.setState(gh.prs()[1].url, "CLOSED");
  assert.match(sync(ws, gh).stdout, /dropped the edits in https:\/\/forge\.example\/pr\/2 \(closed unmerged\)/);
  assert.match(readFileSync(noteFile(ws, "seed-note"), "utf8"), /A reviewed correction\./);
  assert.equal(git(store(ws), ["status", "--porcelain"]), "");
});

test("a PR that couldn't open is retried on the next sync, on the same branch", () => {
  const { ws, gh } = prWorkspace();
  const offline = learn(ws, "Opened later", { ...gh.env, FAKE_GH_FAIL: "1" });
  assert.equal(offline.status, 0, offline.stderr);
  assert.match(offline.stderr, /couldn't open a PR for opened-later \(error connecting to api\.github\.com\)/);
  const text = readFileSync(pending(ws, "opened-later"), "utf8");
  const branch = /^pr-branch: (.*)$/m.exec(text)?.[1];
  assert.ok(branch);
  assert.doesNotMatch(text, /^pr:/m);
  assert.match(run(["doctor", ws], gh.env).stdout, /1 knowledge change has no PR yet/);

  const synced = sync(ws, gh);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /opened https:\/\/forge\.example\/pr\/1 for opened-later/);
  assert.equal(gh.prs()[0].head, branch);
});

test("doctor reports PR publish, pending reviews, and notes waiting too long", () => {
  const { ws, gh } = prWorkspace();
  assert.match(run(["doctor", ws], gh.env).stdout, /knowledge store: clone of .* on main, publishing through PRs/);
  assert.equal(learn(ws, "Waiting a while", gh.env).status, 0);
  const file = pending(ws, "waiting-a-while");
  writeFileSync(file, readFileSync(file, "utf8").replace(/^created: .*$/m, "created: 2020-01-01"));
  const doctor = run(["doctor", ws], gh.env).stdout;
  assert.match(doctor, /knowledge PRs awaiting review: 1 pending note\n/);
  assert.match(doctor, /1 pending knowledge note has waited more than 7 days for review/);
});

test("PR publish needs the target branch on the remote", () => {
  const shared = remote();
  const ws = workspace(shared);
  const gh = forge();
  setRepo(ws, { publish: "pr" }, gh.env);
  const refused = learn(ws, "First note", gh.env);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /saved locally, but publishing it failed: PR publish needs a "main" branch on .* for PRs to target/);
  assert.ok(existsSync(pending(ws, "first-note")));
});

/** Commit a file straight to the remote's main, as someone else's merged change. */
function pushToMain(shared: string, path: string, text: string): void {
  const clone = resolve(mkdtempSync(resolve(tmpdir(), "mahler-other-")), "repo");
  spawnSync("git", ["clone", "-q", shared, clone], { env });
  mkdirSync(dirname(resolve(clone, path)), { recursive: true });
  writeFileSync(resolve(clone, path), text);
  git(clone, ["add", path]);
  git(clone, ["commit", "-q", "-m", `change ${path}`]);
  git(clone, ["push", "-q", "origin", "HEAD:main"]);
}

test("editing a pending note updates its PR", () => {
  const { shared, ws, gh } = prWorkspace();
  assert.equal(learn(ws, "Retries need jitter", gh.env).status, 0);
  const file = pending(ws, "retries-need-jitter");
  writeFileSync(file, readFileSync(file, "utf8").replace("Retries need jitter.", "Add jitter to retry delays."));
  const synced = sync(ws, gh);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /updated https:\/\/forge\.example\/pr\/1 for retries-need-jitter/);
  assert.match(git(shared, ["show", `${gh.prs()[0].head}:notes/retries-need-jitter.md`]), /Add jitter to retry delays\./);
  assert.equal(gh.prs().length, 1);
  assert.match(sync(ws, gh).stdout, /already up to date/);
});

test("another machine's note with the same slug doesn't drop an open pending note", () => {
  const { shared, ws, gh } = prWorkspace();
  assert.equal(learn(ws, "Shared slug", gh.env).status, 0);
  pushToMain(shared, "notes/shared-slug.md", "---\ntitle: Shared slug\ndescription: Someone else's.\n---\n");
  const synced = sync(ws, gh);
  assert.equal(synced.status, 0, synced.stderr);
  assert.doesNotMatch(synced.stdout, /merged/);
  assert.ok(existsSync(pending(ws, "shared-slug")), "kept while its PR is open");
});

test("a blocked pull keeps a merged pending note until the note arrives", () => {
  const { shared, ws, gh } = prWorkspace();
  assert.equal(learn(ws, "Arrives later", gh.env).status, 0);
  writeFileSync(noteFile(ws, "seed-note"), "---\ntitle: Seed note\n---\nMy edit.\n");
  assert.match(sync(ws, gh).stdout, /proposed 1 edit in https:\/\/forge\.example\/pr\/2/);
  pushToMain(shared, "notes/seed-note.md", "---\ntitle: Seed note\n---\nTheir edit.\n");
  squashMerge(shared, gh.prs()[0]);
  gh.setState(gh.prs()[0].url, "MERGED");

  const blocked = sync(ws, gh);
  assert.equal(blocked.status, 0, blocked.stderr);
  assert.match(blocked.stderr, /couldn't pull: local edits to notes\/seed-note\.md overlap changes on main/);
  assert.ok(existsSync(pending(ws, "arrives-later")), "still searchable while the pull is blocked");
  assert.equal(gh.prs().length, 2, "a merged note isn't proposed again");

  git(store(ws), ["checkout", "--", "notes/seed-note.md"]);
  const unblocked = sync(ws, gh);
  assert.match(unblocked.stdout, /pulled 2 commits; 1 pending note merged/);
  assert.ok(existsSync(noteFile(ws, "arrives-later")));
});

test("edits update one open batch PR instead of stacking new ones", () => {
  const { shared, ws, gh } = prWorkspace();
  writeFileSync(noteFile(ws, "seed-note"), "---\ntitle: Seed note\n---\nFirst edit.\n");
  assert.match(sync(ws, gh).stdout, /proposed 1 edit in https:\/\/forge\.example\/pr\/1/);
  writeFileSync(noteFile(ws, "seed-note"), "---\ntitle: Seed note\n---\nSecond edit.\n");
  writeFileSync(noteFile(ws, "new-by-hand"), "---\ntitle: New by hand\n---\n");
  assert.match(sync(ws, gh).stdout, /updated https:\/\/forge\.example\/pr\/1 with 2 edits/);
  assert.equal(gh.prs().length, 1);
  assert.equal(gh.prs()[0].title, "Knowledge: update 2 files");
  assert.match(git(shared, ["show", `${gh.prs()[0].head}:notes/seed-note.md`]), /Second edit\./);
});

test("PR publish keeps machine-local files out of PRs, and doesn't repeat a closed change", () => {
  const shared = remote();
  const seed = resolve(mkdtempSync(resolve(tmpdir(), "mahler-seed-")), "repo");
  spawnSync("git", ["clone", "-q", shared, seed], { env });
  writeFileSync(resolve(seed, "README.md"), "# Team knowledge\n");
  git(seed, ["add", "-A"]);
  git(seed, ["commit", "-q", "-m", "seed"]);
  git(seed, ["push", "-q", "origin", "HEAD:main"]);
  const gh = forge();
  const ws = workspace();
  assert.equal(setRepo(ws, { repo: shared, publish: "pr" }, gh.env).status, 0);
  assert.match(sync(ws, gh).stdout, /already up to date/);
  assert.equal(gh.prs().length, 0, "no PR for .gitignore or the index");
  assert.equal(git(store(ws), ["status", "--porcelain"]), "");

  writeFileSync(noteFile(ws, "by-hand"), "---\ntitle: By hand\n---\n");
  assert.match(sync(ws, gh).stdout, /proposed 1 edit/);
  gh.setState(gh.prs()[0].url, "CLOSED");
  assert.match(sync(ws, gh).stdout, /dropped the edits/);
  assert.ok(!existsSync(noteFile(ws, "by-hand")));
  writeFileSync(noteFile(ws, "by-hand"), "---\ntitle: By hand\n---\n");
  assert.match(sync(ws, gh).stdout, /already up to date/, "the same closed change isn't proposed again");
  assert.equal(gh.prs().length, 1);
});

test("switching back to direct publish pushes pending notes", () => {
  const { shared, ws, gh } = prWorkspace();
  assert.equal(learn(ws, "Was pending", gh.env).status, 0);
  assert.equal(setRepo(ws, { publish: "direct" }, gh.env).status, 0);
  const synced = sync(ws, gh);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /moved 1 pending note into notes\/ \(close its PR on the forge\)/);
  assert.ok(!existsSync(pending(ws, "was-pending")));
  const published = git(shared, ["show", "main:notes/was-pending.md"]);
  assert.doesNotMatch(published, /^pr(-branch)?:/m);
});

test("a PR created without Mahler hearing back is found, not opened twice", () => {
  const { ws, gh } = prWorkspace();
  const lost = learn(ws, "Lost reply", { ...gh.env, FAKE_GH_LOSE: "1" });
  assert.equal(lost.status, 0, lost.stderr);
  assert.match(lost.stderr, /couldn't open a PR for lost-reply/);
  assert.match(sync(ws, gh).stdout, /opened https:\/\/forge\.example\/pr\/1 for lost-reply/);
  assert.equal(gh.prs().length, 1);
});

test("a brief pulls without opening PRs", () => {
  const { ws, gh } = prWorkspace();
  writeFileSync(noteFile(ws, "seed-note"), "---\ntitle: Seed note\n---\nAn edit.\n");
  const brief = run(["task", "brief-check", "--workspace", ws, "--agent", "claude", "--title", "Check the brief"], gh.env);
  assert.equal(brief.status, 0, brief.stderr);
  assert.equal(gh.prs().length, 0);
});

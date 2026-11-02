import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  headRefOid?: string;
}

/**
 * A stand-in for the GitHub CLI: `pr create` records the PR in a JSON file
 * and prints its URL, `pr view <url>` prints its state and head commit (set
 * when a test merges or closes it), `pr list --head <branch>` lists PRs from
 * a branch, and `pr close` closes one. FAKE_GH_FAIL makes `pr create` fail,
 * as it would offline; FAKE_GH_LOSE makes it create the PR and then fail, as
 * when the reply is lost.
 */
function forge(): {
  env: Record<string, string>;
  prs: () => FakePr[];
  setState: (url: string, state: string, headRefOid?: string) => void;
} {
  const bin = mkdtempSync(resolve(tmpdir(), "mahler-gh-"));
  const stateFile = resolve(bin, "prs.json");
  writeFileSync(
    resolve(bin, "gh"),
    `#!/usr/bin/env node
const fs = require("fs");
const file = process.env.FAKE_GH_STATE;
const prs = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
const args = process.argv.slice(2);
if (process.env.FAKE_GH_DOWN) { console.error("error connecting to api.github.com"); process.exit(1); }
const flag = (name) => args[args.indexOf(name) + 1];
if (args[0] === "pr" && args[1] === "create") {
  if (process.env.FAKE_GH_FAIL) { console.error("error connecting to api.github.com"); process.exit(1); }
  const url = "https://forge.example/pr/" + (prs.length + 1);
  prs.push({ url, base: flag("--base"), head: flag("--head"), title: flag("--title"), body: flag("--body"), state: "OPEN" });
  fs.writeFileSync(file, JSON.stringify(prs));
  if (process.env.FAKE_GH_LOSE) { console.error("timed out reading the response"); process.exit(1); }
  console.log(url);
} else if (args[0] === "pr" && args[1] === "list") {
  for (const pr of prs.filter((candidate) => candidate.head === flag("--head")).reverse()) console.log(pr.url + " " + pr.state + " " + (pr.headRefOid || ""));
} else if (args[0] === "pr" && args[1] === "edit") {
  const pr = prs.find((candidate) => candidate.url === args[2]);
  Object.assign(pr, { title: flag("--title"), body: flag("--body") });
  fs.writeFileSync(file, JSON.stringify(prs));
} else if (args[0] === "pr" && args[1] === "view") {
  const pr = prs.find((candidate) => candidate.url === args[2]);
  if (!pr) { console.error("no such PR"); process.exit(1); }
  console.log(pr.state + " " + (pr.headRefOid || ""));
} else if (args[0] === "pr" && args[1] === "close") {
  const pr = prs.find((candidate) => candidate.url === args[2]);
  pr.state = "CLOSED";
  fs.writeFileSync(file, JSON.stringify(prs));
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
    setState: (url, state, headRefOid) =>
      writeFileSync(stateFile, JSON.stringify(prs().map((pr) => (pr.url === url ? { ...pr, state, headRefOid } : pr)))),
  };
}

/**
 * Squash-merge a PR's branch (or an earlier commit on it) into main, as a
 * reviewer would, optionally editing a file first.
 */
function squashMerge(shared: string, pr: FakePr, edit?: { path: string; text: string }, at = "FETCH_HEAD"): void {
  const clone = resolve(mkdtempSync(resolve(tmpdir(), "mahler-review-")), "repo");
  spawnSync("git", ["clone", "-q", shared, clone], { env });
  git(clone, ["fetch", "-q", "origin", pr.head]);
  git(clone, ["merge", "-q", "--squash", at]);
  if (edit) {
    writeFileSync(resolve(clone, edit.path), edit.text);
    git(clone, ["add", edit.path]);
  }
  git(clone, ["commit", "-q", "-m", pr.title]);
  git(clone, ["push", "-q", "origin", "HEAD:main"]);
}

/** Merge a PR as the forge would, recording the head commit it merged. */
function merge(shared: string, gh: ReturnType<typeof forge>, pr: FakePr, options: { edit?: { path: string; text: string }; at?: string } = {}): void {
  const head = options.at ?? git(shared, ["rev-parse", `refs/heads/${pr.head}`]);
  squashMerge(shared, pr, options.edit, head);
  gh.setState(pr.url, "MERGED", head);
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

const ledger = (ws: string) => JSON.parse(readFileSync(resolve(store(ws), "pending", "prs.json"), "utf8"));
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
  assert.equal(ledger(ws).notes["retries-need-jitter"].url, "https://forge.example/pr/1");

  const found = run(["knowledge", "search", "jitter", "--workspace", ws]);
  assert.match(found.stdout, /Retries need jitter.*\(pending review\)/);
  assert.match(readFileSync(resolve(store(ws), "INDEX.md"), "utf8"), /Retries need jitter/);

  const [pr] = gh.prs();
  assert.equal(pr.base, "main");
  assert.match(pr.head, /^knowledge\/retries-need-jitter-[0-9a-f]{4}$/);
  assert.equal(pr.title, "Knowledge: Retries need jitter");
  assert.match(pr.body, /Retries need jitter\./);
  assert.ok(!onMain(shared).includes("notes/retries-need-jitter.md"), "nothing lands on main before review");
  assert.equal(
    git(shared, ["show", `${pr.head}:notes/retries-need-jitter.md`]),
    readFileSync(pending(ws, "retries-need-jitter"), "utf8").trim(),
    "the PR proposes the note as written",
  );
  assert.equal(git(store(ws), ["status", "--porcelain"]), "", "the clone itself is untouched");

  merge(shared, gh, pr);
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
  assert.match(verified.stdout, /Run `mahler knowledge sync` to propose it in a PR/);
  assert.equal(gh.prs().length, 0, "verify alone opens no PR");
  writeFileSync(noteFile(ws, "seed-note"), `${readFileSync(noteFile(ws, "seed-note"), "utf8")}\nA correction.\n`);

  const first = sync(ws, gh);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /proposed 1 edit in https:\/\/forge\.example\/pr\/1/);
  assert.equal(gh.prs()[0].title, "Knowledge: update notes/seed-note.md");
  assert.match(sync(ws, gh).stdout, /already up to date/, "the same edit isn't proposed twice");

  // The reviewer merges with a wording change of their own.
  const reviewed = readFileSync(noteFile(ws, "seed-note"), "utf8").replace("A correction.", "A reviewed correction.");
  merge(shared, gh, gh.prs()[0], { edit: { path: "notes/seed-note.md", text: reviewed } });
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
  const { branch, url } = ledger(ws).notes["opened-later"];
  assert.ok(branch);
  assert.equal(url, undefined);
  assert.match(run(["doctor", ws], gh.env).stdout, /1 knowledge change isn't proposed in a PR yet/);

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
  merge(shared, gh, gh.prs()[0]);

  const blocked = sync(ws, gh);
  assert.equal(blocked.status, 0, blocked.stderr);
  assert.match(blocked.stderr, /couldn't pull: your edits to notes\/seed-note\.md conflict with changes on main/);
  assert.ok(existsSync(pending(ws, "arrives-later")), "still searchable while the pull is blocked");
  assert.equal(gh.prs().length, 2, "a merged note isn't proposed again");

  git(store(ws), ["checkout", "--", "notes/seed-note.md"]);
  const unblocked = sync(ws, gh);
  assert.match(unblocked.stdout, /pulled 2 commits; 1 pending note merged; closed https:\/\/forge\.example\/pr\/2: its edits were undone/);
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

test("PR publish keeps machine-local files out of PRs, and a closed batch drops its edits", () => {
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
  assert.equal(git(store(ws), ["status", "--porcelain"]), "");
});

test("switching back to direct publish pushes notes still in review, not rejected ones", () => {
  const { shared, ws, gh } = prWorkspace();
  assert.equal(learn(ws, "Was pending", gh.env).status, 0);
  assert.equal(learn(ws, "Was rejected", gh.env).status, 0);
  gh.setState(gh.prs()[1].url, "CLOSED");
  assert.equal(setRepo(ws, { publish: "direct" }, gh.env).status, 0);
  const synced = sync(ws, gh);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /moved 1 pending note into notes\/; close https:\/\/forge\.example\/pr\/1 on the forge/);
  assert.ok(!existsSync(pending(ws, "was-pending")));
  assert.ok(!existsSync(pending(ws, "was-rejected")));
  assert.ok(onMain(shared).includes("notes/was-pending.md"));
  assert.ok(!onMain(shared).includes("notes/was-rejected.md"), "a closed PR's note isn't published");
  assert.ok(!existsSync(resolve(store(ws), "pending", "prs.json")));
});

test("a PR created without Mahler hearing back is found, not opened twice", () => {
  const { ws, gh } = prWorkspace();
  const lost = learn(ws, "Lost reply", { ...gh.env, FAKE_GH_LOSE: "1" });
  assert.equal(lost.status, 0, lost.stderr);
  assert.match(lost.stderr, /couldn't open a PR for lost-reply/);
  assert.match(sync(ws, gh).stdout, /found https:\/\/forge\.example\/pr\/1 for lost-reply/);
  assert.equal(gh.prs().length, 1);
});

test("a brief pulls without opening PRs", () => {
  const { ws, gh } = prWorkspace();
  writeFileSync(noteFile(ws, "seed-note"), "---\ntitle: Seed note\n---\nAn edit.\n");
  const brief = run(["task", "brief-check", "--workspace", ws, "--agent", "claude", "--title", "Check the brief"], gh.env);
  assert.equal(brief.status, 0, brief.stderr);
  assert.equal(gh.prs().length, 0);
});

const tipOf = (shared: string, pr: FakePr) => git(shared, ["rev-parse", `refs/heads/${pr.head}`]);

/** Push a commit to a PR's branch, as a reviewer suggesting a change would. */
function pushToBranch(shared: string, pr: FakePr, path: string, text: string): void {
  const clone = resolve(mkdtempSync(resolve(tmpdir(), "mahler-reviewer-")), "repo");
  spawnSync("git", ["clone", "-q", "-b", pr.head, shared, clone], { env });
  writeFileSync(resolve(clone, path), text);
  git(clone, ["commit", "-q", "-am", "reviewer suggestion"]);
  git(clone, ["push", "-q", "origin", `HEAD:${pr.head}`]);
}

test("undoing every edit closes the batch PR instead of leaving it to merge", () => {
  const { ws, gh } = prWorkspace();
  writeFileSync(noteFile(ws, "seed-note"), "---\ntitle: Seed note\n---\nAn edit.\n");
  assert.match(sync(ws, gh).stdout, /proposed 1 edit in https:\/\/forge\.example\/pr\/1/);
  git(store(ws), ["checkout", "--", "notes/seed-note.md"]);
  const synced = sync(ws, gh);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /closed https:\/\/forge\.example\/pr\/1: its edits were undone/);
  assert.equal(gh.prs()[0].state, "CLOSED");
  assert.match(sync(ws, gh).stdout, /already up to date/);
});

test("undoing one edit takes it back out of the batch PR", () => {
  const { shared, ws, gh } = prWorkspace();
  const original = readFileSync(noteFile(ws, "seed-note"), "utf8");
  writeFileSync(noteFile(ws, "seed-note"), "---\ntitle: Seed note\n---\nAn edit.\n");
  writeFileSync(noteFile(ws, "new-by-hand"), "---\ntitle: New by hand\n---\n");
  assert.match(sync(ws, gh).stdout, /proposed 2 edits/);
  git(store(ws), ["checkout", "--", "notes/seed-note.md"]);
  assert.match(sync(ws, gh).stdout, /updated https:\/\/forge\.example\/pr\/1 with 1 edit/);
  const [pr] = gh.prs();
  assert.equal(git(shared, ["show", `${pr.head}:notes/seed-note.md`]), original.trim());
  assert.equal(pr.title, "Knowledge: update notes/new-by-hand.md");
});

test("a reviewer's commits on a PR branch are never overwritten", () => {
  const { shared, ws, gh } = prWorkspace();
  assert.equal(learn(ws, "Reviewed note", gh.env).status, 0);
  const [pr] = gh.prs();
  const proposed = readFileSync(pending(ws, "reviewed-note"), "utf8");
  pushToBranch(shared, pr, "notes/reviewed-note.md", proposed.replace(/^description: .*$/m, 'description: "Reviewer wording."'));
  const suggested = tipOf(shared, pr);

  assert.match(sync(ws, gh).stdout, /already up to date/, "an unchanged note pushes nothing");
  assert.equal(tipOf(shared, pr), suggested);

  const file = pending(ws, "reviewed-note");
  writeFileSync(file, `${readFileSync(file, "utf8")}\nMy addition.\n`);
  const synced = sync(ws, gh);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stderr, /pr\/1 has commits from someone else, so Mahler leaves it alone/);
  assert.equal(tipOf(shared, pr), suggested, "the reviewer's commit stays the branch tip");

  // Merged with the reviewer's commit: both their wording and the addition survive.
  merge(shared, gh, pr);
  const merged = sync(ws, gh);
  assert.equal(merged.status, 0, merged.stderr);
  assert.match(merged.stdout, /kept your later edits to reviewed-note; 1 pending note merged; proposed 1 edit in https:\/\/forge\.example\/pr\/2/);
  const note = readFileSync(noteFile(ws, "reviewed-note"), "utf8");
  assert.match(note, /Reviewer wording\./);
  assert.match(note, /My addition\./);
});

test("an edit to a pending note after its PR merged is kept, folded into the merged note", () => {
  const { shared, ws, gh } = prWorkspace();
  assert.equal(learn(ws, "Late edit", gh.env).status, 0);
  const [pr] = gh.prs();
  const proposed = readFileSync(pending(ws, "late-edit"), "utf8");
  // The reviewer fixes the title as they merge; meanwhile the note gains a line here.
  merge(shared, gh, pr, { edit: { path: "notes/late-edit.md", text: proposed.replace('title: "Late edit"', 'title: "Late edit, reviewed"') } });
  writeFileSync(pending(ws, "late-edit"), `${proposed}\nAdded after merge.\n`);

  const synced = sync(ws, gh);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /kept your later edits to late-edit; 1 pending note merged; proposed 1 edit in https:\/\/forge\.example\/pr\/2/);
  assert.ok(!existsSync(pending(ws, "late-edit")));
  const note = readFileSync(noteFile(ws, "late-edit"), "utf8");
  assert.match(note, /title: "Late edit, reviewed"/);
  assert.match(note, /Added after merge\./);
  assert.match(git(shared, ["show", `${gh.prs()[1].head}:notes/late-edit.md`]), /Added after merge\./);
});

test("an edit pushed after the batch PR merged is kept and proposed again", () => {
  const { shared, ws, gh } = prWorkspace();
  writeFileSync(noteFile(ws, "seed-note"), "---\ntitle: Seed note\n---\nFirst.\n");
  assert.match(sync(ws, gh).stdout, /proposed 1 edit/);
  const [pr] = gh.prs();
  const first = tipOf(shared, pr);
  writeFileSync(noteFile(ws, "seed-note"), "---\ntitle: Seed note\n---\nSecond.\n");
  assert.match(sync(ws, gh).stdout, /updated https:\/\/forge\.example\/pr\/1/);
  // The reviewer merged the first version, before the second reached the PR.
  merge(shared, gh, pr, { at: first });

  const synced = sync(ws, gh);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /pr\/1 merged, keeping your later edits to 1 file; pulled 1 commit; proposed 1 edit in https:\/\/forge\.example\/pr\/2/);
  assert.match(readFileSync(noteFile(ws, "seed-note"), "utf8"), /Second\./);
  assert.match(git(shared, ["show", "main:notes/seed-note.md"]), /First\./);
  assert.match(git(shared, ["show", `${gh.prs()[1].head}:notes/seed-note.md`]), /Second\./);
});

test("a blocked pull proposes no edits built on the old commit", () => {
  const { shared, ws, gh } = prWorkspace();
  writeFileSync(noteFile(ws, "seed-note"), "---\ntitle: Seed note\n---\nMine.\n");
  assert.match(sync(ws, gh).stdout, /proposed 1 edit/);
  const [pr] = gh.prs();
  const proposedTip = tipOf(shared, pr);
  pushToMain(shared, "notes/seed-note.md", "---\ntitle: Seed note\n---\nTheirs.\n");
  writeFileSync(noteFile(ws, "seed-note"), "---\ntitle: Seed note\n---\nMine, again.\n");

  const blocked = sync(ws, gh);
  assert.equal(blocked.status, 0, blocked.stderr);
  assert.match(blocked.stderr, /couldn't pull: .*until then your edits aren't proposed/);
  assert.equal(tipOf(shared, pr), proposedTip, "the PR keeps what it had");
});

test("doctor reports edits not yet proposed, and a pending note changed after merging", () => {
  const { shared, ws, gh } = prWorkspace();
  writeFileSync(noteFile(ws, "seed-note"), "---\ntitle: Seed note\n---\nUnproposed.\n");
  assert.match(run(["doctor", ws], gh.env).stdout, /1 knowledge change isn't proposed in a PR yet/);
  assert.equal(sync(ws, gh).status, 0);
  assert.doesNotMatch(run(["doctor", ws], gh.env).stdout, /proposed in a PR yet/);

  assert.equal(learn(ws, "Clashing note", gh.env).status, 0);
  const pr = gh.prs()[1];
  const proposed = readFileSync(pending(ws, "clashing-note"), "utf8");
  merge(shared, gh, pr, { edit: { path: "notes/clashing-note.md", text: proposed.replace(/^description: .*$/m, "description: Theirs.") } });
  writeFileSync(pending(ws, "clashing-note"), proposed.replace(/^description: .*$/m, "description: Mine."));
  const synced = sync(ws, gh);
  assert.match(synced.stderr, /pending\/clashing-note\.md changed after .*pr\/2 merged, in ways that conflict/);
  assert.ok(existsSync(pending(ws, "clashing-note")), "kept for a hand merge");
  assert.match(run(["doctor", ws], gh.env).stdout, /pending\/clashing-note\.md changed after its PR merged/);
  assert.equal(gh.prs().length, 2, "not proposed again");
});

test("a pull folds local edits into overlapping changes instead of blocking", () => {
  const { shared, ws, gh } = prWorkspace();
  const original = readFileSync(noteFile(ws, "seed-note"), "utf8");
  writeFileSync(noteFile(ws, "seed-note"), `${original}\nMy line at the end.\n`);
  assert.match(sync(ws, gh).stdout, /proposed 1 edit/);
  pushToMain(shared, "notes/seed-note.md", original.replace(/^description: .*$/m, 'description: "Their wording."'));

  const synced = sync(ws, gh);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /folded your edits to notes\/seed-note\.md into the pulled changes; pulled 1 commit/);
  const note = readFileSync(noteFile(ws, "seed-note"), "utf8");
  assert.match(note, /Their wording\./);
  assert.match(note, /My line at the end\./);
  assert.equal(gh.prs()[0].state, "OPEN", "the batch PR stays open");
});

test("edits an interrupted sync set aside are put back by the next one", () => {
  const { ws, gh } = prWorkspace();
  const file = noteFile(ws, "seed-note");
  const original = readFileSync(file, "utf8");
  const edited = `${original}\nCarried over.\n`;
  const folded = `${original}\nCarried over, folded.\n`;
  // As if a sync recorded the carry and was killed before restoring the file.
  writeFileSync(file, edited);
  mkdirSync(resolve(store(ws), "pending"), { recursive: true });
  writeFileSync(
    resolve(store(ws), "pending", "prs.json"),
    JSON.stringify({ notes: {}, settling: [{ path: "notes/seed-note.md", local: edited, text: folded }] }),
  );
  const synced = sync(ws, gh);
  assert.equal(synced.status, 0, synced.stderr);
  assert.equal(readFileSync(file, "utf8"), folded);
  assert.match(synced.stdout, /proposed 1 edit/);
  assert.equal(ledger(ws).settling, undefined);
});

test("switching to direct publish without a working gh publishes no batch edits", () => {
  const { shared, ws, gh } = prWorkspace();
  writeFileSync(noteFile(ws, "seed-note"), "---\ntitle: Seed note\n---\nRejected claim.\n");
  assert.match(sync(ws, gh).stdout, /proposed 1 edit/);
  gh.setState(gh.prs()[0].url, "CLOSED");
  assert.equal(setRepo(ws, { publish: "direct" }, gh.env).status, 0);
  const synced = sync(ws, { ...gh, env: { ...gh.env, FAKE_GH_DOWN: "1" } });
  assert.match(synced.stderr, /couldn't check https:\/\/forge\.example\/pr\/1, the PR holding your edits; nothing was published/);
  assert.doesNotMatch(git(shared, ["show", "main:notes/seed-note.md"]), /Rejected claim/);

  const settled = sync(ws, gh);
  assert.equal(settled.status, 0, settled.stderr);
  assert.match(settled.stdout, /dropped the edits in https:\/\/forge\.example\/pr\/1 \(closed unmerged\)/);
  assert.doesNotMatch(git(shared, ["show", "main:notes/seed-note.md"]), /Rejected claim/);
});

test("a pending note's branch deleted before its PR opened is pushed again", () => {
  const { shared, ws, gh } = prWorkspace();
  assert.equal(learn(ws, "Pushed twice", { ...gh.env, FAKE_GH_FAIL: "1" }).status, 0);
  const { branch } = ledger(ws).notes["pushed-twice"];
  git(shared, ["branch", "-D", branch]);
  const synced = sync(ws, gh);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /opened https:\/\/forge\.example\/pr\/1 for pushed-twice/);
  assert.match(git(shared, ["show", `${branch}:notes/pushed-twice.md`]), /Pushed twice/);
});

test("deleting a pending note by hand forgets its PR", () => {
  const { ws, gh } = prWorkspace();
  assert.equal(learn(ws, "Withdrawn", gh.env).status, 0);
  rmSync(pending(ws, "withdrawn"));
  const synced = sync(ws, gh);
  assert.match(synced.stdout, /forgot the PR for withdrawn, since pending\/withdrawn\.md is gone; close https:\/\/forge\.example\/pr\/1 if it's still open/);
  assert.ok(!existsSync(resolve(store(ws), "pending", "prs.json")));
});

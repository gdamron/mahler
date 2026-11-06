import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { forge, git, learn, merge, noteFile, remote, run, store, workspace } from "./knowledge-fixtures.js";

/**
 * The knowledge store and the decisions ledger sharing one repo and branch,
 * each under its own folder (`knowledge.repoPath`, `decisions.repoPath`).
 */

const ledger = (dir: string) => resolve(dir, ".harness/decisions");
const clone = (dir: string) => resolve(dir, ".harness/stores");
const onMain = (shared: string) => git(shared, ["ls-tree", "-r", "--name-only", "main"]).split("\n");
const ledgerNotes = (dir: string) => readdirSync(ledger(dir)).filter((file) => /^\d{4}-.*\.md$/.test(file));

function configure(
  dir: string,
  knowledge: Record<string, string | undefined>,
  decisions: Record<string, string | undefined>,
  extraEnv: Record<string, string> = {},
) {
  const file = resolve(dir, ".harness/config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  config.knowledge = { ...config.knowledge, ...knowledge };
  config.decisions = { ...config.decisions, ...decisions };
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return run(["install", dir], extraEnv);
}

/** Point both stores at `shared`, each under its own folder, and reinstall. */
function share(dir: string, shared: string, publish?: string, extraEnv: Record<string, string> = {}) {
  return configure(dir, { repo: shared, repoPath: "knowledge", publish }, { repo: shared, repoPath: "decisions" }, extraEnv);
}

function sharedWorkspace(shared: string): string {
  const dir = workspace();
  const installed = share(dir, shared);
  assert.equal(installed.status, 0, installed.stderr);
  return dir;
}

function decide(dir: string, rule: string, extraEnv: Record<string, string> = {}) {
  return run(
    ["decide", "--workspace", dir, "--rule", rule, "--description", `${rule} applied.`, "--reason", `It fit here, in ${dir}.`],
    extraEnv,
  );
}

test("both stores share one clone, each under its own folder in the repo", () => {
  const shared = remote();
  const a = sharedWorkspace(shared);
  const b = sharedWorkspace(shared);
  assert.ok(existsSync(resolve(clone(a), ".git")), "install cloned the shared repo once");
  assert.ok(lstatSync(store(a)).isSymbolicLink() && lstatSync(ledger(a)).isSymbolicLink());
  assert.equal(realpathSync(store(a)), realpathSync(resolve(clone(a), "knowledge")));
  assert.equal(realpathSync(ledger(a)), realpathSync(resolve(clone(a), "decisions")));

  const learned = learn(a, "Builds need the seed step");
  assert.equal(learned.status, 0, learned.stderr);
  const decided = decide(a, "skip-tester");
  assert.equal(decided.status, 0, decided.stderr);
  assert.match(decided.stdout, /Ledger sync: committed local changes; pushed 1 commit\./);

  const files = onMain(shared);
  assert.ok(files.includes("knowledge/notes/builds-need-the-seed-step.md"), files.join("\n"));
  assert.ok(files.some((file) => /^decisions\/\d{4}-\d{2}-\d{2}-skip-tester\.md$/.test(file)), files.join("\n"));
  assert.ok(files.includes("knowledge/README.md") && files.includes("decisions/README.md"), "each store keeps its own README");
  assert.ok(files.every((file) => file.startsWith("knowledge/") || file.startsWith("decisions/")), files.join("\n"));
  assert.ok(!files.some((file) => file.endsWith("INDEX.md")), "the generated indexes stay out of the repo");

  // Each commit touches one store's folder only.
  const touched = git(shared, ["log", "--format=%s", "--name-only", "main"]);
  for (const commit of touched.split(/\n(?=\S+: )/)) {
    const [subject, ...paths] = commit.split("\n").filter(Boolean);
    const folder = subject.startsWith("decisions:") ? "decisions/" : "knowledge/";
    assert.ok(paths.every((path) => path.startsWith(folder)), `${subject}: ${paths.join(", ")}`);
  }

  const synced = run(["knowledge", "sync", "--workspace", b]);
  assert.equal(synced.status, 0, synced.stderr);
  assert.ok(existsSync(noteFile(b, "builds-need-the-seed-step")));
  assert.equal(ledgerNotes(b).length, 1);
  assert.match(readFileSync(resolve(ledger(b), "INDEX.md"), "utf8"), /skip-tester applied\./);

  const doctor = run(["doctor", a]);
  assert.match(doctor.stdout, /knowledge store: clone of .* on main, in knowledge\/ \(shared with the decisions ledger\)/);
  assert.match(doctor.stdout, /decisions ledger: backed up to .* on main, in decisions\/ \(shared with the knowledge store\)/);
});

test("a ledger sync leaves the knowledge store's unsynced edits alone, and commits none of them", () => {
  const shared = remote();
  const a = sharedWorkspace(shared);
  const b = sharedWorkspace(shared);
  assert.equal(learn(a, "Retries need jitter").status, 0);
  assert.equal(learn(a, "Caches need limits").status, 0);
  assert.equal(run(["knowledge", "sync", "--workspace", b]).status, 0);

  // b publishes an edit to one note; a has an unsynced edit to the other.
  writeFileSync(noteFile(b, "caches-need-limits"), `${readFileSync(noteFile(b, "caches-need-limits"), "utf8")}\nEdited on b.\n`);
  assert.equal(run(["knowledge", "sync", "--workspace", b]).status, 0);
  const edited = `${readFileSync(noteFile(a, "retries-need-jitter"), "utf8")}\nEdited on a.\n`;
  writeFileSync(noteFile(a, "retries-need-jitter"), edited);

  const decided = decide(a, "commit-size");
  assert.equal(decided.status, 0, decided.stderr);
  assert.match(decided.stdout, /Ledger sync: committed local changes; pulled \d+ commits?; pushed 1 commit\./);
  assert.equal(readFileSync(noteFile(a, "retries-need-jitter"), "utf8"), edited, "the unsynced edit is still there");
  assert.match(readFileSync(noteFile(a, "caches-need-limits"), "utf8"), /Edited on b\./);
  const pushed = git(shared, ["show", "--name-only", "--format=", "main"]).split("\n");
  assert.ok(pushed.every((path) => path.startsWith("decisions/")), pushed.join(", "));
  assert.doesNotMatch(git(shared, ["show", "main:knowledge/notes/retries-need-jitter.md"]), /Edited on a/);

  // The knowledge store's own sync publishes its edit.
  const synced = run(["knowledge", "sync", "--workspace", a]);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(git(shared, ["show", "main:knowledge/notes/retries-need-jitter.md"]), /Edited on a/);
});

test("a ledger sync holds off when the knowledge store's unsynced edits are in the pull's way", () => {
  const shared = remote();
  const a = sharedWorkspace(shared);
  const b = sharedWorkspace(shared);
  assert.equal(learn(a, "Retries need jitter").status, 0);
  assert.equal(run(["knowledge", "sync", "--workspace", b]).status, 0);
  writeFileSync(noteFile(b, "retries-need-jitter"), `${readFileSync(noteFile(b, "retries-need-jitter"), "utf8")}\nEdited on b.\n`);
  assert.equal(run(["knowledge", "sync", "--workspace", b]).status, 0);
  const edited = `${readFileSync(noteFile(a, "retries-need-jitter"), "utf8")}\nEdited on a.\n`;
  writeFileSync(noteFile(a, "retries-need-jitter"), edited);

  const decided = decide(a, "commit-size");
  assert.equal(decided.status, 0, decided.stderr);
  assert.match(
    decided.stderr,
    /Ledger sync: committed local changes; the knowledge store has unsynced changes to knowledge\/notes\/retries-need-jitter\.md, which the remote changed too; run `mahler knowledge sync`, which syncs both stores\./,
  );
  assert.equal(readFileSync(noteFile(a, "retries-need-jitter"), "utf8"), edited);
  assert.match(run(["doctor", a]).stdout, /decisions ledger has 1 commit not backed up/);
});

test("a sync untracks ignored files in its own folder that the repo tracks", () => {
  const shared = remote();
  const a = sharedWorkspace(shared);
  assert.equal(learn(a, "Caches need limits").status, 0);
  // Another client committed a junk file into the knowledge folder.
  const other = resolve(mkdtempSync(resolve(tmpdir(), "mahler-other-")), "clone");
  git(tmpdir(), ["clone", "-q", shared, other]);
  writeFileSync(resolve(other, "knowledge/.DS_Store"), "junk");
  git(other, ["add", "--force", "knowledge/.DS_Store"]);
  git(other, ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "knowledge: junk"]);
  git(other, ["push", "-q", "origin", "HEAD:main"]);
  assert.equal(run(["knowledge", "sync", "--workspace", a]).status, 0);

  const learned = learn(a, "Retries need jitter");
  assert.equal(learned.status, 0, learned.stderr);
  const files = onMain(shared);
  assert.ok(files.includes("knowledge/notes/retries-need-jitter.md"), files.join("\n"));
  assert.ok(!files.includes("knowledge/.DS_Store"), "the junk file is untracked");
  const again = run(["knowledge", "sync", "--workspace", a]);
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.stdout + again.stderr, /nothing to commit|committed/);
});

test("install carries local notes of both stores into the shared clone", () => {
  const shared = remote();
  const dir = workspace();
  assert.equal(learn(dir, "Builds need the seed step").status, 0);
  assert.equal(decide(dir, "scope").status, 0);
  const [note] = ledgerNotes(dir);

  const installed = share(dir, shared);
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /Cloned .* into .*\.harness\/stores, shared by the knowledge store and the decisions ledger/);
  assert.match(installed.stdout, /Linked the decisions ledger at .* to its folder decisions\/ in the shared clone\nCopied 1 local note into the clone/);
  assert.match(installed.stdout, /Linked the knowledge store at .* to its folder knowledge\/ in the shared clone\nCopied 1 local note into the clone/);
  assert.ok(existsSync(resolve(`${ledger(dir)}.before-clone`, note)), "the old ledger folder is kept");
  assert.ok(existsSync(resolve(`${store(dir)}.before-clone`, "notes", "builds-need-the-seed-step.md")));

  const synced = run(["knowledge", "sync", "--workspace", dir]);
  assert.equal(synced.status, 0, synced.stderr);
  const files = onMain(shared);
  assert.ok(files.includes(`decisions/${note}`) && files.includes("knowledge/notes/builds-need-the-seed-step.md"), files.join("\n"));
  assert.equal(run(["install", dir]).status, 0, "a reinstall leaves the links as they are");
});

test("install keeps a store folder that's a link of the user's own, and carries its notes in", () => {
  const shared = remote();
  const dir = workspace();
  assert.equal(learn(dir, "Builds need the seed step").status, 0);
  const elsewhere = resolve(mkdtempSync(resolve(tmpdir(), "mahler-elsewhere-")), "knowledge");
  renameSync(store(dir), elsewhere);
  symlinkSync(elsewhere, store(dir));

  const installed = share(dir, shared);
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /Linked the knowledge store at .* in the shared clone\nCopied 1 local note into the clone/);
  assert.equal(realpathSync(`${store(dir)}.before-clone`), realpathSync(elsewhere), "the user's link is kept aside");
  assert.ok(existsSync(resolve(elsewhere, "notes", "builds-need-the-seed-step.md")), "what it leads to is untouched");
  assert.ok(existsSync(noteFile(dir, "builds-need-the-seed-step")));
});

test("install won't move a store with PRs on record into the shared clone", () => {
  const shared = remote();
  const dir = workspace();
  mkdirSync(resolve(store(dir), "pending"), { recursive: true });
  writeFileSync(resolve(store(dir), "pending", "prs.json"), `${JSON.stringify({ notes: { "a-note": { branch: "knowledge/a-note" } } })}\n`);
  const installed = share(dir, shared);
  assert.notEqual(installed.status, 0);
  assert.match(installed.stderr, /still has PRs on record from publishing on its own \(pending\/prs\.json\)/);
  assert.ok(!lstatSync(store(dir)).isSymbolicLink(), "the store stays where it was");
});

test("reinstall keeps the repoPath settings", () => {
  const shared = remote();
  const dir = sharedWorkspace(shared);
  assert.equal(run(["install", dir]).status, 0);
  const config = JSON.parse(readFileSync(resolve(dir, ".harness/config.json"), "utf8"));
  assert.equal(config.knowledge.repoPath, "knowledge");
  assert.equal(config.decisions.repoPath, "decisions");
  assert.equal(config.decisions.repo, shared);
});

test("install rejects repoPath settings that can't share one clone", () => {
  const shared = remote();
  const cases: [Record<string, string>, Record<string, string>, RegExp][] = [
    [{ repo: shared }, { repo: shared, repoPath: "decisions" }, /decisions\.repo is knowledge\.repo, on the same branch "main"; give each store its own folder/],
    [{ repo: shared, repoPath: "notes" }, { repo: shared, repoPath: "notes/decisions" }, /must be separate folders, neither inside the other/],
    [{ repo: shared, repoPath: "../up" }, { repo: shared, repoPath: "decisions" }, /knowledge\.repoPath must name a folder inside the repo/],
    [{ repo: shared, repoPath: "knowledge" }, { repo: remote(), repoPath: "decisions" }, /knowledge\.repoPath and decisions\.repoPath only apply when knowledge\.repo and decisions\.repo are the same repo on the same branch/],
    [{ repo: shared, repoPath: "knowledge" }, { repo: shared, branch: "backup", repoPath: "decisions" }, /only apply when .* same branch/],
    [{ repo: shared, repoPath: "knowledge", path: ".harness/stores/knowledge" }, { repo: shared, repoPath: "decisions" }, /knowledge\.path ".harness\/stores\/knowledge" can't hold or sit in .*stores, where the stores share their clone/],
  ];
  for (const [knowledge, decisions, message] of cases) {
    const dir = workspace();
    const installed = configure(dir, knowledge, decisions);
    assert.notEqual(installed.status, 0, JSON.stringify([knowledge, decisions]));
    assert.match(installed.stderr, message);
    assert.match(run(["doctor", dir]).stdout, message);
  }
});

/** Both stores sharing a repo whose main already holds a seed note and decision, publishing through PRs. */
function prWorkspace(): { shared: string; ws: string; gh: ReturnType<typeof forge> } {
  const shared = remote();
  const ws = sharedWorkspace(shared);
  assert.equal(learn(ws, "Seed note").status, 0);
  assert.equal(decide(ws, "seed").status, 0);
  const gh = forge();
  const installed = share(ws, shared, "pr", gh.env);
  assert.equal(installed.status, 0, installed.stderr);
  return { shared, ws, gh };
}

test("with PR publish, a decision goes up in a ledger PR of its own, apart from knowledge PRs", () => {
  const { shared, ws, gh } = prWorkspace();
  const before = onMain(shared);

  const decided = decide(ws, "skip-tester", gh.env);
  assert.equal(decided.status, 0, decided.stderr);
  assert.match(decided.stdout, /Ledger sync: proposed 1 edit in https:\/\/forge\.example\/pr\/1\./);
  const [note] = ledgerNotes(ws).filter((file) => file.includes("skip-tester"));
  assert.ok(note, "the decision is in the local ledger right away");
  assert.match(readFileSync(resolve(ledger(ws), "INDEX.md"), "utf8"), /skip-tester applied\./);

  const learned = learn(ws, "Retries need jitter", gh.env);
  assert.equal(learned.status, 0, learned.stderr);
  assert.match(learned.stdout, /opened https:\/\/forge\.example\/pr\/2 for retries-need-jitter/);

  const [ledgerPr, notePr] = gh.prs();
  assert.match(ledgerPr.head, /^decisions\/update-/);
  assert.equal(ledgerPr.title, `Decisions: update decisions/${note}`);
  assert.match(ledgerPr.body, /not backed up|only on the machine that recorded them/);
  assert.deepEqual(git(shared, ["diff", "--name-only", `main...${ledgerPr.head}`]).split("\n"), [`decisions/${note}`]);
  assert.deepEqual(git(shared, ["diff", "--name-only", `main...${notePr.head}`]).split("\n"), ["knowledge/notes/retries-need-jitter.md"]);
  assert.deepEqual(onMain(shared), before, "nothing lands on main before review");

  const doctor = run(["doctor", ws], gh.env);
  assert.match(doctor.stdout, /decisions ledger: backed up to .* through PRs/);
  assert.match(doctor.stdout, /decisions ledger PR awaiting review: 1 change, not backed up until it merges \(https:\/\/forge\.example\/pr\/1\)/);

  // Once the ledger PR merges, a sync settles it and pulls the note.
  merge(shared, gh, ledgerPr);
  const synced = run(["knowledge", "sync", "--workspace", ws], gh.env);
  assert.equal(synced.status, 0, synced.stderr);
  // The knowledge store's sync runs first, and settles and pulls for both.
  assert.match(
    synced.stdout,
    /^Knowledge sync: https:\/\/forge\.example\/pr\/1 merged \(decisions ledger\); pulled 1 commit\.\nLedger sync: already up to date\.$/m,
  );
  assert.equal(git(clone(ws), ["status", "--porcelain", "--", "decisions/"]), "", "the ledger has nothing left to propose");
  assert.ok(existsSync(resolve(ledger(ws), note)));
  assert.equal(gh.prs().length, 2, "no new PRs");
});

test("with PR publish, a decision whose name another machine took first is renamed", () => {
  const { shared, ws: a, gh } = prWorkspace();
  const b = sharedWorkspace(shared);
  assert.equal(share(b, shared, "pr", gh.env).status, 0);

  assert.equal(decide(a, "skip-tester", gh.env).status, 0);
  assert.equal(decide(b, "skip-tester", gh.env).status, 0);
  const [first, second] = gh.prs();
  merge(shared, gh, first);
  const [note] = ledgerNotes(b).filter((file) => file.includes("skip-tester"));

  const synced = run(["knowledge", "sync", "--workspace", b], gh.env);
  assert.equal(synced.status, 0, synced.stderr);
  const renamed = note.replace(/\.md$/, "-2.md");
  assert.match(synced.stdout, new RegExp(`renamed ${note.replace(/\./g, "\\.")} \\(another machine had used the name\\) to ${renamed.replace(/\./g, "\\.")}`));
  assert.match(synced.stdout, /updated https:\/\/forge\.example\/pr\/2 with 1 edit/);
  assert.ok(existsSync(resolve(ledger(b), note)) && existsSync(resolve(ledger(b), renamed)), "both decisions are kept");
  assert.deepEqual(git(shared, ["diff", "--name-only", `main...${second.head}`]).split("\n"), [`decisions/${renamed}`]);
});

test("with PR publish, a knowledge sync settles a ledger PR a reviewer edited, rather than tripping on it", () => {
  const { shared, ws, gh } = prWorkspace();
  assert.equal(decide(ws, "skip-tester", gh.env).status, 0);
  const [note] = ledgerNotes(ws).filter((file) => file.includes("skip-tester"));
  const [ledgerPr] = gh.prs();
  const reviewed = `${readFileSync(resolve(ledger(ws), note), "utf8")}\nReviewed.\n`;
  merge(shared, gh, ledgerPr, { edit: { path: `decisions/${note}`, text: reviewed } });

  const learned = learn(ws, "Retries need jitter", gh.env);
  assert.equal(learned.status, 0, learned.stderr);
  assert.doesNotMatch(learned.stdout + learned.stderr, /couldn't pull/);
  assert.match(learned.stdout, /^Knowledge sync: https:\/\/forge\.example\/pr\/1 merged \(decisions ledger\); pulled 1 commit; opened /m);
  assert.equal(readFileSync(resolve(ledger(ws), note), "utf8"), reviewed, "the ledger has the reviewed decision");

  const synced = run(["knowledge", "sync", "--workspace", ws], gh.env);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /^Ledger sync: already up to date\.$/m);
  assert.equal(git(clone(ws), ["status", "--porcelain", "--", "decisions/"]), "");
});

test("with PR publish, a merged decision edited here since isn't taken for another machine's", () => {
  const { shared, ws, gh } = prWorkspace();
  assert.equal(decide(ws, "skip-tester", gh.env).status, 0);
  const [note] = ledgerNotes(ws).filter((file) => file.includes("skip-tester"));
  const [ledgerPr] = gh.prs();
  const text = readFileSync(resolve(ledger(ws), note), "utf8");
  merge(shared, gh, ledgerPr, { edit: { path: `decisions/${note}`, text: `${text}\nReviewed.\n` } });
  writeFileSync(resolve(ledger(ws), note), `${text}\nEdited here.\n`);

  const synced = run(["knowledge", "sync", "--workspace", ws], gh.env);
  assert.equal(synced.status, 0, synced.stderr);
  assert.doesNotMatch(synced.stdout, /renamed/);
  assert.deepEqual(ledgerNotes(ws).filter((file) => file.includes("skip-tester")), [note], "no second copy of the decision");
  assert.match(synced.stdout + synced.stderr, new RegExp(`couldn't pull: your edits to decisions/${note.replace(/\./g, "\\.")} conflict`));
  assert.match(readFileSync(resolve(ledger(ws), note), "utf8"), /Edited here\./, "the local edit is kept");
});

test("with PR publish, a decision whose PR was closed unmerged stays here, flagged, and isn't proposed again", () => {
  const { shared, ws, gh } = prWorkspace();
  assert.equal(decide(ws, "skip-tester", gh.env).status, 0);
  const [note] = ledgerNotes(ws).filter((file) => file.includes("skip-tester"));
  const [closedPr] = gh.prs();
  gh.setState(closedPr.url, "CLOSED");

  const synced = run(["knowledge", "sync", "--workspace", ws], gh.env);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /https:\/\/forge\.example\/pr\/1 was closed unmerged; its change stays here, not backed up, and won't be proposed again/);
  assert.ok(existsSync(resolve(ledger(ws), note)), "the decision is kept");
  assert.match(readFileSync(resolve(ledger(ws), "INDEX.md"), "utf8"), /skip-tester applied\./);
  assert.equal(gh.prs().length, 1, "no new PR");
  assert.match(
    run(["doctor", ws], gh.env).stdout,
    /1 decisions ledger change not backed up: its PR was closed \(https:\/\/forge\.example\/pr\/1\)/,
  );

  // A later decision gets a PR of its own, without the closed one.
  assert.equal(decide(ws, "commit-size", gh.env).status, 0);
  const [, next] = gh.prs();
  const [later] = ledgerNotes(ws).filter((file) => file.includes("commit-size"));
  assert.deepEqual(git(shared, ["diff", "--name-only", `main...${next.head}`]).split("\n"), [`decisions/${later}`]);

  // Edited since, the closed decision is proposed again.
  writeFileSync(resolve(ledger(ws), note), `${readFileSync(resolve(ledger(ws), note), "utf8")}\nRevisited.\n`);
  const again = run(["knowledge", "sync", "--workspace", ws], gh.env);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, new RegExp(`decisions/${note.replace(/\./g, "\\.")} changed since https://forge\\.example/pr/1 was closed; proposing it again`));
  assert.deepEqual(git(shared, ["diff", "--name-only", `main...${next.head}`]).split("\n").sort(), [`decisions/${later}`, `decisions/${note}`].sort());
  assert.doesNotMatch(run(["doctor", ws], gh.env).stdout, /not backed up: its PR was closed/);
});

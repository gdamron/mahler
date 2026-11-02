import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { git, learn, remote, run, setRepo, workspace } from "./knowledge-fixtures.js";

/** The decisions ledger backed up to its own repo (`decisions.repo`). */

const ledger = (dir: string) => resolve(dir, ".harness/decisions");

function setLedgerRepo(dir: string, decisions: Record<string, string>) {
  const file = resolve(dir, ".harness/config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  config.decisions = { ...config.decisions, ...decisions };
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return run(["install", dir]);
}

function ledgerWorkspace(shared: string): string {
  const dir = workspace();
  const installed = setLedgerRepo(dir, { repo: shared });
  assert.equal(installed.status, 0, installed.stderr);
  return dir;
}

function decide(dir: string, rule: string, reason = `It fit here, in ${dir}.`) {
  return run([
    "decide", "--workspace", dir, "--rule", rule, "--description", `${rule} applied.`, "--reason", reason,
  ]);
}

const ledgerNotes = (dir: string) => readdirSync(ledger(dir)).filter((file) => /^\d{4}-.*\.md$/.test(file));

test("two workspaces backing up one ledger each see the other's decisions after sync", () => {
  const shared = remote();
  const a = ledgerWorkspace(shared);
  const b = ledgerWorkspace(shared);
  assert.ok(existsSync(resolve(ledger(a), ".git")), "install cloned the ledger");

  const first = decide(a, "skip-tester");
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Ledger sync: committed local changes; pushed 1 commit\./);
  assert.match(git(ledger(a), ["log", "-1", "--format=%s"]), /^decisions: add \d{4}-\d{2}-\d{2}-skip-tester$/);

  const synced = run(["knowledge", "sync", "--workspace", b]);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /Ledger sync: .*pulled 1 commit\./);
  assert.equal(ledgerNotes(b).length, 1);
  assert.match(readFileSync(resolve(ledger(b), "INDEX.md"), "utf8"), /skip-tester applied\./);

  const tracked = git(shared, ["ls-tree", "-r", "--name-only", "main"]).split("\n");
  assert.ok(tracked.includes("README.md"));
  assert.ok(!tracked.includes("INDEX.md"), "the generated index stays out of the repo");
});

test("the ledger and the knowledge store back up to different repos", () => {
  const knowledge = remote();
  const decisions = remote();
  const dir = workspace(knowledge);
  assert.equal(setLedgerRepo(dir, { repo: decisions, branch: "backup" }).status, 0);

  assert.equal(learn(dir, "Builds need the seed step").status, 0);
  assert.equal(decide(dir, "commit-size").status, 0);

  const knowledgeFiles = git(knowledge, ["ls-tree", "-r", "--name-only", "main"]);
  const ledgerFiles = git(decisions, ["ls-tree", "-r", "--name-only", "backup"]);
  assert.match(knowledgeFiles, /notes\/builds-need-the-seed-step\.md/);
  assert.doesNotMatch(knowledgeFiles, /commit-size/);
  assert.match(ledgerFiles, /\d{4}-\d{2}-\d{2}-commit-size\.md/);
  assert.doesNotMatch(ledgerFiles, /builds-need/);

  const doctor = run(["doctor", dir]);
  assert.ok(doctor.stdout.includes(`decisions ledger: backed up to ${decisions} on backup`), doctor.stdout);
});

test("install carries an existing local ledger into the clone, and sync backs it up", () => {
  const shared = remote();
  const dir = workspace();
  assert.equal(decide(dir, "scope").status, 0);
  const [note] = ledgerNotes(dir);

  const installed = setLedgerRepo(dir, { repo: shared });
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /Cloned the decisions ledger from .*\nCopied 1 local note into the clone/);
  assert.ok(existsSync(resolve(`${ledger(dir)}.before-clone`, note)), "the old folder is kept");
  assert.ok(existsSync(resolve(ledger(dir), "README.md")), "install keeps the ledger's README");

  const synced = run(["knowledge", "sync", "--workspace", dir]);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /Ledger sync: committed local changes; pushed 1 commit\./);
  assert.ok(git(shared, ["ls-tree", "-r", "--name-only", "main"]).split("\n").includes(note));
});

test("a decision recorded offline is saved, warns, and the next sync backs it up", () => {
  const shared = remote();
  const dir = ledgerWorkspace(shared);
  const away = `${shared}.away`;
  renameSync(shared, away);
  const offline = decide(dir, "skip-tester");
  assert.equal(offline.status, 0, offline.stderr);
  assert.match(offline.stdout, /Recorded decision: /);
  assert.match(offline.stderr, /Ledger sync: committed local changes; couldn't reach /);
  assert.match(run(["doctor", dir]).stdout, /decisions ledger has 1 commit not backed up; run `mahler knowledge sync`/);
  renameSync(away, shared);

  const synced = run(["knowledge", "sync", "--workspace", dir]);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /Ledger sync: pushed 1 commit\./);
  assert.equal(git(shared, ["rev-list", "--count", "main"]), "1");
});

test("a brief pulls decisions others backed up", () => {
  const shared = remote();
  const a = ledgerWorkspace(shared);
  const b = ledgerWorkspace(shared);
  assert.equal(decide(a, "skip-tester").status, 0);
  const brief = run(["task", "brief-check", "--workspace", b, "--agent", "claude", "--title", "Check the brief"]);
  assert.equal(brief.status, 0, brief.stderr);
  assert.equal(ledgerNotes(b).length, 1);
  assert.match(readFileSync(resolve(ledger(b), "INDEX.md"), "utf8"), /skip-tester applied\./);
});

test("importing a ledger note with --archive backs up the move", () => {
  const shared = remote();
  const dir = ledgerWorkspace(shared);
  assert.equal(decide(dir, "cache-get-null").status, 0);
  const [note] = ledgerNotes(dir);

  const imported = run(["knowledge", "import", note, "--archive", "--workspace", dir]);
  assert.equal(imported.status, 0, imported.stderr);
  assert.match(imported.stdout, /Ledger sync: committed local changes; pushed 1 commit\./);
  const tracked = git(shared, ["ls-tree", "-r", "--name-only", "main"]).split("\n");
  assert.ok(tracked.includes(`archive/${note}`));
  assert.ok(!tracked.includes(note));
});

test("a knowledge sync failure doesn't stop the ledger's backup", () => {
  const knowledge = remote();
  const decisions = remote();
  const dir = workspace(knowledge);
  assert.equal(setLedgerRepo(dir, { repo: decisions }).status, 0);
  // A store folder that isn't a clone can't sync.
  renameSync(resolve(dir, ".harness/knowledge/.git"), resolve(dir, ".harness/knowledge-git-aside"));
  writeFileSync(resolve(ledger(dir), "2026-01-02-by-hand.md"), "---\ndate: 2026-01-02\nrule: by-hand\n---\nAdded by hand.\n");

  const synced = run(["knowledge", "sync", "--workspace", dir]);
  assert.notEqual(synced.status, 0);
  assert.match(synced.stderr, /isn't a clone of/);
  assert.match(synced.stdout, /Ledger sync: committed local changes; pushed 1 commit\./);
  assert.ok(git(decisions, ["ls-tree", "-r", "--name-only", "main"]).split("\n").includes("2026-01-02-by-hand.md"));
});

test("doctor reports a ledger folder that isn't a clone of decisions.repo", () => {
  const dir = workspace();
  const file = resolve(dir, ".harness/config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  config.decisions = { repo: remote() };
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  const doctor = run(["doctor", dir]);
  assert.match(doctor.stdout, /decisions ledger: .*decisions exists but isn't a clone of /);
});

test("a reinstall keeps decisions.repo", () => {
  const shared = remote();
  const dir = ledgerWorkspace(shared);
  assert.equal(setRepo(dir, {}).status, 0);
  const config = JSON.parse(readFileSync(resolve(dir, ".harness/config.json"), "utf8"));
  assert.equal(config.decisions.repo, shared);
});

test("two machines recording the same rule on the same day keep both notes", () => {
  const shared = remote();
  const a = ledgerWorkspace(shared);
  const b = ledgerWorkspace(shared);
  assert.equal(decide(a, "scope").status, 0);
  const second = decide(b, "scope");
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /renamed (\d{4}-\d{2}-\d{2})-scope\.md \(another machine had used the name\) to \1-scope-2\.md; pulled 1 commit; pushed 1 commit/);
  assert.match(second.stdout, /the note is now .*-scope-2\.md; reference that\./);
  const tracked = git(shared, ["ls-tree", "-r", "--name-only", "main"]).split("\n").filter((file) => file.includes("scope"));
  assert.equal(tracked.length, 2);

  const later = decide(b, "commit-size");
  assert.equal(later.status, 0, later.stderr);
  assert.doesNotMatch(later.stderr, /conflict/);
  assert.equal(run(["knowledge", "sync", "--workspace", a]).status, 0);
  assert.equal(ledgerNotes(a).length, 3);

  // Again, now that both clones share history.
  assert.equal(decide(a, "review").status, 0);
  const again = decide(b, "review");
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /renamed .*-review\.md \(another machine had used the name\) to .*-review-2\.md/);
  assert.equal(git(shared, ["ls-tree", "-r", "--name-only", "main"]).split("\n").filter((file) => file.includes("review")).length, 2);
});

test("a clash with a decision recorded offline is renamed when it reconnects", () => {
  const shared = remote();
  const a = ledgerWorkspace(shared);
  const b = ledgerWorkspace(shared);
  const away = `${shared}.away`;
  renameSync(shared, away);
  assert.equal(decide(b, "scope").status, 0);
  assert.equal(decide(b, "commit-size").status, 0);
  renameSync(away, shared);
  assert.equal(decide(a, "scope").status, 0);

  const synced = run(["knowledge", "sync", "--workspace", b]);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /renamed .*-scope\.md \(another machine had used the name\) to .*-scope-2\.md/);
  assert.equal(git(shared, ["ls-tree", "-r", "--name-only", "main"]).split("\n").filter((file) => /^\d{4}-/.test(file)).length, 3);
});

test("install carries a local note whose name the repo already has under a new name", () => {
  const shared = remote();
  const a = ledgerWorkspace(shared);
  const dir = workspace();
  assert.equal(decide(a, "scope").status, 0);
  assert.equal(decide(dir, "scope").status, 0);
  const installed = setLedgerRepo(dir, { repo: shared });
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /copied in under new names: (\d{4}-\d{2}-\d{2})-scope\.md as \1-scope-2\.md/);
  assert.equal(ledgerNotes(dir).length, 2);
});

test("the ledger can't share the knowledge store's branch", () => {
  const shared = remote();
  const dir = workspace(shared);
  assert.equal(learn(dir, "Builds need the seed step").status, 0);
  const installed = setLedgerRepo(dir, { repo: shared });
  assert.notEqual(installed.status, 0);
  assert.match(installed.stderr, /decisions\.repo is knowledge\.repo, on the same branch "main"/);
  assert.match(run(["doctor", dir]).stdout, /decisions ledger: decisions\.repo is knowledge\.repo/);

  assert.equal(setLedgerRepo(dir, { repo: shared, branch: "decisions" }).status, 0);
  assert.equal(decide(dir, "scope").status, 0);
  assert.match(git(shared, ["ls-tree", "-r", "--name-only", "decisions"]), /-scope\.md/);
  assert.doesNotMatch(git(shared, ["ls-tree", "-r", "--name-only", "main"]), /-scope\.md/);
});

test("decide with an unreadable config saves the note and exits cleanly", () => {
  const dir = ledgerWorkspace(remote());
  writeFileSync(resolve(dir, ".harness/config.json"), "{");
  const result = decide(dir, "scope");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /is saved locally, but it wasn't backed up/);
  assert.equal(ledgerNotes(dir).length, 1);
});

test("archiving one note on two machines is a conflict, not a renamed copy", () => {
  const shared = remote();
  const a = ledgerWorkspace(shared);
  const b = ledgerWorkspace(shared);
  assert.equal(decide(a, "shared-note").status, 0);
  assert.equal(run(["knowledge", "sync", "--workspace", b]).status, 0);
  const [note] = ledgerNotes(a);
  assert.equal(run(["knowledge", "import", note, "--archive", "--slug", "from-a", "--workspace", a]).status, 0);
  const away = `${shared}.away`;
  renameSync(shared, away);
  assert.equal(run(["knowledge", "import", note, "--archive", "--slug", "from-b", "--workspace", b]).status, 0);
  renameSync(away, shared);

  const synced = run(["knowledge", "sync", "--workspace", b]);
  assert.notEqual(synced.status, 0);
  assert.match(synced.stderr, /Ledger sync stopped: your changes conflict with the remote in archive\//);
  assert.ok(!git(shared, ["ls-tree", "-r", "--name-only", "main"]).includes("-2.md"));
});

test("with no shared history, the remote's README wins instead of conflicting", () => {
  const shared = remote();
  const a = ledgerWorkspace(shared);
  const b = ledgerWorkspace(shared);
  writeFileSync(resolve(ledger(b), "README.md"), "# Our own readme\n");
  assert.equal(decide(a, "scope").status, 0);
  const second = decide(b, "scope");
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /pushed 1 commit/);
  assert.equal(readFileSync(resolve(ledger(b), "README.md"), "utf8"), readFileSync(resolve(ledger(a), "README.md"), "utf8"));
});

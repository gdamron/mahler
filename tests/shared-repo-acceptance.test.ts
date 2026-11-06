import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { type FakePr, forge, git, learn, merge, noteFile, remote, run, store, workspace } from "./knowledge-fixtures.js";

/**
 * Acceptance tests: the knowledge store and the decisions ledger sharing one
 * repo and branch, each under its own folder (`repoPath`).
 */

type Env = Record<string, string>;
const ledger = (dir: string) => resolve(dir, ".harness/decisions");
const configFile = (dir: string) => resolve(dir, ".harness/config.json");
const readConfig = (dir: string) => JSON.parse(readFileSync(configFile(dir), "utf8"));

/** Merge settings into `knowledge` and/or `decisions`, then reinstall. */
function configure(dir: string, stores: { knowledge?: Record<string, string>; decisions?: Record<string, string> }, extraEnv: Env = {}) {
  const config = readConfig(dir);
  if (stores.knowledge) config.knowledge = { ...config.knowledge, ...stores.knowledge };
  if (stores.decisions) config.decisions = { ...(config.decisions ?? {}), ...stores.decisions };
  writeFileSync(configFile(dir), `${JSON.stringify(config, null, 2)}\n`);
  return run(["install", dir], extraEnv);
}

const sharedStores = (shared: string) => ({
  knowledge: { repo: shared, repoPath: "knowledge" },
  decisions: { repo: shared, repoPath: "decisions" },
});

function sharedWorkspace(shared: string): string {
  const dir = workspace();
  const installed = configure(dir, sharedStores(shared));
  assert.equal(installed.status, 0, installed.stderr);
  return dir;
}

function decide(dir: string, rule: string, extraEnv: Env = {}) {
  return run(["decide", "--workspace", dir, "--rule", rule, "--description", `${rule} applied.`, "--reason", `It fit, in ${dir}.`], extraEnv);
}

const sync = (dir: string, extraEnv: Env = {}) => run(["knowledge", "sync", "--workspace", dir], extraEnv);
const ledgerNotes = (dir: string) => readdirSync(ledger(dir)).filter((file) => /^\d{4}-.*\.md$/.test(file));
const tracked = (shared: string, ref = "main") => git(shared, ["ls-tree", "-r", "--name-only", ref]).split("\n").filter(Boolean);
const head = (shared: string, ref = "main") => git(shared, ["rev-parse", ref]);
/** Every file touched by commits on the remote's main after `since`. */
function touchedSince(shared: string, since: string): string[] {
  const out = git(shared, ["log", "--name-only", "--format=", `${since}..main`]);
  return out.split("\n").filter(Boolean);
}
/** Files a PR's branch changes relative to main. */
const prFiles = (shared: string, pr: FakePr) =>
  git(shared, ["diff", "--name-only", `main...refs/heads/${pr.head}`]).split("\n").filter(Boolean);

test("install clones the shared repo once into stores/, links both stores, and carries existing notes over", () => {
  const shared = remote();
  const dir = workspace(undefined, ["Builds need the seed step"]);
  assert.equal(decide(dir, "skip-tester").status, 0);
  const [note] = ledgerNotes(dir);
  assert.ok(note);

  const installed = configure(dir, sharedStores(shared));
  assert.equal(installed.status, 0, installed.stderr);

  const stores = realpathSync(resolve(dir, ".harness/stores"));
  for (const link of [store(dir), ledger(dir)]) assert.ok(lstatSync(link).isSymbolicLink(), `${link} is a link`);
  const top = git(realpathSync(store(dir)), ["rev-parse", "--show-toplevel"]);
  assert.equal(git(realpathSync(ledger(dir)), ["rev-parse", "--show-toplevel"]), top, "one clone serves both stores");
  assert.ok(!relative(stores, realpathSync(top)).startsWith(".."), "the clone lives under .harness/stores");
  assert.equal(relative(realpathSync(top), realpathSync(store(dir))), "knowledge");
  assert.equal(relative(realpathSync(top), realpathSync(ledger(dir))), "decisions");

  assert.ok(existsSync(noteFile(dir, "builds-need-the-seed-step")), "knowledge note carried into the clone");
  assert.ok(existsSync(resolve(ledger(dir), note)), "ledger note carried into the clone");
  assert.ok(existsSync(resolve(dir, ".harness/knowledge.before-clone/notes/builds-need-the-seed-step.md")));
  assert.ok(existsSync(resolve(dir, ".harness/decisions.before-clone", note)));

  const synced = sync(dir);
  assert.equal(synced.status, 0, synced.stderr);
  const files = tracked(shared);
  assert.ok(files.includes("knowledge/notes/builds-need-the-seed-step.md"), files.join("\n"));
  assert.ok(files.includes(`decisions/${note}`), files.join("\n"));
  assert.ok(!files.some((file) => file.endsWith("INDEX.md")), "generated indexes stay out of the repo");
});

test("reinstall keeps the repoPath settings and leaves a working layout alone", () => {
  const shared = remote();
  const dir = sharedWorkspace(shared);
  assert.equal(learn(dir, "First note").status, 0);
  const before = { knowledge: realpathSync(store(dir)), decisions: realpathSync(ledger(dir)) };

  const again = run(["install", dir]);
  assert.equal(again.status, 0, again.stderr);
  const config = readConfig(dir);
  assert.equal(config.knowledge.repoPath, "knowledge");
  assert.equal(config.decisions.repoPath, "decisions");
  assert.equal(config.knowledge.repo, shared);
  assert.equal(config.decisions.repo, shared);
  assert.ok(lstatSync(store(dir)).isSymbolicLink());
  assert.ok(lstatSync(ledger(dir)).isSymbolicLink());
  assert.equal(realpathSync(store(dir)), before.knowledge);
  assert.equal(realpathSync(ledger(dir)), before.decisions);
  assert.ok(existsSync(noteFile(dir, "first-note")));
  assert.ok(!existsSync(resolve(dir, ".harness/stores.before-clone")));

  const doctor = run(["doctor", dir]);
  assert.equal(doctor.status, 0, doctor.stdout);
  assert.equal(learn(dir, "Second note").status, 0);
  assert.ok(tracked(shared).includes("knowledge/notes/second-note.md"));
});

test("direct publish: learn commits only under the knowledge folder, decide only under the decisions folder", () => {
  const shared = remote();
  const dir = sharedWorkspace(shared);
  assert.equal(learn(dir, "Seed note").status, 0);

  const beforeLearn = head(shared);
  const learned = learn(dir, "Retries need jitter");
  assert.equal(learned.status, 0, learned.stderr);
  const learnFiles = touchedSince(shared, beforeLearn);
  assert.ok(learnFiles.includes("knowledge/notes/retries-need-jitter.md"), learnFiles.join("\n"));
  assert.ok(learnFiles.every((file) => file.startsWith("knowledge/")), learnFiles.join("\n"));

  const beforeDecide = head(shared);
  const decided = decide(dir, "commit-size");
  assert.equal(decided.status, 0, decided.stderr);
  const decideFiles = touchedSince(shared, beforeDecide);
  assert.ok(decideFiles.some((file) => /^decisions\/\d{4}-\d{2}-\d{2}-commit-size\.md$/.test(file)), decideFiles.join("\n"));
  assert.ok(decideFiles.every((file) => file.startsWith("decisions/")), decideFiles.join("\n"));
  assert.ok(!tracked(shared).some((file) => file.endsWith("INDEX.md")));
});

test("syncing one store never commits or drops the other store's uncommitted edits", () => {
  const shared = remote();
  const dir = sharedWorkspace(shared);
  assert.equal(learn(dir, "Seed note").status, 0);
  assert.equal(decide(dir, "scope").status, 0);

  // A hand-written ledger note, not yet synced, must survive `mahler learn`.
  const byHand = resolve(ledger(dir), "2026-01-02-by-hand.md");
  const byHandText = "---\ndate: 2026-01-02\nrule: by-hand\n---\nAdded by hand.\n";
  writeFileSync(byHand, byHandText);
  const learned = learn(dir, "Another note");
  assert.equal(learned.status, 0, learned.stderr);
  assert.ok(tracked(shared).includes("knowledge/notes/another-note.md"));
  assert.ok(!tracked(shared).includes("decisions/2026-01-02-by-hand.md"), "learn didn't commit the ledger edit");
  assert.equal(readFileSync(byHand, "utf8"), byHandText, "learn didn't drop or overwrite the ledger edit");

  // A hand edit to a knowledge note must survive `mahler decide`.
  const seed = noteFile(dir, "seed-note");
  const edited = `${readFileSync(seed, "utf8")}\nA local correction.\n`;
  writeFileSync(seed, edited);
  const decided = decide(dir, "review");
  assert.equal(decided.status, 0, decided.stderr);
  assert.ok(tracked(shared).some((file) => /^decisions\/.*-review\.md$/.test(file)));
  assert.doesNotMatch(git(shared, ["show", "main:knowledge/notes/seed-note.md"]), /A local correction/, "decide didn't commit the knowledge edit");
  assert.equal(readFileSync(seed, "utf8"), edited, "decide didn't drop or overwrite the knowledge edit");

  // `mahler knowledge sync` then syncs both stores.
  const synced = sync(dir);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(git(shared, ["show", "main:knowledge/notes/seed-note.md"]), /A local correction/);
  assert.ok(tracked(shared).includes("decisions/2026-01-02-by-hand.md"));
});

test("pulling one store's changes from another machine keeps local edits to the other store", () => {
  const shared = remote();
  const a = sharedWorkspace(shared);
  assert.equal(learn(a, "Seed note").status, 0);
  const b = sharedWorkspace(shared);
  assert.ok(existsSync(noteFile(b, "seed-note")));

  const seed = noteFile(b, "seed-note");
  const edited = `${readFileSync(seed, "utf8")}\nB's unsynced edit.\n`;
  writeFileSync(seed, edited);
  assert.equal(learn(a, "From a").status, 0);
  assert.equal(decide(a, "skip-tester").status, 0);

  const decided = decide(b, "commit-size");
  assert.equal(decided.status, 0, decided.stderr);
  assert.equal(readFileSync(seed, "utf8"), edited, "B's knowledge edit survives the ledger sync");
  assert.doesNotMatch(git(shared, ["show", "main:knowledge/notes/seed-note.md"]), /B's unsynced edit/);
  assert.ok(tracked(shared).some((file) => /^decisions\/.*-commit-size\.md$/.test(file)));
  assert.ok(tracked(shared).some((file) => /^decisions\/.*-skip-tester\.md$/.test(file)), "A's decision wasn't dropped");
});

test("a second workspace sharing the repo sees both stores' notes after sync", () => {
  const shared = remote();
  const a = sharedWorkspace(shared);
  const b = sharedWorkspace(shared);
  assert.equal(learn(a, "Builds need the seed step").status, 0);
  assert.equal(decide(a, "skip-tester").status, 0);

  const synced = sync(b);
  assert.equal(synced.status, 0, synced.stderr);
  assert.ok(existsSync(noteFile(b, "builds-need-the-seed-step")));
  assert.equal(ledgerNotes(b).length, 1);
  assert.match(ledgerNotes(b)[0], /-skip-tester\.md$/);
  assert.ok(!tracked(shared).some((file) => file.endsWith("INDEX.md")));
});

test("two machines recording the same decision name keep both, the second renamed -2", () => {
  const shared = remote();
  const a = sharedWorkspace(shared);
  const b = sharedWorkspace(shared);
  assert.equal(decide(a, "scope").status, 0);
  const second = decide(b, "scope");
  assert.equal(second.status, 0, second.stderr);
  const scopes = tracked(shared).filter((file) => file.includes("-scope"));
  assert.equal(scopes.length, 2, scopes.join("\n"));
  assert.ok(scopes.every((file) => file.startsWith("decisions/")));
  assert.ok(scopes.some((file) => /-scope-2\.md$/.test(file)), scopes.join("\n"));
  assert.equal(sync(a).status, 0);
  assert.equal(ledgerNotes(a).length, 2);
});

test("install and doctor reject invalid shared-repo layouts", () => {
  const shared = remote();
  const other = remote();
  const dir = workspace();
  const cases: Array<{ name: string; knowledge: Record<string, string>; decisions: Record<string, string> }> = [
    { name: "same repo and branch without repoPaths", knowledge: { repo: shared }, decisions: { repo: shared } },
    { name: "repoPath with separate repos", knowledge: { repo: shared, repoPath: "knowledge" }, decisions: { repo: other, repoPath: "decisions" } },
    { name: "repoPath with different branches", knowledge: { repo: shared, repoPath: "knowledge" }, decisions: { repo: shared, branch: "ledger", repoPath: "decisions" } },
    { name: "equal repoPaths", knowledge: { repo: shared, repoPath: "memory" }, decisions: { repo: shared, repoPath: "memory" } },
    { name: "nested repoPaths", knowledge: { repo: shared, repoPath: "memory" }, decisions: { repo: shared, repoPath: "memory/decisions" } },
    { name: "repoPath escaping the repo", knowledge: { repo: shared, repoPath: "knowledge" }, decisions: { repo: shared, repoPath: "../decisions" } },
  ];
  const baseline = readConfig(dir);
  for (const { name, knowledge, decisions } of cases) {
    const config = { ...baseline, knowledge: { ...baseline.knowledge, ...knowledge }, decisions };
    writeFileSync(configFile(dir), `${JSON.stringify(config, null, 2)}\n`);
    const installed = run(["install", dir]);
    assert.notEqual(installed.status, 0, `install should reject: ${name}\n${installed.stdout}`);
    const doctor = run(["doctor", dir]);
    assert.notEqual(doctor.status, 0, `doctor should report: ${name}\n${doctor.stdout}`);
  }
  assert.ok(!existsSync(resolve(dir, ".harness/stores")), "nothing was cloned for a rejected layout");
});

test("existing layouts keep working: no ledger repo, and the ledger on another branch", () => {
  const shared = remote();
  const dir = workspace(shared);
  assert.equal(learn(dir, "Seed note").status, 0);
  assert.equal(decide(dir, "local-only").status, 0);
  assert.ok(tracked(shared).includes("notes/seed-note.md"), "knowledge stays at the repo root without repoPath");
  assert.ok(!tracked(shared).some((file) => file.includes("local-only")), "no decisions repo, no backup");
  assert.ok(!lstatSync(store(dir)).isSymbolicLink());

  const installed = configure(dir, { decisions: { repo: shared, branch: "decisions" } });
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(decide(dir, "on-branch").status, 0);
  assert.ok(tracked(shared, "decisions").some((file) => /-on-branch\.md$/.test(file)));
  assert.ok(!tracked(shared).some((file) => file.includes("on-branch")));
  assert.equal(run(["doctor", dir]).status, 0);
});

/** A shared workspace in PR publish mode, on a remote whose main already has a seed note. */
function prSharedWorkspace(shared: string, gh: ReturnType<typeof forge>, seed: boolean): string {
  const dir = sharedWorkspace(shared);
  if (seed) assert.equal(learn(dir, "Seed note").status, 0);
  const switched = configure(dir, { knowledge: { publish: "pr" } }, gh.env);
  assert.equal(switched.status, 0, switched.stderr);
  return dir;
}

test("PR publish: a decision is recorded at once and proposed in a ledger PR of its own", () => {
  const shared = remote();
  const gh = forge();
  const dir = prSharedWorkspace(shared, gh, true);
  const mainBefore = head(shared);

  const decided = decide(dir, "skip-tester", gh.env);
  assert.equal(decided.status, 0, decided.stderr);
  assert.equal(ledgerNotes(dir).length, 1, "the note is written right away");
  const [note] = ledgerNotes(dir);
  assert.equal(gh.prs().length, 1);
  const ledgerPr = gh.prs()[0];
  assert.equal(ledgerPr.base, "main");
  const ledgerFiles = prFiles(shared, ledgerPr);
  assert.ok(ledgerFiles.includes(`decisions/${note}`), ledgerFiles.join("\n"));
  assert.ok(ledgerFiles.every((file) => file.startsWith("decisions/")), ledgerFiles.join("\n"));
  assert.equal(head(shared), mainBefore, "nothing lands on main before review");

  const learned = learn(dir, "Retries need jitter", gh.env);
  assert.equal(learned.status, 0, learned.stderr);
  assert.ok(existsSync(resolve(store(dir), "pending", "retries-need-jitter.md")));
  assert.equal(gh.prs().length, 2, "the knowledge note gets a PR of its own");
  const knowledgePr = gh.prs()[1];
  assert.notEqual(knowledgePr.head, ledgerPr.head);
  const knowledgeFiles = prFiles(shared, knowledgePr);
  assert.ok(knowledgeFiles.includes("knowledge/notes/retries-need-jitter.md"), knowledgeFiles.join("\n"));
  assert.ok(knowledgeFiles.every((file) => file.startsWith("knowledge/")), knowledgeFiles.join("\n"));
  assert.equal(head(shared), mainBefore);

  merge(shared, gh, ledgerPr);
  const synced = sync(dir, gh.env);
  assert.equal(synced.status, 0, synced.stderr);
  assert.ok(tracked(shared).includes(`decisions/${note}`));
  assert.ok(existsSync(resolve(ledger(dir), note)), "the note stays after its PR merges");
  assert.equal(ledgerNotes(dir).length, 1);
  assert.equal(gh.prs().length, 2, "a merged decision isn't proposed again");
  assert.equal(sync(dir, gh.env).status, 0);
  assert.equal(gh.prs().length, 2);
  assert.ok(!tracked(shared).includes("knowledge/notes/retries-need-jitter.md"), "the knowledge PR is still waiting");
});

test("PR publish: two machines' same-named decisions are both kept, the later one renamed -2", () => {
  const shared = remote();
  const gh = forge();
  const a = prSharedWorkspace(shared, gh, true);
  const b = prSharedWorkspace(shared, gh, false);

  assert.equal(decide(a, "scope", gh.env).status, 0);
  assert.equal(decide(b, "scope", gh.env).status, 0);
  assert.equal(gh.prs().length, 2);
  merge(shared, gh, gh.prs()[0]);

  const synced = sync(b, gh.env);
  assert.equal(synced.status, 0, synced.stderr);
  assert.equal(ledgerNotes(b).length, 2, ledgerNotes(b).join("\n"));
  assert.ok(ledgerNotes(b).some((file) => /-scope-2\.md$/.test(file)), ledgerNotes(b).join("\n"));

  for (const pr of gh.prs().filter((candidate) => candidate.state === "OPEN")) {
    assert.ok(prFiles(shared, pr).every((file) => file.startsWith("decisions/")), prFiles(shared, pr).join("\n"));
    merge(shared, gh, pr);
  }
  assert.equal(sync(b, gh.env).status, 0);
  assert.equal(sync(a, gh.env).status, 0);
  const scopes = tracked(shared).filter((file) => /^decisions\/.*-scope(-2)?\.md$/.test(file));
  assert.equal(scopes.length, 2, scopes.join("\n"));
  assert.equal(ledgerNotes(a).length, 2);
});

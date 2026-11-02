import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseNote, relevantNotes, searchNotes } from "../src/knowledge.js";

const cliPath = resolve("dist/src/cli.js");

function run(args: string[], cwd?: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("node", [cliPath, ...args], { encoding: "utf8", cwd });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

/** A workspace with the given repos, each with one commit on main. */
function workspaceWith(repos: string[]): string {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-knowledge-"));
  for (const repo of repos) {
    const dir = resolve(workspace, repo);
    spawnSync("git", ["init", "-q", "-b", "main", dir]);
    writeFileSync(resolve(dir, "README.md"), "x\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-q", "-m", "init"]);
  }
  assert.equal(run(["install", workspace]).status, 0);
  return workspace;
}

function learn(workspace: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  return run(["learn", "--workspace", workspace, ...args]);
}

test("learn writes an Obsidian-readable note and indexes it", () => {
  const workspace = workspaceWith(["app"]);
  const created = learn(workspace, [
    "--title", "Storage exists() can't tell denied from absent",
    "--description", "exists() returns false for a 400, and a denied read is a 400. Use list() with an exact-name filter.",
    "--tags", "supabase,Storage",
    "--repos", "app",
    "--paths", "src/storage/**",
    "--source", "DEV-783",
    "--body", "Longer explanation.",
  ]);
  assert.equal(created.status, 0, created.stderr);
  const file = resolve(workspace, ".harness/knowledge/notes/storage-exists-can-t-tell-denied-from-absent.md");
  const text = readFileSync(file, "utf8");
  assert.match(text, /^---\ntitle: "Storage exists\(\) can't tell denied from absent"\n/);
  assert.match(text, /tags: \[supabase, storage\]/);
  assert.match(text, /paths: \["src\/storage\/\*\*"\]/);
  assert.match(text, /verified: \d{4}-\d{2}-\d{2}/);
  assert.match(text, /\nLonger explanation\.\n$/);
  const note = parseNote(text, "x");
  assert.deepEqual(note.paths, ["src/storage/**"]);
  assert.deepEqual(note.sources, ["DEV-783"]);

  const index = readFileSync(resolve(workspace, ".harness/knowledge/INDEX.md"), "utf8");
  assert.match(index, /## supabase\n\n- \[Storage exists\(\) can't tell denied from absent\]\(notes\/storage-exists-can-t-tell-denied-from-absent\.md\): exists\(\) returns false/);
  assert.match(index, /#supabase #storage \(repos: app\)/);
});

test("learn refuses a slug that exists, and an unknown repo", () => {
  const workspace = workspaceWith(["app"]);
  const args = ["--title", "Builds need setup", "--description", "Run setup first."];
  assert.equal(learn(workspace, args).status, 0);
  const again = learn(workspace, args);
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /already uses the slug "builds-need-setup"/);
  assert.match(again.stderr, /Run setup first\./);
  const badRepo = learn(workspace, ["--title", "t", "--description", "d", "--repos", "nope"]);
  assert.notEqual(badRepo.status, 0);
  assert.match(badRepo.stderr, /Unknown repo "nope"\. Configured repos: app/);
});

test("learn points at similar notes", () => {
  const workspace = workspaceWith(["app"]);
  learn(workspace, ["--title", "Storage list() matches by prefix", "--description", "Filter storage results for the exact name.", "--tags", "storage"]);
  const second = learn(workspace, ["--title", "Storage list() caps results at 100", "--description", "Pass an explicit storage limit.", "--tags", "storage"]);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /Similar notes[^\n]*\n- \[Storage list\(\) matches by prefix\]/);
});

test("search ranks title and tag matches first and filters by repo", () => {
  const workspace = workspaceWith(["app", "api"]);
  learn(workspace, ["--title", "Worktree env points at production", "--description", "Copy .env.local, not .env.", "--tags", "env", "--repos", "app"]);
  learn(workspace, ["--title", "Migrations run in order", "--description", "The env file is not read by migrations.", "--repos", "api"]);
  const both = run(["knowledge", "search", "env", "--workspace", workspace]);
  assert.equal(both.status, 0, both.stderr);
  const lines = both.stdout.trim().split("\n");
  assert.match(lines[0], /Worktree env points at production/);
  assert.match(lines[1], /Migrations run in order/);
  const apiOnly = run(["knowledge", "search", "env", "--repo", "api", "--workspace", workspace]);
  assert.doesNotMatch(apiOnly.stdout, /Worktree env/);
  assert.match(run(["knowledge", "search", "nothing-like-this", "--workspace", workspace]).stdout, /No notes match/);
  const usage = run(["knowledge", "search", "--workspace", workspace]);
  assert.notEqual(usage.status, 0);
  assert.match(usage.stderr, /give search terms, --paths/);
});

test("search finds notes by changed files, given or from the branch", () => {
  const workspace = workspaceWith(["app"]);
  learn(workspace, ["--title", "Storage writes archive first", "--description", "Archive before overwrite.", "--repos", "app", "--paths", "src/storage/**"]);
  learn(workspace, ["--title", "UI tests need a browser", "--description", "Install playwright.", "--paths", "src/ui/**"]);

  const given = run(["knowledge", "search", "--paths", "src/storage/write.ts,docs/x.md", "--workspace", workspace]);
  assert.equal(given.status, 0, given.stderr);
  assert.match(given.stdout, /Storage writes archive first[^\n]*\n  matches: src\/storage\/write\.ts\n/);
  assert.doesNotMatch(given.stdout, /UI tests/);

  const repo = resolve(workspace, "app");
  assert.match(run(["knowledge", "search", "--changed"], repo).stdout, /No files changed on this branch/);
  git(repo, ["checkout", "-q", "-b", "feature"]);
  spawnSync("mkdir", ["-p", resolve(repo, "src/storage")]);
  writeFileSync(resolve(repo, "src/storage/write.ts"), "export {};\n");
  const changed = run(["knowledge", "search", "--changed"], repo);
  assert.equal(changed.status, 0, changed.stderr);
  assert.match(changed.stdout, /Storage writes archive first[^\n]*\n  matches: src\/storage\/write\.ts/);

  const outside = run(["knowledge", "search", "--changed", "--workspace", workspace], tmpdir());
  assert.notEqual(outside.status, 0);
  assert.match(outside.stderr, /--changed needs to run inside a worktree/);
});

test("verify sets today's date and keeps the rest of the note as written", () => {
  const workspace = workspaceWith(["app"]);
  learn(workspace, ["--title", "Old fact", "--description", "Still true."]);
  const file = resolve(workspace, ".harness/knowledge/notes/old-fact.md");
  writeFileSync(file, readFileSync(file, "utf8").replace(/verified: .*/, "verified: 2020-01-01").replace("Still true.", "Still true, edited by hand."));
  const verified = run(["knowledge", "verify", "old-fact", "--workspace", workspace]);
  assert.equal(verified.status, 0, verified.stderr);
  const text = readFileSync(file, "utf8");
  assert.match(text, new RegExp(`verified: ${new Date().toISOString().slice(0, 10)}`));
  assert.match(text, /edited by hand/);
  assert.notEqual(run(["knowledge", "verify", "missing", "--workspace", workspace]).status, 0);
});

test("notes edited in Obsidian parse: block lists and quoted values", () => {
  const note = parseNote(
    [
      "---",
      "title: 'It''s a claim'",
      "tags:",
      "  - storage",
      "  - \"#supabase\"",
      "repos: []",
      "paths:",
      "  - src/**",
      "status: active",
      "---",
      "Body sentence one. Two.",
    ].join("\n"),
    "slug",
  );
  assert.equal(note.title, "It's a claim");
  assert.deepEqual(note.tags, ["storage", "supabase"]);
  assert.deepEqual(note.repos, []);
  assert.deepEqual(note.paths, ["src/**"]);
  assert.equal(note.description, "Body sentence one.");
  assert.deepEqual(searchNotes([note], ["the", "of"]), []);
});

test("a brief lists tag matches first, then repo and workspace-wide notes", () => {
  const notes = [
    parseNote("---\ntitle: Other repo only\ndescription: d\nrepos: [api]\nupdated: 2026-01-01\n---\n", "a"),
    parseNote("---\ntitle: Same repo\ndescription: d\nrepos: [app]\nverified: 2026-02-01\n---\n", "b"),
    parseNote("---\ntitle: Whole workspace\ndescription: d\nverified: 2026-03-01\n---\n", "c"),
    parseNote("---\ntitle: Storage trap\ndescription: d\ntags: [storage]\nrepos: [api]\n---\n", "d"),
  ];
  const repos = ["app", "api"].map((name) => ({ name, path: name, baseBranch: "main" }));
  const issue = { identifier: "DEV-1", title: "Archive drafts in app", description: "Before overwriting stored objects in storage." };
  const relevant = relevantNotes(notes, issue, repos);
  assert.deepEqual(relevant.notes.map((note) => note.title), ["Storage trap", "Whole workspace", "Same repo"]);
  assert.equal(relevantNotes(notes, issue, repos, 1).matched, 3);
});

test("issue briefs carry Relevant Knowledge and point at the ledger index", () => {
  const workspace = workspaceWith(["app"]);
  const empty = run(["issue", "DEV-1", "--workspace", workspace, "--agent", "claude", "--title", "t"]);
  assert.equal(empty.status, 0, empty.stderr);
  const emptySession = readFileSync(resolve(workspace, ".harness/issues/DEV-1/AGENT_SESSION.md"), "utf8");
  assert.match(emptySession, /## Relevant Knowledge\n\nNo knowledge notes yet\./);

  learn(workspace, ["--title", "Storage trap", "--description", "Watch out.", "--tags", "storage"]);
  run(["issue", "DEV-2", "--workspace", workspace, "--agent", "claude", "--title", "Fix storage writes"]);
  const session = readFileSync(resolve(workspace, ".harness/issues/DEV-2/AGENT_SESSION.md"), "utf8");
  assert.match(session, /## Relevant Knowledge\n\nNotes whose tags appear[^\n]*\n\n- \[Storage trap\]\(\.harness\/knowledge\/notes\/storage-trap\.md\): Watch out\. #storage/);
  assert.match(session, /read Relevant Knowledge above and `\.harness\/decisions\/INDEX\.md`/);
  assert.doesNotMatch(session, /read the active `\.harness\/decisions\/` ledger/);
  for (const file of ["CLAUDE.md", "AGENTS.md", "WORKFLOW.md"]) {
    const text = readFileSync(resolve(workspace, file), "utf8");
    assert.doesNotMatch(text, /read the active[^\n]*ledger/i, file);
    assert.doesNotMatch(text, /Read the active ledger/, file);
  }
});

test("install and decide keep the ledger index current", () => {
  const workspace = workspaceWith(["app"]);
  const indexFile = resolve(workspace, ".harness/decisions/INDEX.md");
  assert.match(readFileSync(indexFile, "utf8"), /0 active notes/);
  const decided = run([
    "decide", "--workspace", workspace, "--rule", "skip-tester", "--issue", "DEV-9",
    "--reason", "Docs-only change, so no tester. The risk was low.",
  ]);
  assert.equal(decided.status, 0, decided.stderr);
  const index = readFileSync(indexFile, "utf8");
  assert.match(index, /1 active note/);
  assert.match(index, /- \[skip-tester\]\(\d{4}-\d{2}-\d{2}-skip-tester\.md\): Docs-only change, so no tester\. \(DEV-9, \d{4}-\d{2}-\d{2}\)/);
  assert.doesNotMatch(index, /README/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { indexLine, parseNote, relevantNotes, searchNotes, setFrontmatterField, splitGlobs } from "../src/knowledge.js";

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
    "--title", "Cache get() can't tell a timeout from a miss",
    "--description", "get() returns null for both. Use getOrThrow() where a timeout must surface.",
    "--tags", "redis,Cache",
    "--repos", "app",
    "--paths", "src/cache/**",
    "--source", "DEV-123",
    "--body", "Longer explanation.",
  ]);
  assert.equal(created.status, 0, created.stderr);
  const file = resolve(workspace, ".harness/knowledge/notes/cache-get-can-t-tell-a-timeout-from-a-miss.md");
  const text = readFileSync(file, "utf8");
  assert.match(text, /^---\ntitle: "Cache get\(\) can't tell a timeout from a miss"\n/);
  assert.match(text, /tags: \[redis, cache\]/);
  assert.match(text, /paths: \["src\/cache\/\*\*"\]/);
  assert.match(text, /verified: \d{4}-\d{2}-\d{2}/);
  assert.match(text, /\nLonger explanation\.\n$/);
  const note = parseNote(text, "x");
  assert.deepEqual(note.paths, ["src/cache/**"]);
  assert.deepEqual(note.sources, ["DEV-123"]);

  const index = readFileSync(resolve(workspace, ".harness/knowledge/INDEX.md"), "utf8");
  assert.match(index, /## redis\n\n- \[Cache get\(\) can't tell a timeout from a miss\]\(notes\/cache-get-can-t-tell-a-timeout-from-a-miss\.md\): get\(\) returns null/);
  assert.match(index, /#redis #cache \(repos: app\)/);
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
  learn(workspace, ["--title", "Cache keys are case-sensitive", "--description", "Lowercase cache keys before reading or writing.", "--tags", "cache"]);
  const second = learn(workspace, ["--title", "Cache keys expire after an hour", "--description", "Set an explicit cache TTL for longer-lived keys.", "--tags", "cache"]);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /Similar notes[^\n]*\n- Cache keys are case-sensitive \(`\/[^`]*\/notes\/cache-keys-are-case-sensitive\.md`\)/);
});

test("search ranks title and tag matches first and filters by repo", () => {
  const workspace = workspaceWith(["app", "api"]);
  learn(workspace, ["--title", "Integration tests need a seeded database", "--description", "Run the seed script before the db suite.", "--tags", "db", "--repos", "app"]);
  learn(workspace, ["--title", "Migrations run in order", "--description", "Migrations create the db schema but seed nothing.", "--repos", "api"]);
  const both = run(["knowledge", "search", "db", "--workspace", workspace]);
  assert.equal(both.status, 0, both.stderr);
  const lines = both.stdout.trim().split("\n");
  assert.match(lines[0], /Integration tests need a seeded database/);
  assert.match(lines[1], /Migrations run in order/);
  const apiOnly = run(["knowledge", "search", "db", "--repo", "api", "--workspace", workspace]);
  assert.doesNotMatch(apiOnly.stdout, /Integration tests need/);
  assert.match(run(["knowledge", "search", "zebra", "--workspace", workspace]).stdout, /No notes match/);
  const usage = run(["knowledge", "search", "--workspace", workspace]);
  assert.notEqual(usage.status, 0);
  assert.match(usage.stderr, /give search terms, --paths/);
});

test("--paths are repo-relative, and name their repo when there are several", () => {
  const workspace = workspaceWith(["app", "api"]);
  learn(workspace, ["--title", "App cache trap", "--description", "d", "--repos", "app", "--paths", "src/**"]);
  learn(workspace, ["--title", "Api cache trap", "--description", "d", "--repos", "api", "--paths", "src/{auth,db}/**"]);
  const ambiguous = run(["knowledge", "search", "--paths", "src/auth/x.ts", "--workspace", workspace]);
  assert.notEqual(ambiguous.status, 0);
  assert.match(ambiguous.stderr, /can't tell which repo "src\/auth\/x\.ts" is in/);
  const prefixed = run(["knowledge", "search", "--paths", "api/src/auth/x.ts", "--workspace", workspace]);
  assert.equal(prefixed.status, 0, prefixed.stderr);
  assert.match(prefixed.stdout, /Api cache trap[^\n]*\n  matches: api\/src\/auth\/x\.ts/);
  assert.doesNotMatch(prefixed.stdout, /App cache trap/);
  const flagged = run(["knowledge", "search", "--paths", "src/db/y.ts", "--repo", "app", "--workspace", workspace]);
  assert.match(flagged.stdout, /App cache trap/);
  assert.doesNotMatch(flagged.stdout, /Api cache trap/);
});

test("parallel learns of one slug keep exactly one note", async () => {
  // Sessions learning the same slug at once can all pass the exists check;
  // only one write may land, and the rest must fail rather than replace it.
  const workspace = workspaceWith(["app"]);
  const codes = await Promise.all(
    [0, 1, 2, 3, 4, 5].map(
      (n) =>
        new Promise<number | null>((done) =>
          spawn("node", [cliPath, "learn", "--workspace", workspace, "--title", "Same fact", "--description", `writer ${n}`], {
            stdio: "ignore",
          }).on("close", done),
        ),
    ),
  );
  assert.equal(codes.filter((code) => code === 0).length, 1);
  const text = readFileSync(resolve(workspace, ".harness/knowledge/notes/same-fact.md"), "utf8");
  assert.equal(text.match(/description: "writer \d"/g)?.length, 1);
});

test("search finds notes by changed files, given or from the branch", () => {
  const workspace = workspaceWith(["app"]);
  learn(workspace, ["--title", "Cache writes go through the client", "--description", "Never write cache keys directly.", "--repos", "app", "--paths", "src/cache/**"]);
  learn(workspace, ["--title", "UI tests need a browser", "--description", "Install playwright.", "--paths", "src/ui/**"]);

  const given = run(["knowledge", "search", "--paths", "src/cache/write.ts,docs/x.md", "--workspace", workspace]);
  assert.equal(given.status, 0, given.stderr);
  assert.match(given.stdout, /Cache writes go through the client[^\n]*\n  matches: src\/cache\/write\.ts\n/);
  assert.doesNotMatch(given.stdout, /UI tests/);

  const repo = resolve(workspace, "app");
  assert.match(run(["knowledge", "search", "--changed"], repo).stdout, /No files changed on this branch/);
  git(repo, ["checkout", "-q", "-b", "feature"]);
  spawnSync("mkdir", ["-p", resolve(repo, "src/cache")]);
  writeFileSync(resolve(repo, "src/cache/write.ts"), "export {};\n");
  const changed = run(["knowledge", "search", "--changed"], repo);
  assert.equal(changed.status, 0, changed.stderr);
  assert.match(changed.stdout, /Cache writes go through the client[^\n]*\n  matches: src\/cache\/write\.ts/);

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
      "  - cache",
      "  - \"#redis\"",
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
  assert.deepEqual(note.tags, ["cache", "redis"]);
  assert.deepEqual(note.repos, []);
  assert.deepEqual(note.paths, ["src/**"]);
  assert.equal(note.description, "Body sentence one.");
  assert.deepEqual(searchNotes([note], ["the", "of"]), []);

  const unindented = parseNote("---\ntitle:\ntags:\n- auth\nrepos:\n- api\npaths:\n- src/auth/**\nsources: [DEV-1] # from review\n---\nKept one commit, e.g. for atomic revert. More.\n", "my-slug");
  assert.equal(unindented.title, "my-slug");
  assert.deepEqual(unindented.tags, ["auth"]);
  assert.deepEqual(unindented.repos, ["api"]);
  assert.deepEqual(unindented.paths, ["src/auth/**"]);
  assert.deepEqual(unindented.sources, ["DEV-1"]);
  assert.equal(unindented.description, "Kept one commit, e.g. for atomic revert.");
});

test("index lines link notes whose names have spaces", () => {
  const note = { ...parseNote("---\ntitle: T\ndescription: D\n---\n", "Token expiry"), file: "/w/k/notes/Token expiry.md" };
  assert.equal(indexLine(note, "/w/k"), "- [T](notes/Token%20expiry.md): D");
  assert.equal(indexLine(note, "/w", true), "- T (`k/notes/Token expiry.md`): D");
});

test("globs keep commas inside braces, and CRLF notes stay CRLF", () => {
  assert.deepEqual(splitGlobs("src/{auth,db}/**, docs/*.md"), ["src/{auth,db}/**", "docs/*.md"]);
  const crlf = setFrontmatterField("---\r\ntitle: T\r\nverified: 2020-01-01\r\n---\r\nBody\r\n", "verified", "2026-11-02");
  assert.equal(crlf, "---\r\ntitle: T\r\nverified: 2026-11-02\r\n---\r\nBody\r\n");
});

test("a brief lists tag matches first, then repo and workspace-wide notes", () => {
  const notes = [
    parseNote("---\ntitle: Other repo only\ndescription: d\nrepos: [api]\nupdated: 2026-01-01\n---\n", "a"),
    parseNote("---\ntitle: Same repo\ndescription: d\nrepos: [app]\nverified: 2026-02-01\n---\n", "b"),
    parseNote("---\ntitle: Whole workspace\ndescription: d\nverified: 2026-03-01\n---\n", "c"),
    parseNote("---\ntitle: Cache trap\ndescription: d\ntags: [cache]\nrepos: [app]\n---\n", "d"),
    parseNote("---\ntitle: Cache trap in api\ndescription: d\ntags: [cache]\nrepos: [api]\n---\n", "e"),
  ];
  const repos = ["app", "api"].map((name) => ({ name, path: name, baseBranch: "main" }));
  const issue = { identifier: "DEV-1", title: "Speed up reports in app", description: "Read report totals from the cache." };
  const relevant = relevantNotes(notes, issue, repos);
  assert.deepEqual(relevant.notes.map((note) => note.title), ["Cache trap", "Whole workspace", "Same repo"]);
  assert.equal(relevantNotes(notes, issue, repos, 1).matched, 3);
  const unknownRepo = relevantNotes(notes, { ...issue, title: "Speed up reports" }, repos);
  assert.deepEqual(unknownRepo.notes.map((note) => note.title), ["Cache trap", "Cache trap in api", "Whole workspace"]);
});

test("issue briefs carry Relevant Knowledge and point at the ledger index", () => {
  const workspace = workspaceWith(["app"]);
  const empty = run(["issue", "DEV-1", "--workspace", workspace, "--agent", "claude", "--title", "t"]);
  assert.equal(empty.status, 0, empty.stderr);
  const emptySession = readFileSync(resolve(workspace, ".harness/issues/DEV-1/AGENT_SESSION.md"), "utf8");
  assert.match(emptySession, /## Relevant Knowledge\n\nNo knowledge notes yet\./);

  learn(workspace, ["--title", "Cache trap", "--description", "Watch out.", "--tags", "cache"]);
  run(["issue", "DEV-2", "--workspace", workspace, "--agent", "claude", "--title", "Fix cache writes"]);
  const session = readFileSync(resolve(workspace, ".harness/issues/DEV-2/AGENT_SESSION.md"), "utf8");
  assert.match(session, /## Relevant Knowledge\n\nNotes whose tags appear[^\n]*\n\n- Cache trap \(`\.harness\/knowledge\/notes\/cache-trap\.md`\): Watch out\. #cache/);
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

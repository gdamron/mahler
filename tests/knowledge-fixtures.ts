import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

/** Workspaces and a bare remote for knowledge store repo-mode tests. */

export const cliPath = resolve("dist/src/cli.js");
// Commits need an identity, and CI machines may have none.
export const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

export function run(args: string[], extraEnv: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("node", [cliPath, ...args], { encoding: "utf8", env: { ...env, ...extraEnv } });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

/** A bare repo standing in for the shared knowledge remote. */
export function remote(): string {
  const dir = resolve(mkdtempSync(resolve(tmpdir(), "mahler-remote-")), "knowledge.git");
  spawnSync("git", ["init", "-q", "--bare", "-b", "main", dir]);
  return dir;
}

/** An installed workspace with one repo, optionally switched to repo mode and reinstalled. */
export function workspace(repo?: string, notes: string[] = []): string {
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

export function setRepo(
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

export function learn(dir: string, title: string, extraEnv: Record<string, string> = {}) {
  return run(["learn", "--workspace", dir, "--title", title, "--description", `${title}.`], extraEnv);
}

export const store = (dir: string) => resolve(dir, ".harness/knowledge");
export const noteFile = (dir: string, slug: string) => resolve(store(dir), "notes", `${slug}.md`);

export interface FakePr {
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
export function forge(): {
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
export function squashMerge(shared: string, pr: FakePr, edit?: { path: string; text: string }, at = "FETCH_HEAD"): void {
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
export function merge(shared: string, gh: ReturnType<typeof forge>, pr: FakePr, options: { edit?: { path: string; text: string }; at?: string } = {}): void {
  const head = options.at ?? git(shared, ["rev-parse", `refs/heads/${pr.head}`]);
  squashMerge(shared, pr, options.edit, head);
  gh.setState(pr.url, "MERGED", head);
}

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

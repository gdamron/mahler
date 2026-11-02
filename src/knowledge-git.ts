import { spawnSync } from "node:child_process";

/** Git plumbing shared by the knowledge store's direct and PR publish modes. */

/**
 * Generated or machine-local files the store's repo never tracks: the index
 * each clone builds, PR-mode pending notes, and editor and OS state that would
 * otherwise conflict between people.
 */
export const IGNORED = ["INDEX.md", "pending/", ".obsidian/", ".trash/", ".DS_Store"];

/** Fetch, push, and forge calls give up after this, so a stalled remote can't hang a brief. */
export const NETWORK_TIMEOUT_MS = 30_000;

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Never prompt for credentials: there may be no one at the terminal. */
export const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" };

export function git(dir: string, args: string[], timeout?: number): GitResult {
  return run("git", dir, args, timeout);
}

/** The GitHub CLI, for knowledge PRs. */
export function gh(dir: string, args: string[]): GitResult {
  return run("gh", dir, args, NETWORK_TIMEOUT_MS);
}

/** The blob id git would give `text`, as committed in `dir`'s repo. */
export function blobIdOf(dir: string, text: string): string {
  const result = run("git", dir, ["hash-object", "--stdin"], undefined, text);
  if (!result.ok) throw new Error(`git hash-object failed in ${dir}: ${result.stderr}`);
  return result.stdout;
}

function run(command: string, dir: string, args: string[], timeout?: number, input?: string): GitResult {
  const result = spawnSync(command, args, { cwd: dir, encoding: "utf8", env: GIT_ENV, timeout, input });
  const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
  const failure =
    code === "ETIMEDOUT" ? `timed out after ${timeout} ms` : code === "ENOENT" ? `${command} is not installed` : undefined;
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: failure ?? (result.stderr ?? "").trim(),
  };
}

export function gitOrThrow(dir: string, args: string[]): string {
  const result = git(dir, args);
  if (!result.ok) throw new Error(`git ${args.join(" ")} failed in ${dir}: ${result.stderr || result.stdout}`);
  return result.stdout;
}

export function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim() !== "")?.replace(/^(fatal|error): /, "") ?? "unknown error";
}

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { knowledgeDir, writeIndexes } from "./knowledge.js";
import type { HarnessConfig } from "./types.js";

/**
 * Repo mode for the knowledge store: the store's folder is a clone of
 * `knowledge.repo`, and Mahler commits and pushes notes to `knowledge.branch`.
 * Without `repo`, the store is a plain local folder and none of this runs.
 */

/** Generated or machine-local files the store's repo never tracks. */
const IGNORED = ["INDEX.md", "pending/"];

/** A lock held longer than this belongs to a crashed process. */
const STALE_LOCK_MS = 10 * 60 * 1000;

export function knowledgeBranch(config: HarnessConfig): string {
  return config.knowledge.branch ?? "main";
}

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function git(dir: string, args: string[]): GitResult {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  return { ok: result.status === 0, stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim() };
}

function gitOrThrow(dir: string, args: string[]): string {
  const result = git(dir, args);
  if (!result.ok) throw new Error(`git ${args.join(" ")} failed in ${dir}: ${result.stderr || result.stdout}`);
  return result.stdout;
}

/**
 * Install: when `knowledge.repo` is set and the store's folder isn't a git
 * clone yet, clone the repo and check out `knowledge.branch` (creating it when
 * the remote is empty). Notes already in a local store are copied into the
 * clone, to be published by the next sync, and the old folder is kept beside
 * it as `<path>.before-clone`. A file that differs between the two stops the
 * install with nothing changed. Returns what it did, or undefined when there
 * was nothing to do.
 */
export function cloneKnowledgeStore(workspace: string, config: HarnessConfig): string | undefined {
  const { repo } = config.knowledge;
  if (!repo) return undefined;
  const dir = knowledgeDir(workspace, config);
  if (existsSync(resolve(dir, ".git"))) return undefined;
  const temp = `${dir}.cloning`;
  rmSync(temp, { recursive: true, force: true });
  mkdirSync(dirname(dir), { recursive: true });
  const clone = spawnSync("git", ["clone", "--quiet", repo, temp], { encoding: "utf8" });
  if (clone.status !== 0) {
    rmSync(temp, { recursive: true, force: true });
    throw new Error(`Couldn't clone the knowledge repo ${repo}: ${(clone.stderr ?? "").trim()}`);
  }
  try {
    checkOutBranch(temp, knowledgeBranch(config));
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    throw error;
  }
  let carried = 0;
  let kept: string | undefined;
  if (existsSync(dir)) {
    const files = (readdirSync(dir, { recursive: true, withFileTypes: true }) as Dirent[])
      .filter((entry) => entry.isFile())
      .map((entry) => relative(dir, resolve(entry.parentPath, entry.name)))
      .filter((file) => file !== "INDEX.md" && !file.startsWith(`.git${sep}`));
    // Notes that differ stop the switch; for anything else (the README, say),
    // the repo's copy wins.
    const differ = files.filter(
      (file) =>
        isNote(file) &&
        existsSync(resolve(temp, file)) &&
        !readFileSync(resolve(temp, file)).equals(readFileSync(resolve(dir, file))),
    );
    if (differ.length > 0) {
      rmSync(temp, { recursive: true, force: true });
      throw new Error(
        `Can't switch ${dir} to ${repo}: these files differ between the local store and the repo: ${differ.join(", ")}. Reconcile them, then rerun install.`,
      );
    }
    for (const file of files.filter((candidate) => !existsSync(resolve(temp, candidate)))) {
      mkdirSync(dirname(resolve(temp, file)), { recursive: true });
      copyFileSync(resolve(dir, file), resolve(temp, file));
      if (isNote(file)) carried += 1;
    }
    if (carried > 0) {
      kept = `${dir}.before-clone`;
      rmSync(kept, { recursive: true, force: true });
      renameSync(dir, kept);
    } else {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  renameSync(temp, dir);
  ensureGitignore(dir);
  const lines = [`Cloned the knowledge store from ${repo} into ${dir}`];
  if (carried > 0) {
    lines.push(
      `Copied ${carried} local ${carried === 1 ? "note" : "notes"} into the clone; \`mahler knowledge sync\` publishes them. The old folder is at ${kept}; delete it once you've checked.`,
    );
  }
  return lines.join("\n");
}

function isNote(file: string): boolean {
  return /^(notes|archive|pending)[\\/].*\.md$/.test(file);
}

function checkOutBranch(dir: string, branch: string): void {
  if (git(dir, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`]).ok) {
    gitOrThrow(dir, ["checkout", "--quiet", "-B", branch, "--track", `origin/${branch}`]);
  } else if (git(dir, ["rev-parse", "--verify", "--quiet", "HEAD"]).ok) {
    gitOrThrow(dir, ["checkout", "--quiet", "-B", branch]);
  } else {
    // An empty remote: the first sync creates the branch.
    gitOrThrow(dir, ["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
  }
}

/** Keep generated files out of the store's repo. */
export function ensureGitignore(dir: string): void {
  const file = resolve(dir, ".gitignore");
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lines = current.split(/\r?\n/);
  const missing = IGNORED.filter((entry) => !lines.includes(entry));
  if (missing.length === 0) return;
  const prefix = current === "" || current.endsWith("\n") ? current : `${current}\n`;
  writeFileSync(file, `${prefix}${missing.join("\n")}\n`);
}

export interface StoreState {
  /** Why the folder can't be synced, if it can't. */
  problem?: string;
  branch?: string;
  /** Local commits not yet on the remote branch, as of the last fetch. */
  ahead?: number;
  behind?: number;
  dirty?: boolean;
}

/** The store's clone, as far as local git knows (no fetch). */
export function storeState(workspace: string, config: HarnessConfig): StoreState {
  const { repo } = config.knowledge;
  const dir = knowledgeDir(workspace, config);
  if (!repo) return {};
  if (!existsSync(dir)) return { problem: `${dir} is missing; run \`mahler install\` to clone ${repo}` };
  if (!existsSync(resolve(dir, ".git"))) {
    return {
      problem: `${dir} exists but isn't a clone of ${repo}: move it aside, run \`mahler install\` to clone, copy its notes back in, then run \`mahler knowledge sync\``,
    };
  }
  const origin = git(dir, ["remote", "get-url", "origin"]);
  if (!origin.ok || origin.stdout !== repo) {
    return { problem: `${dir} is a clone of ${origin.stdout || "(no origin)"}, not ${repo}` };
  }
  for (const marker of ["rebase-merge", "rebase-apply", "MERGE_HEAD"]) {
    if (existsSync(resolve(dir, ".git", marker))) {
      return { problem: `${dir} is in the middle of a rebase or merge; finish or abort it there` };
    }
  }
  const branch = git(dir, ["symbolic-ref", "--short", "HEAD"]).stdout;
  const expected = knowledgeBranch(config);
  if (branch !== expected) return { problem: `${dir} is on "${branch || "a detached HEAD"}", not "${expected}"`, branch };
  const counts = git(dir, ["rev-list", "--left-right", "--count", `HEAD...refs/remotes/origin/${expected}`]);
  const [ahead, behind] = counts.ok ? counts.stdout.split(/\s+/).map(Number) : [commitCount(dir), 0];
  const dirty = git(dir, ["status", "--porcelain"]).stdout !== "";
  return { branch, ahead, behind, dirty };
}

function commitCount(dir: string): number {
  const count = git(dir, ["rev-list", "--count", "HEAD"]);
  return count.ok ? Number(count.stdout) : 0;
}

/** Throws when Mahler can't publish this config yet. */
function checkPublishMode(config: HarnessConfig): void {
  if (config.knowledge.publish === "pr") {
    throw new Error(
      'knowledge.publish "pr" is not supported yet; set it to "direct" (or remove it) in .harness/config.json',
    );
  }
}

/**
 * Sync the store with its repo: commit local changes with `message`, rebase
 * onto the remote branch, and push. A push rejected because the remote moved
 * gets one more fetch, rebase, and push. Can't reach the remote: the commit
 * stays local and the result says so. A rebase conflict throws, with the
 * rebase aborted and the local commit kept. In local mode, it only rebuilds
 * the indexes.
 */
export function syncKnowledge(
  workspace: string,
  config: HarnessConfig,
  message = "knowledge: update notes",
): SyncResult {
  if (!config.knowledge.repo) {
    writeIndexes(workspace, config);
    return { summary: "The knowledge store is a local folder (no knowledge.repo); indexes rebuilt.", published: true };
  }
  checkPublishMode(config);
  const state = storeState(workspace, config);
  if (state.problem) throw new Error(state.problem);
  const dir = knowledgeDir(workspace, config);
  const branch = knowledgeBranch(config);
  const { done, published } = withLock(workspace, "knowledge", (): { done: string[]; published: boolean } => {
    const done: string[] = [];
    const unpublished = (why: string) => ({ done: [...done, why], published: false });
    ensureGitignore(dir);
    gitOrThrow(dir, ["add", "--all"]);
    if (!git(dir, ["diff", "--cached", "--quiet"]).ok) {
      gitOrThrow(dir, ["commit", "--quiet", "-m", message]);
      done.push("committed local changes");
    }
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const fetch = git(dir, ["fetch", "--quiet", "origin"]);
      if (!fetch.ok) {
        return unpublished(`couldn't reach ${config.knowledge.repo} (${firstLine(fetch.stderr)}); run \`mahler knowledge sync\` later to publish`);
      }
      const remote = `refs/remotes/origin/${branch}`;
      if (git(dir, ["rev-parse", "--verify", "--quiet", remote]).ok) {
        const behind = Number(git(dir, ["rev-list", "--count", `HEAD..${remote}`]).stdout || 0);
        if (behind > 0) {
          const rebase = git(dir, ["rebase", "--quiet", remote]);
          if (!rebase.ok) {
            const conflicts = git(dir, ["diff", "--name-only", "--diff-filter=U"]).stdout.split("\n").filter(Boolean);
            git(dir, ["rebase", "--abort"]);
            throw new Error(
              `Knowledge sync stopped: your changes conflict with the remote in ${conflicts.join(", ") || "the store"}. Your commit is kept locally in ${dir}; merge the notes by hand there (git pull --rebase), then run \`mahler knowledge sync\`.`,
            );
          }
          done.push(`pulled ${behind} ${behind === 1 ? "commit" : "commits"}`);
        }
      }
      const ahead = git(dir, ["rev-parse", "--verify", "--quiet", remote]).ok
        ? Number(git(dir, ["rev-list", "--count", `${remote}..HEAD`]).stdout || 0)
        : commitCount(dir);
      if (ahead === 0) return { done, published: true };
      const push = git(dir, ["push", "--quiet", "-u", "origin", `HEAD:refs/heads/${branch}`]);
      if (push.ok) return { done: [...done, `pushed ${ahead} ${ahead === 1 ? "commit" : "commits"}`], published: true };
      const rejected = /\[rejected\]|non-fast-forward|fetch first/i.test(push.stderr);
      if (!rejected) {
        return unpublished(`couldn't push to ${config.knowledge.repo} (${firstLine(push.stderr)}); run \`mahler knowledge sync\` later to publish`);
      }
    }
    return unpublished("the remote kept moving, so nothing was pushed; run `mahler knowledge sync` again");
  });
  writeIndexes(workspace, config);
  return { summary: `Knowledge sync: ${done.length > 0 ? done.join("; ") : "already up to date"}.`, published };
}

export interface SyncResult {
  summary: string;
  /** False when local commits couldn't reach the remote (offline, say). */
  published: boolean;
}

function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim() !== "")?.replace(/^(fatal|error): /, "") ?? "unknown error";
}

/**
 * Run `fn` holding a lock under `.harness/tmp/locks/`, so parallel agents on
 * one machine don't collide on the store's git index. Waits up to `waitMs`;
 * reclaims a lock whose holder has exited or that is older than ten minutes.
 */
export function withLock<T>(workspace: string, name: string, fn: () => T, waitMs = 60_000): T {
  const lock = resolve(workspace, ".harness", "tmp", "locks", `${name}.lock`);
  mkdirSync(dirname(lock), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(lock);
      writeFileSync(resolve(lock, "owner"), `${process.pid}\n`);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (lockIsStale(lock)) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for ${lock}. If no mahler command is running, remove it and retry.`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function lockIsStale(lock: string): boolean {
  try {
    if (Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS) return true;
    const pid = Number(readFileSync(resolve(lock, "owner"), "utf8"));
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // ESRCH: the holder has exited. ENOENT: the lock vanished, or its owner
    // file isn't written yet; retry rather than steal it.
    return code === "ESRCH";
  }
}

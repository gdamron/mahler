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
import { randomBytes } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import { decisionsDir, knowledgeDir, writeIndexes } from "./knowledge.js";
import { ensureExcluded, leavePrMode, prModeSync } from "./knowledge-pr.js";
import { firstLine, git, GIT_ENV, gitOrThrow, IGNORED, NETWORK_TIMEOUT_MS } from "./knowledge-git.js";
import type { HarnessConfig } from "./types.js";

/**
 * Repo mode: a store's folder is a clone of its repo, and Mahler commits and
 * pushes notes to its branch. The knowledge store uses `knowledge.repo`, and
 * can publish through PRs instead. The decisions ledger can be backed up to
 * `decisions.repo`, always publishing directly. Without a repo, a store is a
 * plain local folder and none of this runs.
 */

/** A lock held longer than this belongs to a crashed process. */
const STALE_LOCK_MS = 10 * 60 * 1000;

export function knowledgeBranch(config: HarnessConfig): string {
  return config.knowledge.branch ?? "main";
}

/** A store that can live in a git repo: the knowledge store or the decisions ledger. */
export interface RepoStore {
  /** The lock's name. */
  name: "knowledge" | "decisions";
  /** How messages name the store. */
  label: string;
  dir: string;
  repo?: string;
  branch: string;
  /** Publish through PRs (knowledge only). */
  pr: boolean;
  /** Files a clone mustn't silently replace: notes, as opposed to the README. */
  isNote: (file: string) => boolean;
}

export function knowledgeStore(workspace: string, config: HarnessConfig): RepoStore {
  return {
    name: "knowledge",
    label: "knowledge store",
    dir: knowledgeDir(workspace, config),
    repo: config.knowledge.repo,
    branch: knowledgeBranch(config),
    pr: prPublish(config),
    isNote: (file) => /^(notes|archive)[\\/].*\.md$/.test(file),
  };
}

export function ledgerStore(workspace: string, config: HarnessConfig): RepoStore {
  return {
    name: "decisions",
    label: "decisions ledger",
    dir: decisionsDir(workspace),
    repo: config.decisions?.repo,
    branch: config.decisions?.branch ?? "main",
    pr: false,
    isNote: (file) => /^(archive[\\/])?[^\\/]+\.md$/.test(file) && file !== "README.md" && file !== "INDEX.md",
  };
}

/**
 * The remote to clone: a relative local path is relative to the workspace,
 * not to wherever mahler happens to run.
 */
function repoUrl(workspace: string, repo: string): string {
  return isLocalPath(repo) ? resolve(workspace, repo) : repo;
}

/** URLs (`scheme://`) and scp-style remotes (`host:path`) aren't local paths. */
function isLocalPath(repo: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(repo)) return true;
  return !/^[A-Za-z][\w+.-]*:\/\//.test(repo) && !/^[^/\\]+:/.test(repo);
}

/** Whether a clone's configured origin is `repo`, allowing for path spellings. */
function sameRepo(workspace: string, origin: string, repo: string): boolean {
  const trim = (url: string) => url.replace(/\/+$/, "");
  if (isLocalPath(origin) && isLocalPath(repo)) return resolve(workspace, origin) === resolve(workspace, repo);
  return trim(origin) === trim(repo);
}

/**
 * Install: when the store has a repo and its folder isn't a git clone yet,
 * clone the repo and check out the store's branch (creating it when the
 * remote is empty). Notes already in a local store are copied into the
 * clone, to be published by the next sync, and the old folder is kept beside
 * it as `<path>.before-clone`. A file that differs between the two stops the
 * install with nothing changed. Returns what it did, or undefined when there
 * was nothing to do.
 */
export function cloneStore(workspace: string, store: RepoStore): string | undefined {
  const { repo, dir, isNote } = store;
  if (!repo) return undefined;
  if (existsSync(resolve(dir, ".git"))) return undefined;
  const temp = `${dir}.cloning`;
  rmSync(temp, { recursive: true, force: true });
  mkdirSync(dirname(dir), { recursive: true });
  const clone = spawnSync("git", ["clone", "--quiet", repoUrl(workspace, repo), temp], {
    cwd: workspace,
    encoding: "utf8",
    env: GIT_ENV,
  });
  if (clone.status !== 0) {
    rmSync(temp, { recursive: true, force: true });
    throw new Error(`Couldn't clone the ${store.name} repo ${repo}: ${(clone.stderr ?? "").trim()}`);
  }
  try {
    checkOutBranch(temp, store.branch);
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
    if (files.length > 0) {
      // Keep the old folder: the repo's copy won for files that aren't notes.
      kept = unusedPath(`${dir}.before-clone`);
      renameSync(dir, kept);
    } else {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  renameSync(temp, dir);
  if (store.pr) ensureExcluded(dir);
  else ensureGitignore(dir);
  const lines = [`Cloned the ${store.label} from ${repo} into ${dir}`];
  if (carried > 0) {
    lines.push(
      `Copied ${carried} local ${carried === 1 ? "note" : "notes"} into the clone; \`mahler knowledge sync\` publishes them.`,
    );
  }
  if (kept) lines.push(`The old folder is at ${kept}; delete it once you've checked.`);
  return lines.join("\n");
}

function unusedPath(base: string): string {
  let candidate = base;
  for (let n = 2; existsSync(candidate); n += 1) candidate = `${base}-${n}`;
  return candidate;
}

function checkOutBranch(dir: string, branch: string): void {
  if (git(dir, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`]).ok) {
    gitOrThrow(dir, ["checkout", "--quiet", "-B", branch, "--track", `origin/${branch}`]);
  } else if (git(dir, ["rev-parse", "--verify", "--quiet", "HEAD"]).ok) {
    // The remote has other branches but not this one: start it empty rather
    // than from whatever the default branch holds.
    gitOrThrow(dir, ["checkout", "--quiet", "--orphan", branch]);
    gitOrThrow(dir, ["rm", "-r", "-f", "--quiet", "--ignore-unmatch", "."]);
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
export function storeState(workspace: string, store: RepoStore): StoreState {
  const { repo, dir } = store;
  if (!repo) return {};
  if (!existsSync(dir)) return { problem: `${dir} is missing; run \`mahler install\` to clone ${repo}` };
  if (!existsSync(resolve(dir, ".git"))) {
    return {
      problem: `${dir} exists but isn't a clone of ${repo}: move it aside, run \`mahler install\` to clone, copy its notes back in, then run \`mahler knowledge sync\``,
    };
  }
  // The configured URL, not `remote get-url`, which applies insteadOf rewrites.
  const origin = git(dir, ["config", "--get", "remote.origin.url"]);
  if (!origin.ok || !sameRepo(workspace, origin.stdout, repo)) {
    return { problem: `${dir} is a clone of ${origin.stdout || "(no origin)"}, not ${repo}` };
  }
  for (const marker of ["rebase-merge", "rebase-apply", "MERGE_HEAD"]) {
    if (existsSync(resolve(dir, ".git", marker))) {
      return { problem: `${dir} is in the middle of a rebase or merge; finish or abort it there` };
    }
  }
  const branch = git(dir, ["symbolic-ref", "--short", "HEAD"]).stdout;
  const expected = store.branch;
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

/** Throws on a publish mode Mahler doesn't know. */
function checkPublishMode(config: HarnessConfig): void {
  const { publish } = config.knowledge;
  if (publish !== undefined && publish !== "direct" && publish !== "pr") {
    throw new Error(`knowledge.publish must be "direct" or "pr", not ${JSON.stringify(publish)}`);
  }
}

export function prPublish(config: HarnessConfig): boolean {
  return Boolean(config.knowledge.repo) && config.knowledge.publish === "pr";
}

/**
 * Sync the store with its repo. With `publish: "pr"`, propose local changes
 * as PRs instead (see knowledge-pr.ts). Otherwise commit local changes with
 * `message`, rebase onto the remote branch, and push. A push rejected because the remote moved
 * gets one more fetch, rebase, and push. Can't reach the remote: the commit
 * stays local and the result says so. A rebase conflict throws, with the
 * rebase aborted and the local commit kept. In local mode, it only rebuilds
 * the indexes.
 */
export interface SyncOptions {
  /** The commit message for local changes (direct publish). */
  message?: string;
  lockWaitMs?: number;
  /** Pull only: open no PRs and don't ask the forge (for briefs). */
  quick?: boolean;
}

export function syncKnowledge(workspace: string, config: HarnessConfig, options: SyncOptions = {}): SyncResult {
  const { message = "knowledge: update notes", lockWaitMs = 60_000, quick = false } = options;
  if (!config.knowledge.repo) {
    writeIndexes(workspace, config);
    return { summary: "The knowledge store is a local folder (no knowledge.repo); indexes rebuilt.", published: true };
  }
  checkPublishMode(config);
  return syncStore(workspace, config, knowledgeStore(workspace, config), { ...options, message, lockWaitMs, quick }, "Knowledge sync");
}

/**
 * Back the decisions ledger up to `decisions.repo` (direct publish), or
 * return undefined when it has no repo.
 */
export function syncLedger(workspace: string, config: HarnessConfig, options: SyncOptions = {}): SyncResult | undefined {
  if (!config.decisions?.repo) return undefined;
  const { message = "decisions: update the ledger", lockWaitMs = 60_000 } = options;
  return syncStore(workspace, config, ledgerStore(workspace, config), { message, lockWaitMs }, "Ledger sync");
}

function syncStore(
  workspace: string,
  config: HarnessConfig,
  store: RepoStore,
  options: Required<Pick<SyncOptions, "message" | "lockWaitMs">> & SyncOptions,
  title: string,
): SyncResult {
  const state = storeState(workspace, store);
  if (state.problem) throw new Error(state.problem);
  const { dir, branch, repo } = store;
  if (!repo) throw new Error(`The ${store.label} has no repo to sync with`);
  const { done, published } = withLock(
    workspace,
    store.name,
    () => {
      if (store.pr) return prModeSync(dir, branch, repo, options.message, options.quick ?? false);
      ensureGitignore(dir);
      return directSync(store, repo, options.message);
    },
    options.lockWaitMs,
  );
  writeIndexes(workspace, config);
  return { summary: `${title}: ${done.length > 0 ? done.join("; ") : "already up to date"}.`, published };
}

/**
 * Direct publish: commit, rebase onto the remote branch, push (one retry).
 * For the knowledge store, first settle anything left from PR publish.
 */
function directSync(store: RepoStore, repo: string, message: string): { done: string[]; published: boolean } {
  const { dir, branch } = store;
  // Left over from PR publish: settle its PRs, and publish what's still pending.
  const left: { done: string[]; blocked?: string } =
    store.name === "knowledge" ? leavePrMode(dir, branch) : { done: [] };
  const done = left.done;
  const unpublished = (why: string) => ({ done: [...done, why], published: false });
  if (left.blocked) return unpublished(left.blocked);
  // Ignoring a file the repo already tracks does nothing, so untrack it too.
  gitOrThrow(dir, ["rm", "-r", "--cached", "--quiet", "--ignore-unmatch", "--", ...IGNORED.map(ignoredPathspec)]);
  gitOrThrow(dir, ["add", "--all"]);
  if (!git(dir, ["diff", "--cached", "--quiet"]).ok) {
    gitOrThrow(dir, ["commit", "--quiet", "-m", message]);
    done.push("committed local changes");
  }
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const fetch = git(dir, ["fetch", "--quiet", "origin"], NETWORK_TIMEOUT_MS);
    if (!fetch.ok) {
      return unpublished(`couldn't reach ${repo} (${firstLine(fetch.stderr)}); run \`mahler knowledge sync\` later to publish`);
    }
    const remote = `refs/remotes/origin/${branch}`;
    if (git(dir, ["rev-parse", "--verify", "--quiet", remote]).ok) {
      const behind = Number(git(dir, ["rev-list", "--count", `HEAD..${remote}`]).stdout || 0);
      if (behind > 0) {
        const rebase = git(dir, ["rebase", "--quiet", remote]);
        if (!rebase.ok && !rebaseInProgress(dir)) {
          // It never started: a note was edited after this sync committed.
          return unpublished("notes changed while syncing; run `mahler knowledge sync` again to publish");
        }
        if (!rebase.ok) {
          const conflicts = git(dir, ["diff", "--name-only", "--diff-filter=U"]).stdout.split("\n").filter(Boolean);
          git(dir, ["rebase", "--abort"]);
          throw new Error(
            `${store.name === "knowledge" ? "Knowledge" : "Ledger"} sync stopped: your changes conflict with the remote in ${conflicts.join(", ") || "the store"}. Your commit is kept locally in ${dir}; merge the notes by hand there (git pull --rebase), then run \`mahler knowledge sync\`.`,
          );
        }
        done.push(`pulled ${behind} ${behind === 1 ? "commit" : "commits"}`);
      }
    }
    const ahead = git(dir, ["rev-parse", "--verify", "--quiet", remote]).ok
      ? Number(git(dir, ["rev-list", "--count", `${remote}..HEAD`]).stdout || 0)
      : commitCount(dir);
    if (ahead === 0) return { done, published: true };
    const push = git(dir, ["push", "--quiet", "-u", "origin", `HEAD:refs/heads/${branch}`], NETWORK_TIMEOUT_MS);
    if (push.ok) return { done: [...done, `pushed ${ahead} ${ahead === 1 ? "commit" : "commits"}`], published: true };
    const rejected = /\[rejected\]|non-fast-forward|fetch first/i.test(push.stderr);
    if (!rejected) {
      return unpublished(`couldn't push to ${repo} (${firstLine(push.stderr)}); run \`mahler knowledge sync\` later to publish`);
    }
  }
  return unpublished("the remote kept moving, so nothing was pushed; run `mahler knowledge sync` again");
}

export interface SyncResult {
  summary: string;
  /** False when local commits couldn't reach the remote (offline, say). */
  published: boolean;
}

function rebaseInProgress(dir: string): boolean {
  return ["rebase-merge", "rebase-apply"].some((marker) => existsSync(resolve(dir, ".git", marker)));
}

/** `.DS_Store` appears in any folder; the rest sit at the store's root. */
function ignoredPathspec(entry: string): string {
  return entry.endsWith("/") ? entry.slice(0, -1) : entry === ".DS_Store" ? ":(glob)**/.DS_Store" : entry;
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
  const owner = `${process.pid} ${randomBytes(6).toString("hex")}\n`;
  for (;;) {
    try {
      mkdirSync(lock);
      writeFileSync(resolve(lock, "owner"), owner);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const stale = staleOwner(lock);
      if (stale !== undefined) {
        reclaim(lock, stale);
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
    // Only release our own lock, in case it was reclaimed from under us.
    let current: string | undefined;
    try {
      current = readFileSync(resolve(lock, "owner"), "utf8");
    } catch {
      current = undefined;
    }
    if (current === owner) rmSync(lock, { recursive: true, force: true });
  }
}

/** The owner line of a lock whose holder has exited or that is too old. */
function staleOwner(lock: string): string | undefined {
  try {
    const owner = readFileSync(resolve(lock, "owner"), "utf8");
    if (Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS) return owner;
    const pid = Number(owner.split(/\s+/)[0]);
    if (!Number.isInteger(pid) || pid <= 0) return undefined;
    process.kill(pid, 0);
    return undefined;
  } catch (error) {
    // ESRCH: the holder has exited. ENOENT: the lock vanished, or its owner
    // file isn't written yet; retry rather than steal it.
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") return undefined;
    try {
      return readFileSync(resolve(lock, "owner"), "utf8");
    } catch {
      return undefined;
    }
  }
}

/**
 * Move a stale lock aside (atomic, so only one waiter gets it), and delete it
 * only if it is still the stale one: another waiter may have reclaimed it and
 * taken a fresh lock in between, and that one must be put back.
 */
function reclaim(lock: string, staleOwnerLine: string): void {
  const aside = `${lock}.stale-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    renameSync(lock, aside);
  } catch {
    return;
  }
  let owner: string | undefined;
  try {
    owner = readFileSync(resolve(aside, "owner"), "utf8");
  } catch {
    owner = undefined;
  }
  if (owner === staleOwnerLine) {
    rmSync(aside, { recursive: true, force: true });
    return;
  }
  try {
    renameSync(aside, lock);
  } catch {
    rmSync(aside, { recursive: true, force: true });
  }
}

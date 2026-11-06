import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  type Dirent,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import { decisionsDir, knowledgeDir, writeIndexes } from "./knowledge.js";
import { ensureExcluded, leavePrMode, prModeSync, type PrScope } from "./knowledge-pr.js";
import { firstLine, git, GIT_ENV, gitOrThrow, IGNORED, NETWORK_TIMEOUT_MS } from "./knowledge-git.js";
import type { HarnessConfig } from "./types.js";

/**
 * Repo mode: a store's folder is a clone of its repo, and Mahler commits and
 * pushes notes to its branch. The knowledge store uses `knowledge.repo`, and
 * can publish through PRs instead. The decisions ledger can be backed up to
 * `decisions.repo`, publishing directly. Without a repo, a store is a plain
 * local folder and none of this runs.
 *
 * Both stores can also share one repo and branch, each under its own folder
 * (`knowledge.repoPath`, `decisions.repoPath`). They then share one clone,
 * at `.harness/stores`, and each store's folder links to its folder in it.
 * The ledger publishes the way the knowledge store does, through PRs too
 * with `publish: "pr"`. Each sync commits or proposes only its own folder,
 * and both take one lock, so they never touch the clone at the same time.
 */

/** Install's clone gives up after this, so an unreachable repo can't hang it. */
const CLONE_TIMEOUT_MS = 120_000;

/** A lock held longer than this belongs to a crashed process. */
const STALE_LOCK_MS = 10 * 60 * 1000;

export function knowledgeBranch(config: HarnessConfig): string {
  return config.knowledge.branch ?? "main";
}

/** A store that can live in a git repo: the knowledge store or the decisions ledger. */
export interface RepoStore {
  name: "knowledge" | "decisions";
  /** How messages name the store. */
  label: string;
  /** The store's folder; in a shared clone, a link to its folder there. */
  dir: string;
  /** The clone: `dir` itself, or the shared clone. */
  root: string;
  /** The store's folder in the repo: "" when it has the whole repo, else ending in "/". */
  prefix: string;
  /** Whether it shares its clone with the other store. */
  shared: boolean;
  /** The lock's name: one for both stores in a shared clone. */
  lock: string;
  repo?: string;
  branch: string;
  /** Publish through PRs (knowledge only). */
  pr: boolean;
  /** Files a clone mustn't silently replace: notes, as opposed to the README. */
  isNote: (file: string) => boolean;
  /**
   * A note that another machine already added under the same name is
   * renamed rather than reported as a conflict: ledger notes are append-only,
   * named by date and rule, and two machines can pick the same name.
   */
  renameClashes: boolean;
}

export function knowledgeStore(workspace: string, config: HarnessConfig): RepoStore {
  const dir = knowledgeDir(workspace, config);
  const shared = sharedLayout(workspace, config);
  return {
    name: "knowledge",
    label: "knowledge store",
    dir,
    root: shared?.root ?? dir,
    prefix: shared?.knowledge ?? "",
    shared: shared !== undefined,
    lock: shared ? SHARED_LOCK : "knowledge",
    repo: config.knowledge.repo,
    branch: knowledgeBranch(config),
    pr: prPublish(config),
    isNote: (file) => /^(notes|archive)[\\/].*\.md$/.test(file),
    renameClashes: false,
  };
}

export function ledgerStore(workspace: string, config: HarnessConfig): RepoStore {
  const dir = decisionsDir(workspace);
  const shared = sharedLayout(workspace, config);
  return {
    name: "decisions",
    label: "decisions ledger",
    dir,
    root: shared?.root ?? dir,
    prefix: shared?.decisions ?? "",
    shared: shared !== undefined,
    lock: shared ? SHARED_LOCK : "decisions",
    repo: config.decisions?.repo,
    branch: config.decisions?.branch ?? "main",
    // Alone, the ledger always publishes directly; sharing, it follows the knowledge store.
    pr: shared !== undefined && prPublish(config),
    isNote: (file) => /^(archive[\\/])?[^\\/]+\.md$/.test(file) && file !== "README.md" && file !== "INDEX.md",
    renameClashes: true,
  };
}

const SHARED_LOCK = "stores";

/** The shared clone, when both stores use one repo and branch. */
export function sharedRoot(workspace: string): string {
  return resolve(workspace, ".harness", "stores");
}

/** Where each store lives in the shared clone: its folder in the repo, ending in "/". */
interface SharedLayout {
  root: string;
  knowledge: string;
  decisions: string;
}

/** Both stores on one repo and branch, each under a sound `repoPath`; undefined otherwise. */
export function sharedLayout(workspace: string, config: HarnessConfig): SharedLayout | undefined {
  if (!sharesBranch(workspace, config) || storeRepoProblem(workspace, config)) return undefined;
  return {
    root: sharedRoot(workspace),
    knowledge: `${cleanRepoPath(config.knowledge.repoPath)}/`,
    decisions: `${cleanRepoPath(config.decisions?.repoPath)}/`,
  };
}

function sharesBranch(workspace: string, config: HarnessConfig): boolean {
  const knowledge = config.knowledge.repo;
  const decisions = config.decisions?.repo;
  if (!knowledge || !decisions || !sameRepo(workspace, knowledge, decisions)) return false;
  return (config.decisions?.branch ?? "main") === knowledgeBranch(config);
}

/** A `repoPath` as a folder in the repo: `/` separators, no leading `./` or trailing `/`. */
function cleanRepoPath(path: string | undefined): string | undefined {
  return path?.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
}

function soundRepoPath(path: string): boolean {
  if (path === "" || path.startsWith("/") || /^[A-Za-z]:/.test(path)) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && part !== ".git");
}

/**
 * What's wrong with how the stores' repos are set, if anything. Both on one
 * repo and branch need a folder each (`repoPath`): without them each store's
 * sync would pull the other's files, and their READMEs conflict. A
 * `repoPath` means nothing unless the two share a branch.
 */
export function storeRepoProblem(workspace: string, config: HarnessConfig): string | undefined {
  const paths = [
    ["knowledge.repoPath", config.knowledge.repoPath],
    ["decisions.repoPath", config.decisions?.repoPath],
  ] as const;
  for (const [key, value] of paths) {
    const clean = cleanRepoPath(value);
    if (clean !== undefined && !soundRepoPath(clean)) {
      return `${key} must name a folder inside the repo, such as "knowledge", not ${JSON.stringify(value)}`;
    }
  }
  const set = paths.filter(([, value]) => value !== undefined).map(([key]) => key);
  if (!sharesBranch(workspace, config)) {
    if (set.length === 0) return undefined;
    return `${set.join(" and ")} only ${set.length === 1 ? "applies" : "apply"} when knowledge.repo and decisions.repo are the same repo on the same branch; remove ${set.length === 1 ? "it" : "them"}, or point both stores at one repo and branch`;
  }
  const branch = config.decisions?.branch ?? "main";
  if (set.length < 2) {
    return `decisions.repo is knowledge.repo, on the same branch "${branch}"; give each store its own folder in the repo with knowledge.repoPath and decisions.repoPath, give the ledger its own repo, or set decisions.branch to another branch`;
  }
  const knowledge = cleanRepoPath(config.knowledge.repoPath)!;
  const decisions = cleanRepoPath(config.decisions?.repoPath)!;
  if (knowledge === decisions || knowledge.startsWith(`${decisions}/`) || decisions.startsWith(`${knowledge}/`)) {
    return `knowledge.repoPath "${knowledge}" and decisions.repoPath "${decisions}" must be separate folders, neither inside the other`;
  }
  const dir = knowledgeDir(workspace, config);
  const root = sharedRoot(workspace);
  if (dir === root || dir.startsWith(`${root}${sep}`) || root.startsWith(`${dir}${sep}`)) {
    return `knowledge.path "${config.knowledge.path}" can't hold or sit in ${root}, where the stores share their clone; pick another folder`;
  }
  return undefined;
}

/** The store's own folder in its clone. */
export function storeFolder(store: RepoStore): string {
  return resolve(store.root, store.prefix);
}

/** Where the store's PR publish works. */
export function prScope(store: RepoStore): PrScope {
  return { root: store.root, prefix: store.prefix, kind: store.name };
}

/** `x.md` → the first of `x-2.md`, `x-3.md`, … that isn't taken. */
function freeName(file: string, taken: (candidate: string) => boolean): string {
  const stem = file.replace(/\.md$/, "");
  let candidate = file;
  for (let n = 2; taken(candidate); n += 1) candidate = `${stem}-${n}.md`;
  return candidate;
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
 * was nothing to do. A store in a shared clone is linked to it instead.
 */
export function cloneStore(workspace: string, store: RepoStore): string | undefined {
  if (store.shared) return linkStore(workspace, store);
  const { repo, dir } = store;
  if (!repo) return undefined;
  if (existsSync(resolve(dir, ".git"))) return undefined;
  const temp = `${dir}.cloning`;
  cloneInto(workspace, store, temp);
  let carried = 0;
  let renamed: string[] = [];
  let kept: string | undefined;
  if (existsSync(dir)) {
    let files: string[];
    try {
      ({ files, carried, renamed } = carryNotes(store, dir, temp));
    } catch (error) {
      rmSync(temp, { recursive: true, force: true });
      throw error;
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
  return [`Cloned the ${store.label} from ${repo} into ${dir}`, ...carryLines(carried, renamed, kept)].join("\n");
}

/**
 * Install, for a store in the shared clone: clone the repo into
 * `.harness/stores` if that isn't done yet, then make the store's folder a
 * link to its own folder there. Notes in the folder it replaces are copied
 * in, as when cloning, and the old folder is kept beside it.
 */
function linkStore(workspace: string, store: RepoStore): string | undefined {
  const { repo, dir, root } = store;
  if (!repo) return undefined;
  // Mahler's own link into the clone, from an earlier install.
  const ours = isLink(dir) && insideFolder(resolve(dirname(dir), readlinkSync(dir)), root);
  if (!ours && existsSync(resolve(dir, "pending", "prs.json"))) {
    throw new Error(
      `The ${store.label} at ${dir} still has PRs on record from publishing on its own (pending/prs.json), which the shared clone can't follow. Settle them first: remove knowledge.repoPath and decisions.repoPath, rerun install, and run \`mahler knowledge sync\` until \`mahler doctor\` shows no PRs awaiting review. Then set them again and rerun install.`,
    );
  }
  const lines: string[] = [];
  if (!existsSync(resolve(root, ".git"))) {
    if (existsSync(root) && readdirSync(root).length > 0) {
      throw new Error(`Can't clone ${repo} into ${root}: it exists and isn't a clone. Move it aside, then rerun install.`);
    }
    const temp = `${root}.cloning`;
    cloneInto(workspace, store, temp);
    rmSync(root, { recursive: true, force: true });
    renameSync(temp, root);
    lines.push(`Cloned ${repo} into ${root}, shared by the knowledge store and the decisions ledger`);
  }
  const target = storeFolder(store);
  if (linksTo(dir, target)) return lines.length > 0 ? lines.join("\n") : undefined;
  mkdirSync(target, { recursive: true });
  let carried = 0;
  let renamed: string[] = [];
  let kept: string | undefined;
  if (ours) {
    // Linked elsewhere in the clone (its repoPath changed): only the link goes.
    unlinkSync(dir);
  } else if (isLink(dir)) {
    // A link of the user's own: carry in what it leads to, and keep the link aside.
    if (existsSync(dir)) ({ carried, renamed } = carryNotes(store, dir, target));
    kept = unusedPath(`${dir}.before-clone`);
    renameSync(dir, kept);
  } else if (existsSync(dir)) {
    let files: string[];
    ({ files, carried, renamed } = carryNotes(store, dir, target));
    if (files.length > 0) {
      kept = unusedPath(`${dir}.before-clone`);
      renameSync(dir, kept);
    } else {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  mkdirSync(dirname(dir), { recursive: true });
  // A junction on Windows, which needs no special rights; a symlink elsewhere.
  symlinkSync(relative(dirname(dir), target), dir, "junction");
  if (store.pr) ensureExcluded(root);
  else ensureGitignore(target);
  lines.push(`Linked the ${store.label} at ${dir} to its folder ${store.prefix} in the shared clone`);
  lines.push(...carryLines(carried, renamed, kept));
  return lines.join("\n");
}

/** Clone the store's repo into `temp` and check out its branch. */
function cloneInto(workspace: string, store: RepoStore, temp: string): void {
  const { repo } = store;
  rmSync(temp, { recursive: true, force: true });
  mkdirSync(dirname(temp), { recursive: true });
  const clone = spawnSync("git", ["clone", "--quiet", repoUrl(workspace, repo!), temp], {
    cwd: workspace,
    encoding: "utf8",
    env: GIT_ENV,
    timeout: CLONE_TIMEOUT_MS,
  });
  if (clone.status !== 0) {
    rmSync(temp, { recursive: true, force: true });
    const code = (clone.error as NodeJS.ErrnoException | undefined)?.code;
    const why =
      code === "ETIMEDOUT"
        ? `timed out after ${CLONE_TIMEOUT_MS / 1000} s`
        : code === "ENOENT"
          ? "git is not installed"
          : (clone.stderr ?? "").trim();
    throw new Error(`Couldn't clone the ${store.name} repo ${repo}: ${why}`);
  }
  try {
    checkOutBranch(temp, store.branch);
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Copy a local store's files from `from` into the store's folder in a clone,
 * `into`. Notes that differ stop the switch, with nothing copied; for
 * anything else (the README, say), the repo's copy wins. The ledger keeps
 * both: the local note goes in beside the repo's under a free name.
 */
function carryNotes(store: RepoStore, from: string, into: string): { files: string[]; carried: number; renamed: string[] } {
  const files = (readdirSync(from, { recursive: true, withFileTypes: true }) as Dirent[])
    .filter((entry) => entry.isFile())
    .map((entry) => relative(from, resolve(entry.parentPath, entry.name)))
    .filter((file) => file !== "INDEX.md" && !file.startsWith(`.git${sep}`));
  const differ = files.filter(
    (file) =>
      store.isNote(file) &&
      existsSync(resolve(into, file)) &&
      !readFileSync(resolve(into, file)).equals(readFileSync(resolve(from, file))),
  );
  if (differ.length > 0 && !store.renameClashes) {
    throw new Error(
      `Can't switch ${store.dir} to ${store.repo}: these files differ between the local store and the repo: ${differ.join(", ")}. Reconcile them, then rerun install.`,
    );
  }
  let carried = 0;
  const renamed: string[] = [];
  for (const file of files.filter((candidate) => !existsSync(resolve(into, candidate)))) {
    mkdirSync(dirname(resolve(into, file)), { recursive: true });
    copyFileSync(resolve(from, file), resolve(into, file));
    if (store.isNote(file)) carried += 1;
  }
  if (store.renameClashes) {
    for (const file of differ) {
      const target = freeName(file, (candidate) => existsSync(resolve(into, candidate)));
      copyFileSync(resolve(from, file), resolve(into, target));
      carried += 1;
      renamed.push(`${file} as ${target}`);
    }
  }
  return { files, carried, renamed };
}

function carryLines(carried: number, renamed: string[], kept: string | undefined): string[] {
  const lines: string[] = [];
  if (carried > 0) {
    lines.push(
      `Copied ${carried} local ${carried === 1 ? "note" : "notes"} into the clone; \`mahler knowledge sync\` publishes them.`,
    );
  }
  if (renamed.length > 0) {
    lines.push(`The repo already had notes with these names, so the local ones were copied in under new names: ${renamed.join(", ")}.`);
  }
  if (kept) lines.push(`The old folder is at ${kept}; delete it once you've checked.`);
  return lines;
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function insideFolder(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}${sep}`);
}

/** Whether `link` is a link that leads to `target`. */
function linksTo(link: string, target: string): boolean {
  try {
    return isLink(link) && realpathSync(link) === realpathSync(target);
  } catch {
    return false;
  }
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
  const { repo } = store;
  if (!repo) return {};
  if (store.shared) {
    if (!existsSync(resolve(store.root, ".git"))) {
      return { problem: `${store.root} isn't a clone of ${repo} yet; run \`mahler install\`, which clones it for both stores` };
    }
    if (!linksTo(store.dir, storeFolder(store))) {
      return {
        problem: `${store.dir} isn't linked to its folder ${store.prefix} in the shared clone ${store.root}: run \`mahler install\`, which links it, carries its notes over, and keeps the old folder beside it`,
      };
    }
  } else if (!existsSync(store.dir)) {
    return { problem: `${store.dir} is missing; run \`mahler install\` to clone ${repo}` };
  } else if (!existsSync(resolve(store.dir, ".git"))) {
    return {
      problem: `${store.dir} exists but isn't a clone of ${repo}: run \`mahler install\`, which clones the repo, carries the notes over, and keeps the old folder beside it`,
    };
  }
  const dir = store.root;
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
  // In a shared clone, only commits and changes in this store's folder count.
  const only = store.shared ? ["--", store.prefix] : [];
  const counts = git(dir, ["rev-list", "--left-right", "--count", `HEAD...refs/remotes/origin/${expected}`, ...only]);
  const [ahead, behind] = counts.ok ? counts.stdout.split(/\s+/).map(Number) : [commitCount(dir), 0];
  const dirty = git(dir, ["status", "--porcelain", ...only]).stdout !== "";
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
  if (config.knowledge.repoPath !== undefined || config.decisions?.repoPath !== undefined) {
    const problem = storeRepoProblem(workspace, config);
    if (problem) throw new Error(problem);
  }
  return syncStore(workspace, config, knowledgeStore(workspace, config), { ...options, message, lockWaitMs, quick }, "Knowledge sync");
}

/**
 * Back the decisions ledger up to `decisions.repo`, or return undefined when
 * it has no repo. It publishes directly, unless it shares the knowledge
 * store's clone and that publishes through PRs.
 */
export function syncLedger(workspace: string, config: HarnessConfig, options: SyncOptions = {}): SyncResult | undefined {
  if (!config.decisions?.repo) return undefined;
  const problem = storeRepoProblem(workspace, config);
  if (problem) throw new Error(problem);
  const store = ledgerStore(workspace, config);
  if (store.pr) checkPublishMode(config);
  const { message = "decisions: update the ledger", lockWaitMs = 60_000, quick = false } = options;
  return syncStore(workspace, config, store, { message, lockWaitMs, quick }, "Ledger sync");
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
  const { branch, repo } = store;
  if (!repo) throw new Error(`The ${store.label} has no repo to sync with`);
  const { done, published, renamed } = withLock<{ done: string[]; published: boolean; renamed?: Record<string, string> }>(
    workspace,
    store.lock,
    () => {
      if (store.pr) {
        // The stores share a clone, so each sync settles the other's PRs too.
        const other = store.shared
          ? prScope(store.name === "knowledge" ? ledgerStore(workspace, config) : knowledgeStore(workspace, config))
          : undefined;
        return prModeSync(prScope(store), branch, repo, options.message, options.quick ?? false, other);
      }
      ensureGitignore(storeFolder(store));
      return directSync(store, repo, options.message);
    },
    options.lockWaitMs,
  );
  writeIndexes(workspace, config);
  return { summary: `${title}: ${done.length > 0 ? done.join("; ") : "already up to date"}.`, published, renamed };
}

/**
 * Direct publish: commit, rebase onto the remote branch, push (one retry).
 * For the knowledge store, and the ledger in a shared clone, first settle
 * anything left from PR publish. In a shared clone, only the store's own
 * folder is committed; the push also carries any commits the other store
 * couldn't push yet.
 */
function directSync(
  store: RepoStore,
  repo: string,
  message: string,
): { done: string[]; published: boolean; renamed: Record<string, string> } {
  const { branch } = store;
  const dir = store.root;
  // Pathspecs in git commands run from here are relative to the store's folder.
  const here = storeFolder(store);
  const only = store.shared ? ["--", "."] : [];
  const renamed: Record<string, string> = {};
  // Left over from PR publish: settle its PRs, and publish what's still pending.
  const left: { done: string[]; blocked?: string } =
    store.name === "knowledge" || store.shared ? leavePrMode(prScope(store), branch) : { done: [] };
  const done = left.done;
  const unpublished = (why: string) => ({ done: [...done, why], published: false, renamed });
  if (left.blocked) return unpublished(left.blocked);
  // In a shared clone, stage only this store's folder. A commit with a
  // pathspec would re-read the working tree and undo the untracking below,
  // so clear the index of anything else first and commit what's staged.
  if (store.shared) git(dir, ["reset", "--quiet"]);
  // Ignoring a file the repo already tracks does nothing, so untrack it too.
  gitOrThrow(here, ["rm", "-r", "--cached", "--quiet", "--ignore-unmatch", "--", ...IGNORED.map(ignoredPathspec)]);
  gitOrThrow(here, ["add", "--all", ...only]);
  if (!git(here, ["diff", "--cached", "--quiet"]).ok) {
    gitOrThrow(here, ["commit", "--quiet", "-m", message]);
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
        if (store.renameClashes) {
          for (const [from, to] of Object.entries(renameClashes(store, remote, message))) {
            renamed[from] = to;
            done.push(`renamed ${from} (another machine had used the name) to ${to}`);
          }
        }
        // The other store's unsynced edits ride along in an autostash, which
        // can only go back cleanly if the pulled commits leave them alone.
        if (store.shared) {
          const blocking = othersInTheWay(store, remote);
          if (blocking.length > 0) {
            const other = store.name === "knowledge" ? "decisions ledger" : "knowledge store";
            return unpublished(
              `the ${other} has unsynced changes to ${blocking.join(", ")}, which the remote changed too; run \`mahler knowledge sync\`, which syncs both stores`,
            );
          }
        }
        const rebase = git(dir, ["rebase", "--quiet", ...(store.shared ? ["--autostash"] : []), remote]);
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
    if (ahead === 0) return { done, published: true, renamed };
    const push = git(dir, ["push", "--quiet", "-u", "origin", `HEAD:refs/heads/${branch}`], NETWORK_TIMEOUT_MS);
    if (push.ok) return { done: [...done, `pushed ${ahead} ${ahead === 1 ? "commit" : "commits"}`], published: true, renamed };
    const rejected = /\[rejected\]|non-fast-forward|fetch first/i.test(push.stderr);
    if (!rejected) {
      return unpublished(`couldn't push to ${repo} (${firstLine(push.stderr)}); run \`mahler knowledge sync\` later to publish`);
    }
  }
  return unpublished("the remote kept moving, so nothing was pushed; run `mahler knowledge sync` again");
}

export interface SyncResult {
  summary: string;
  /** Ledger notes renamed because another machine had used the name: old path → new, relative to the store. */
  renamed?: Record<string, string>;
  /** False when local commits couldn't reach the remote (offline, say). */
  published: boolean;
}

/**
 * Rename local, unpushed notes whose names the remote already holds with
 * other content, so the rebase doesn't stop on them. The local commits are
 * squashed into one with the new names.
 */
function renameClashes(store: RepoStore, remote: string, message: string): Record<string, string> {
  const dir = store.root;
  const { prefix } = store;
  // Paths from git are relative to the clone; isNote and the result, to the store.
  const own = (file: string) => file.slice(prefix.length);
  const base = git(dir, ["merge-base", "HEAD", remote]);
  // With rename detection on, an archive move isn't an add: archiving the
  // same note on two machines is a real conflict, not a name clash.
  const added = base.ok
    ? git(dir, ["diff", "--name-only", "--find-renames", "--diff-filter=A", base.stdout, "HEAD"]).stdout
    : git(dir, ["ls-tree", "-r", "--name-only", "HEAD"]).stdout;
  const files = added.split("\n").filter((file) => file !== "" && file.startsWith(prefix));
  const blob = (ref: string, file: string) => git(dir, ["rev-parse", "--verify", "--quiet", `${ref}:${file}`]);
  const differs = (file: string) => {
    const theirs = blob(remote, file);
    return theirs.ok && theirs.stdout !== blob("HEAD", file).stdout;
  };
  // Only new notes, which sit at the top level; archive/ holds moved ones.
  const clashes = files.filter((file) => store.isNote(own(file)) && !/[\\/]/.test(own(file)) && differs(file));
  // No shared history: the README and .gitignore are both sides' own, and the remote's win, as at clone.
  const theirs = base.ok ? [] : files.filter((file) => !store.isNote(own(file)) && differs(file));
  if (clashes.length === 0 && theirs.length === 0) return {};
  // In a shared clone this also folds in any unpushed commits of the other
  // store: their changes are kept, under this commit's message.
  if (base.ok) gitOrThrow(dir, ["reset", "--soft", "--quiet", base.stdout]);
  else gitOrThrow(dir, ["update-ref", "-d", "HEAD"]);
  if (theirs.length > 0) gitOrThrow(dir, ["checkout", remote, "--", ...theirs]);
  const taken = (candidate: string) =>
    [candidate, `archive/${candidate}`].some(
      (path) => existsSync(resolve(dir, prefix + path)) || blob(remote, prefix + path).ok,
    );
  const renamed: Record<string, string> = {};
  for (const file of clashes) {
    const target = freeName(own(file), taken);
    gitOrThrow(dir, ["mv", file, prefix + target]);
    renamed[own(file)] = target;
  }
  gitOrThrow(dir, ["commit", "--quiet", "-m", message]);
  return renamed;
}

/**
 * In a shared clone: the other store's uncommitted or untracked files that
 * the remote also changed since this clone last pulled.
 */
function othersInTheWay(store: RepoStore, remote: string): string[] {
  const list = (args: string[]) => git(store.root, args).stdout.split("\0").filter(Boolean);
  const dirty = [
    ...list(["diff", "--name-only", "-z", "HEAD"]),
    ...list(["ls-files", "--others", "--exclude-standard", "-z"]),
  ].filter((path) => !path.startsWith(store.prefix));
  if (dirty.length === 0) return [];
  const incoming = new Set(list(["diff", "--name-only", "-z", `HEAD...${remote}`]));
  return [...new Set(dirty.filter((path) => incoming.has(path)))].sort();
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

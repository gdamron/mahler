import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { parseNote, setFrontmatterField } from "./knowledge.js";
import { blobIdOf, firstLine, gh, git, gitOrThrow, IGNORED, NETWORK_TIMEOUT_MS } from "./knowledge-git.js";

/**
 * PR publish mode for a knowledge store clone. The clone itself only ever
 * fast-forwards to the remote branch; every change goes up as a pull request
 * (through the GitHub CLI) for the human to merge or close:
 *
 * - A new note (`learn`, `import`) waits in `pending/<slug>.md`, where search
 *   and briefs on this machine find it, and gets a PR of its own. Editing the
 *   pending note updates its PR.
 * - Edits to notes already in the repo (`verify`, hand edits, an audit) stay
 *   in the clone's working tree, and go up together as one open batch PR,
 *   updated as the edits change. `pending/edits.json` records it.
 *
 * Once a PR merges or closes, sync drops the local copy (a merged note only
 * once the pull that brings it has succeeded) and pulls.
 */

export interface PrSyncResult {
  done: string[];
  published: boolean;
}

/** The open batch of edits: each path's git blob id, or null for a deletion. */
interface Batch {
  branch: string;
  url?: string;
  files: Record<string, string | null>;
}

interface EditsLedger {
  batch?: Batch;
  /** Changes in closed batches, never proposed again (a file install recreates, say). */
  declined: Record<string, (string | null)[]>;
}

const EDITS = "edits.json";

/**
 * `quick` (for briefs): pull and settle using only what git can see, without
 * asking the forge about PRs or opening any, so a brief never waits on it.
 */
export function prModeSync(dir: string, branch: string, repo: string, message: string, quick = false): PrSyncResult {
  const done: string[] = [];
  let published = true;
  const fall = (why: string) => {
    done.push(why);
    published = false;
  };
  ensureExcluded(dir);
  git(dir, ["worktree", "prune"]);
  const fetch = git(dir, ["fetch", "--quiet", "--prune", "origin"], NETWORK_TIMEOUT_MS);
  if (!fetch.ok) {
    return {
      done: [`couldn't reach ${repo} (${firstLine(fetch.stderr)}); run \`mahler knowledge sync\` later to propose your changes`],
      published: false,
    };
  }
  const remote = `refs/remotes/origin/${branch}`;
  if (!git(dir, ["rev-parse", "--verify", "--quiet", remote]).ok) {
    throw new Error(
      `PR publish needs a "${branch}" branch on ${repo} for PRs to target; push a first commit to it (or sync once with knowledge.publish "direct")`,
    );
  }
  const ahead = count(dir, `${remote}..HEAD`);
  if (ahead > 0) {
    throw new Error(
      `${dir} has ${ahead} local ${ahead === 1 ? "commit" : "commits"} on ${branch}, which PR publish never pushes. Publish them with knowledge.publish "direct" and \`mahler knowledge sync\`, or move them to a branch and open a PR by hand.`,
    );
  }
  const forge = !quick;

  settleBatch(dir, remote, forge, done);
  let pulled = true;
  const behind = count(dir, `HEAD..${remote}`);
  if (behind > 0) {
    const merge = git(dir, ["merge", "--ff-only", "--quiet", remote]);
    if (merge.ok) {
      done.push(`pulled ${behind} ${behind === 1 ? "commit" : "commits"}`);
    } else {
      pulled = false;
      fall(
        `couldn't pull: local edits to ${overwrittenFiles(merge.stderr) || "some notes"} overlap changes on ${branch}; keep the remote's version (git checkout -- <file>) or fold yours into it, in ${dir}`,
      );
    }
  }
  const settled = settlePendingNotes(dir, remote, forge, pulled, done);
  if (quick) return { done, published };

  for (const file of pendingNotes(dir).filter((candidate) => !settled.has(candidate))) {
    try {
      syncPendingNote(dir, remote, branch, file, message, done, fall);
    } catch (error) {
      fall(`couldn't propose ${basename(file, ".md")} (${(error as Error).message})`);
    }
  }
  try {
    proposeEdits(dir, remote, branch, done, fall);
  } catch (error) {
    fall(`couldn't propose your edits (${(error as Error).message})`);
  }
  return { done, published };
}

// ---------------------------------------------------------------------------
// Settling what reviewers merged or closed
// ---------------------------------------------------------------------------

/**
 * Drop pending notes whose PR closed unmerged, and those whose PR merged once
 * the note has arrived with the pull. A note the remote holds exactly as
 * proposed counts as merged; a different note with the same slug (another
 * machine's) doesn't, so the forge decides. Returns the notes
 * that merged but wait for a pull, which must not be proposed again.
 */
function settlePendingNotes(dir: string, remote: string, forge: boolean, pulled: boolean, done: string[]): Set<string> {
  const waiting = new Set<string>();
  let merged = 0;
  for (const file of pendingNotes(dir)) {
    const slug = basename(file, ".md");
    const text = readFileSync(file, "utf8");
    // The remote holding the note exactly as proposed settles it, whatever
    // the forge says; otherwise ask the forge.
    let state: string | undefined =
      blobId(dir, remote, `notes/${slug}.md`) === blobIdOf(dir, withoutPrFields(text)) ? "MERGED" : undefined;
    if (state === undefined && forge) {
      state = findPr(dir, frontmatterField(text, "pr"), frontmatterField(text, "pr-branch"))?.state;
    }
    if (state === "MERGED" && !pulled) {
      waiting.add(file);
    } else if (state === "MERGED") {
      rmSync(file);
      merged += 1;
    } else if (state === "CLOSED") {
      rmSync(file);
      done.push(`dropped pending note ${slug} (its PR was closed unmerged)`);
    }
  }
  if (merged > 0) done.push(`${merged} pending ${merged === 1 ? "note" : "notes"} merged`);
  return waiting;
}

/**
 * When the open batch's PR has merged (perhaps with a reviewer's edits) or
 * closed, put the files it changed back to the clone's version, so the pull
 * can fast-forward over them. A file edited again since it was proposed is
 * left alone. A closed batch's changes are remembered, so they aren't
 * proposed again.
 */
function settleBatch(dir: string, remote: string, forge: boolean, done: string[]): void {
  const ledger = readEdits(dir);
  const { batch } = ledger;
  if (!batch) return;
  const entries = Object.entries(batch.files);
  let state: string | undefined = entries.every(([path, id]) => blobId(dir, remote, path) === id) ? "MERGED" : undefined;
  if (state === undefined && forge) state = findPr(dir, batch.url, batch.branch)?.state;
  if (state !== "MERGED" && state !== "CLOSED") return;
  for (const [path, id] of entries) {
    if (localBlobId(dir, path) === id) restore(dir, path);
    if (state === "CLOSED") ledger.declined[path] = [...(ledger.declined[path] ?? []), id];
  }
  ledger.batch = undefined;
  writeEdits(dir, ledger);
  const name = batch.url ?? batch.branch;
  done.push(state === "MERGED" ? `${name} merged` : `dropped the edits in ${name} (closed unmerged)`);
}

/**
 * The PR for `url`, or failing that the newest PR from `head`; undefined when
 * there is none or the forge can't be asked.
 */
function findPr(dir: string, url: string | undefined, head: string | undefined): { url: string; state: string } | undefined {
  if (url) {
    const view = gh(dir, ["pr", "view", url, "--json", "state", "--jq", ".state"]);
    if (view.ok && view.stdout) return { url, state: view.stdout };
  }
  if (!head) return undefined;
  const list = gh(dir, ["pr", "list", "--head", head, "--state", "all", "--json", "url,state", "--jq", '.[] | .url + " " + .state']);
  const [found, state] = (list.ok ? list.stdout.split("\n")[0] ?? "" : "").trim().split(" ");
  return found && state ? { url: found, state } : undefined;
}

// ---------------------------------------------------------------------------
// Proposing
// ---------------------------------------------------------------------------

/** Open a PR for a pending note, or push its local edits to the PR it has. */
function syncPendingNote(
  dir: string,
  remote: string,
  branch: string,
  file: string,
  message: string,
  done: string[],
  fall: (why: string) => void,
): void {
  const slug = basename(file, ".md");
  let text = readFileSync(file, "utf8");
  // Name the branch once, so retries and updates reuse it.
  let head = frontmatterField(text, "pr-branch");
  if (!head) {
    head = `knowledge/${slug}-${randomBytes(2).toString("hex")}`;
    text = setFrontmatterField(text, "pr-branch", head);
    writeFileSync(file, text);
  }
  let url = frontmatterField(text, "pr");
  const published = withoutPrFields(text);
  const note = parseNote(text, slug);
  if (blobId(dir, `refs/remotes/origin/${head}`, `notes/${slug}.md`) !== blobIdOf(dir, published)) {
    const commit = message.endsWith(slug) ? message : `knowledge: add ${slug}`;
    const pushed = pushChange(dir, remote, head, commit, (worktree) => {
      mkdirSync(resolve(worktree, "notes"), { recursive: true });
      writeFileSync(resolve(worktree, "notes", `${slug}.md`), published);
    });
    if (pushed.error) {
      fall(`couldn't push ${slug} for review (${pushed.error}); run \`mahler knowledge sync\` later`);
      return;
    }
    if (url) done.push(`updated ${url} for ${slug}`);
  }
  if (url) return;
  const title = `Knowledge: ${note.title}`;
  const body = noteBody(note, slug);
  const opened = openOrFindPr(dir, branch, head, title, body);
  if (!opened.url) {
    fall(`couldn't open a PR for ${slug} (${opened.error}); run \`mahler knowledge sync\` later`);
    return;
  }
  url = opened.url;
  writeFileSync(file, setFrontmatterField(text, "pr", url));
  done.push(`opened ${url} for ${slug}`);
}

function noteBody(note: ReturnType<typeof parseNote>, slug: string): string {
  return [
    note.description,
    "",
    `- Note: \`notes/${slug}.md\``,
    ...(note.tags.length > 0 ? [`- Tags: ${note.tags.join(", ")}`] : []),
    ...(note.repos.length > 0 ? [`- Repos: ${note.repos.join(", ")}`] : []),
    ...(note.sources.length > 0 ? [`- Sources: ${note.sources.join(", ")}`] : []),
    "",
    "Proposed by Mahler. Merge to publish the note to every clone of this store; close the PR to drop it.",
  ].join("\n");
}

/**
 * Keep one open batch PR in step with the working tree's edits: open it for
 * the first edit, and force-push its branch as edits change, so a file never
 * sits in two competing PRs.
 */
function proposeEdits(dir: string, remote: string, branch: string, done: string[], fall: (why: string) => void): void {
  const ledger = readEdits(dir);
  const files: Record<string, string | null> = {};
  for (const path of changedPaths(dir)) {
    const id = localBlobId(dir, path);
    if (!(ledger.declined[path] ?? []).includes(id)) files[path] = id;
  }
  const paths = Object.keys(files);
  const batch = ledger.batch;
  if (paths.length === 0) return;
  const title = paths.length === 1 ? `Knowledge: update ${paths[0]}` : `Knowledge: update ${paths.length} files`;
  const body = [
    "Edits to the knowledge store (verified dates, corrections, merges, or retirements):",
    "",
    ...paths.map((path) => `- \`${path}\`${files[path] === null ? " (removed)" : ""}`),
    "",
    "Proposed by Mahler, which updates this PR as the edits change. Merge to publish them to every clone of this store; close the PR to drop them.",
  ].join("\n");
  const unchanged = batch && sameFiles(batch.files, files);
  const head = batch?.branch ?? `knowledge/update-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`;
  if (!unchanged) {
    const pushed = pushChange(dir, remote, head, title.replace(/^Knowledge: /, "knowledge: "), (worktree) => {
      for (const path of paths) {
        const target = resolve(worktree, path);
        if (files[path] === null) {
          rmSync(target, { force: true });
        } else {
          mkdirSync(dirname(target), { recursive: true });
          copyFileSync(resolve(dir, path), target);
        }
      }
    });
    if (pushed.empty) return;
    if (pushed.error) {
      fall(`couldn't push your edits for review (${pushed.error}); run \`mahler knowledge sync\` later`);
      return;
    }
    ledger.batch = { branch: head, url: batch?.url, files };
    writeEdits(dir, ledger);
  }
  const current = ledger.batch!;
  if (current.url) {
    if (!unchanged) {
      gh(dir, ["pr", "edit", current.url, "--title", title, "--body", body]);
      done.push(`updated ${current.url} with ${paths.length} ${paths.length === 1 ? "edit" : "edits"}`);
    }
    return;
  }
  const opened = openOrFindPr(dir, branch, head, title, body);
  if (!opened.url) {
    fall(`couldn't open a PR for your edits (${opened.error}); run \`mahler knowledge sync\` later`);
    return;
  }
  current.url = opened.url;
  writeEdits(dir, ledger);
  done.push(`proposed ${paths.length} ${paths.length === 1 ? "edit" : "edits"} in ${opened.url}`);
}

function sameFiles(a: Record<string, string | null>, b: Record<string, string | null>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => key in b && a[key] === b[key]);
}

/**
 * Commit a change on top of the remote branch in a temporary worktree and
 * force-push it as `head` (a branch only Mahler writes). The clone's own
 * checkout and working tree are untouched.
 */
function pushChange(
  dir: string,
  remote: string,
  head: string,
  message: string,
  fill: (worktree: string) => void,
): { empty?: boolean; error?: string } {
  const scratch = mkdtempSync(resolve(tmpdir(), "mahler-knowledge-pr-"));
  const worktree = resolve(scratch, "tree");
  try {
    gitOrThrow(dir, ["worktree", "add", "--quiet", "--detach", worktree, remote]);
    fill(worktree);
    gitOrThrow(worktree, ["add", "--all"]);
    if (git(worktree, ["diff", "--cached", "--quiet"]).ok) return { empty: true };
    gitOrThrow(worktree, ["commit", "--quiet", "-m", message]);
    const push = git(worktree, ["push", "--quiet", "--force", "origin", `HEAD:refs/heads/${head}`], NETWORK_TIMEOUT_MS);
    if (!push.ok) return { error: firstLine(push.stderr) };
    git(dir, ["fetch", "--quiet", "origin", `+refs/heads/${head}:refs/remotes/origin/${head}`], NETWORK_TIMEOUT_MS);
    return {};
  } finally {
    git(dir, ["worktree", "remove", "--force", worktree]);
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Open a PR from `head`, unless one exists already: an earlier `gh pr create`
 * may have succeeded without Mahler hearing back.
 */
function openOrFindPr(dir: string, branch: string, head: string, title: string, body: string): { url?: string; error?: string } {
  const existing = findPr(dir, undefined, head);
  if (existing?.state === "OPEN") return { url: existing.url };
  const result = gh(dir, ["pr", "create", "--base", branch, "--head", head, "--title", title, "--body", body]);
  if (!result.ok) return { error: firstLine(result.stderr) };
  const url = result.stdout.split("\n").reverse().find((line) => /^https?:\/\//.test(line.trim()));
  return url ? { url: url.trim() } : { error: `gh printed no PR URL: ${firstLine(result.stdout)}` };
}

// ---------------------------------------------------------------------------
// Leaving PR mode
// ---------------------------------------------------------------------------

/**
 * Direct publish after PR publish: move pending notes into `notes/`, to be
 * committed and pushed like any other change, and forget the batch. Returns
 * what happened, for the sync summary.
 */
export function adoptPendingNotes(dir: string): string[] {
  const done: string[] = [];
  const moved: string[] = [];
  for (const file of pendingNotes(dir)) {
    const slug = basename(file, ".md");
    const target = resolve(dir, "notes", `${slug}.md`);
    if (existsSync(target)) {
      done.push(`left pending/${slug}.md alone: notes/${slug}.md already exists; merge them by hand`);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, withoutPrFields(readFileSync(file, "utf8")));
    rmSync(file);
    moved.push(slug);
  }
  if (moved.length > 0) {
    done.push(`moved ${moved.length} pending ${moved.length === 1 ? "note" : "notes"} into notes/ (close ${moved.length === 1 ? "its PR" : "their PRs"} on the forge)`);
  }
  rmSync(resolve(dir, "pending", EDITS), { force: true });
  return done;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function pendingNotes(dir: string): string[] {
  const pending = resolve(dir, "pending");
  if (!existsSync(pending)) return [];
  return readdirSync(pending, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => resolve(pending, entry.name))
    .sort();
}

export function readEdits(dir: string): EditsLedger {
  const file = resolve(dir, "pending", EDITS);
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<EditsLedger>;
    return { batch: parsed.batch, declined: parsed.declined ?? {} };
  } catch {
    return { declined: {} };
  }
}

function writeEdits(dir: string, ledger: EditsLedger): void {
  const file = resolve(dir, "pending", EDITS);
  if (!ledger.batch && Object.keys(ledger.declined).length === 0) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
}

/** A frontmatter value, unquoted; undefined when absent or empty. */
export function frontmatterField(text: string, key: string): string | undefined {
  const match = /^(?:<!--[\s\S]*?-->\s*)?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return undefined;
  const line = match[1].split(/\r?\n/).find((candidate) => candidate.startsWith(`${key}:`));
  const value = line?.slice(key.length + 1).trim().replace(/^"(.*)"$/, "$1");
  return value || undefined;
}

/** The note as the repo should hold it, without this machine's PR bookkeeping. */
function withoutPrFields(text: string): string {
  return text.replace(/^(?:<!--[\s\S]*?-->\s*)?---\r?\n[\s\S]*?\r?\n---/, (frontmatter) =>
    frontmatter.replace(/^pr(?:-branch)?:.*\r?\n/gm, ""),
  );
}

/**
 * PR mode keeps machine-local files out of git through `.git/info/exclude`,
 * not `.gitignore`: a `.gitignore` change would itself need a PR.
 */
export function ensureExcluded(dir: string): void {
  const file = resolve(dir, ".git", "info", "exclude");
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lines = current.split(/\r?\n/);
  const missing = IGNORED.filter((entry) => !lines.includes(entry));
  if (missing.length === 0) return;
  mkdirSync(dirname(file), { recursive: true });
  const prefix = current === "" || current.endsWith("\n") ? current : `${current}\n`;
  writeFileSync(file, `${prefix}${missing.join("\n")}\n`);
}

/** Tracked files changed in the working tree, plus new files git doesn't ignore. */
function changedPaths(dir: string): string[] {
  const list = (args: string[]) => git(dir, args).stdout.split("\0").filter(Boolean);
  const paths = new Set([
    ...list(["diff", "--name-only", "-z", "HEAD"]),
    ...list(["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  return [...paths].filter((path) => !isMachineLocal(path)).sort();
}

/** Never proposed, even when the repo tracks it by mistake. */
function isMachineLocal(path: string): boolean {
  return path === "INDEX.md" || /^(pending|\.obsidian|\.trash)\//.test(path) || basename(path) === ".DS_Store";
}

/** The files git refused to overwrite, from a failed merge's stderr. */
function overwrittenFiles(stderr: string): string {
  return stderr
    .split("\n")
    .filter((line) => /^\s+\S/.test(line) && !/^\s*(Please|Aborting)/.test(line))
    .map((line) => line.trim())
    .join(", ");
}

function blobId(dir: string, ref: string, path: string): string | null {
  const result = git(dir, ["rev-parse", "--verify", "--quiet", `${ref}:${path}`]);
  return result.ok ? result.stdout : null;
}

function localBlobId(dir: string, path: string): string | null {
  if (!existsSync(resolve(dir, path))) return null;
  const result = git(dir, ["hash-object", "--", path]);
  return result.ok ? result.stdout : null;
}

/** Put a file back to the clone's committed version (or remove a new one). */
function restore(dir: string, path: string): void {
  if (blobId(dir, "HEAD", path) !== null) gitOrThrow(dir, ["checkout", "--quiet", "HEAD", "--", path]);
  else rmSync(resolve(dir, path), { force: true });
}

function count(dir: string, range: string): number {
  return Number(git(dir, ["rev-list", "--count", range]).stdout || 0);
}

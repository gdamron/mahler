import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { parseNote, setFrontmatterField } from "./knowledge.js";
import { firstLine, gh, git, gitOrThrow, NETWORK_TIMEOUT_MS } from "./knowledge-git.js";

/**
 * PR publish mode for a knowledge store clone. The clone itself only ever
 * fast-forwards to the remote branch; every change goes up as a pull request
 * for the human to merge or close:
 *
 * - A new note (`learn`, `import`) waits in `pending/<slug>.md`, where search
 *   and briefs on this machine find it, and gets a PR of its own.
 * - Edits to notes already in the repo (`verify`, hand edits, an audit) stay
 *   in the clone's working tree, and each sync proposes the ones not yet
 *   proposed as one PR. `pending/proposals.json` records what each PR holds.
 *
 * Once the remote branch has a change (or its PR merged with edits), or its
 * PR is closed unmerged, sync drops the local copy and pulls.
 */

export interface PrSyncResult {
  done: string[];
  published: boolean;
}

/** One batch of edits proposed as a PR: each path's git blob id, or null for a deletion. */
interface Proposal {
  branch: string;
  url?: string;
  title: string;
  body: string;
  files: Record<string, string | null>;
}

const PROPOSALS = "proposals.json";

export function prModeSync(dir: string, branch: string, repo: string, message: string): PrSyncResult {
  const done: string[] = [];
  let published = true;
  const fall = (why: string) => {
    done.push(why);
    published = false;
  };
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

  settleProposals(dir, remote, done);
  const behind = count(dir, `HEAD..${remote}`);
  if (behind > 0) {
    const merge = git(dir, ["merge", "--ff-only", "--quiet", remote]);
    if (merge.ok) done.push(`pulled ${behind} ${behind === 1 ? "commit" : "commits"}`);
    else fall(`couldn't pull, because local edits touch notes the remote changed (${firstLine(merge.stderr)}); merge or discard them in ${dir}`);
  }
  settlePendingNotes(dir, remote, done);

  for (const file of pendingNotes(dir)) {
    if (frontmatterField(readFileSync(file, "utf8"), "pr")) continue;
    const opened = proposeNote(dir, remote, branch, file, message);
    if (opened.url) done.push(`opened ${opened.url} for ${basename(file, ".md")}`);
    else fall(`couldn't open a PR for ${basename(file, ".md")} (${opened.error}); run \`mahler knowledge sync\` later`);
  }
  retryUnopenedProposals(dir, branch, done, fall);
  proposeEdits(dir, remote, branch, done, fall);
  return { done, published };
}

// ---------------------------------------------------------------------------
// Settling what reviewers merged or closed
// ---------------------------------------------------------------------------

/** Drop pending notes the remote now has, or whose PR was closed unmerged. */
function settlePendingNotes(dir: string, remote: string, done: string[]): void {
  let merged = 0;
  for (const file of pendingNotes(dir)) {
    const slug = basename(file, ".md");
    const url = frontmatterField(readFileSync(file, "utf8"), "pr");
    const landed = ["notes", "archive"].some((folder) => blobId(dir, remote, `${folder}/${slug}.md`) !== null);
    const state = landed ? "MERGED" : url ? prState(dir, url) : undefined;
    if (state === "MERGED") {
      rmSync(file);
      merged += 1;
    } else if (state === "CLOSED") {
      rmSync(file);
      done.push(`dropped pending note ${slug} (its PR was closed unmerged)`);
    }
  }
  if (merged > 0) done.push(`${merged} pending ${merged === 1 ? "note" : "notes"} merged`);
}

/**
 * For each proposed batch that the remote has (or whose PR merged with a
 * reviewer's edits, or closed), put the files it changed back to the clone's
 * version, so the pull can fast-forward over them. A file edited again since
 * it was proposed is left alone; the next proposal picks it up.
 */
function settleProposals(dir: string, remote: string, done: string[]): void {
  const proposals = readProposals(dir);
  if (proposals.length === 0) return;
  const open: Proposal[] = [];
  for (const proposal of proposals) {
    const entries = Object.entries(proposal.files);
    const landed = entries.every(([path, id]) => blobId(dir, remote, path) === id);
    const state = landed ? "MERGED" : proposal.url ? prState(dir, proposal.url) : undefined;
    if (state !== "MERGED" && state !== "CLOSED") {
      open.push(proposal);
      continue;
    }
    for (const [path, id] of entries) {
      if (localBlobId(dir, path) === id) restore(dir, path);
    }
    const name = proposal.url ?? proposal.branch;
    done.push(state === "MERGED" ? `${name} merged` : `dropped the edits in ${name} (closed unmerged)`);
  }
  writeProposals(dir, open);
}

/** OPEN, CLOSED, or MERGED; undefined when the forge can't be asked. */
function prState(dir: string, url: string): string | undefined {
  const result = gh(dir, ["pr", "view", url, "--json", "state", "--jq", ".state"]);
  return result.ok ? result.stdout : undefined;
}

// ---------------------------------------------------------------------------
// Proposing
// ---------------------------------------------------------------------------

function proposeNote(dir: string, remote: string, branch: string, file: string, message: string): Opened {
  const slug = basename(file, ".md");
  let text = readFileSync(file, "utf8");
  // Name the branch once, so a retry after a failed `gh pr create` reuses it.
  let head = frontmatterField(text, "pr-branch");
  if (!head) {
    head = `knowledge/${slug}-${randomBytes(2).toString("hex")}`;
    text = setFrontmatterField(text, "pr-branch", head);
    writeFileSync(file, text);
  }
  const note = parseNote(text, slug);
  const published = withoutPrFields(text);
  const body = [
    note.description,
    "",
    `- Note: \`notes/${slug}.md\``,
    note.tags.length > 0 ? `- Tags: ${note.tags.join(", ")}` : "",
    note.repos.length > 0 ? `- Repos: ${note.repos.join(", ")}` : "",
    note.sources.length > 0 ? `- Sources: ${note.sources.join(", ")}` : "",
    "",
    "Proposed by Mahler. Merge to publish the note to every clone of this store; close the PR to drop it.",
  ]
    .filter((line, at, lines) => line !== "" || lines[at - 1] !== "")
    .join("\n");
  const commit = message.endsWith(slug) ? message : `knowledge: add ${slug}`;
  const opened = openPr(dir, remote, branch, head, (worktree) => {
    mkdirSync(resolve(worktree, "notes"), { recursive: true });
    writeFileSync(resolve(worktree, "notes", `${slug}.md`), published);
  }, commit, `Knowledge: ${note.title}`, body);
  if (opened.url) writeFileSync(file, setFrontmatterField(text, "pr", opened.url));
  return opened;
}

/** Propose working-tree edits that no open proposal already holds, as one PR. */
function proposeEdits(
  dir: string,
  remote: string,
  branch: string,
  done: string[],
  fall: (why: string) => void,
): void {
  const proposals = readProposals(dir);
  const files: Record<string, string | null> = {};
  for (const path of changedPaths(dir)) {
    const id = localBlobId(dir, path);
    if (!proposals.some((proposal) => proposal.files[path] === id && path in proposal.files)) files[path] = id;
  }
  const paths = Object.keys(files);
  if (paths.length === 0) return;
  const head = `knowledge/update-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`;
  const title = paths.length === 1 ? `Knowledge: update ${paths[0]}` : `Knowledge: update ${paths.length} files`;
  const body = [
    "Edits to the knowledge store (verified dates, corrections, merges, or retirements):",
    "",
    ...paths.map((path) => `- \`${path}\`${files[path] === null ? " (removed)" : ""}`),
    "",
    "Proposed by Mahler. Merge to publish these edits to every clone of this store; close the PR to drop them.",
  ].join("\n");
  const opened = openPr(dir, remote, branch, head, (worktree) => {
    for (const path of paths) {
      const target = resolve(worktree, path);
      if (files[path] === null) {
        rmSync(target, { force: true });
      } else {
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(resolve(dir, path), target);
      }
    }
  }, `knowledge: update ${paths.length === 1 ? paths[0] : `${paths.length} files`}`, title, body);
  if (opened.empty) return;
  // Record a pushed batch even when the PR failed to open, so it isn't
  // proposed twice; the next sync retries the PR.
  if (opened.pushed) writeProposals(dir, [...proposals, { branch: head, url: opened.url, title, body, files }]);
  if (opened.url) done.push(`proposed ${paths.length} ${paths.length === 1 ? "edit" : "edits"} in ${opened.url}`);
  else fall(`couldn't open a PR for your edits (${opened.error}); run \`mahler knowledge sync\` later`);
}

function retryUnopenedProposals(dir: string, branch: string, done: string[], fall: (why: string) => void): void {
  const proposals = readProposals(dir);
  if (proposals.every((proposal) => proposal.url)) return;
  for (const proposal of proposals.filter((candidate) => !candidate.url)) {
    const created = createPr(dir, branch, proposal.branch, proposal.title, proposal.body);
    if (created.url) {
      proposal.url = created.url;
      done.push(`opened ${created.url} for edits proposed earlier`);
    } else {
      fall(`couldn't open a PR for ${proposal.branch} (${created.error}); run \`mahler knowledge sync\` later`);
    }
  }
  writeProposals(dir, proposals);
}

interface Opened {
  url?: string;
  pushed?: boolean;
  /** The change was already on the remote branch: nothing to propose. */
  empty?: boolean;
  error?: string;
}

/**
 * Commit a change on top of the remote branch in a temporary worktree, push
 * it as `head`, and open a PR into `branch`. The clone's own checkout and
 * working tree are untouched.
 */
function openPr(
  dir: string,
  remote: string,
  branch: string,
  head: string,
  fill: (worktree: string) => void,
  message: string,
  title: string,
  body: string,
): Opened {
  const worktree = resolve(mkdtempSync(resolve(tmpdir(), "mahler-knowledge-pr-")), "tree");
  gitOrThrow(dir, ["worktree", "add", "--quiet", "--detach", worktree, remote]);
  try {
    fill(worktree);
    gitOrThrow(worktree, ["add", "--all"]);
    if (git(worktree, ["diff", "--cached", "--quiet"]).ok) return { empty: true };
    gitOrThrow(worktree, ["commit", "--quiet", "-m", message]);
    const push = git(worktree, ["push", "--quiet", "--force", "origin", `HEAD:refs/heads/${head}`], NETWORK_TIMEOUT_MS);
    if (!push.ok) return { error: firstLine(push.stderr) };
    return { pushed: true, ...createPr(worktree, branch, head, title, body) };
  } finally {
    git(dir, ["worktree", "remove", "--force", worktree]);
    rmSync(dirname(worktree), { recursive: true, force: true });
  }
}

function createPr(dir: string, branch: string, head: string, title: string, body: string): { url?: string; error?: string } {
  const result = gh(dir, ["pr", "create", "--base", branch, "--head", head, "--title", title, "--body", body]);
  if (!result.ok) return { error: firstLine(result.stderr) };
  const url = result.stdout.split("\n").reverse().find((line) => /^https?:\/\//.test(line.trim()));
  return url ? { url: url.trim() } : { error: `gh printed no PR URL: ${firstLine(result.stdout)}` };
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

export function readProposals(dir: string): Proposal[] {
  const file = resolve(dir, "pending", PROPOSALS);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as Proposal[]) : [];
  } catch {
    return [];
  }
}

function writeProposals(dir: string, proposals: Proposal[]): void {
  const file = resolve(dir, "pending", PROPOSALS);
  if (proposals.length === 0) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(proposals, null, 2)}\n`);
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
  return (
    path === "INDEX.md" ||
    /^(pending|\.obsidian|\.trash)\//.test(path) ||
    basename(path) === ".DS_Store"
  );
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

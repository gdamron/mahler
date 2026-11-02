import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { parseNote } from "./knowledge.js";
import { blobIdOf, firstLine, gh, git, gitOrThrow, gitText, IGNORED, NETWORK_TIMEOUT_MS } from "./knowledge-git.js";

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
 *   kept in step with them.
 *
 * `pending/prs.json` records each PR: its branch, URL, and what Mahler last
 * pushed. Mahler pushes to a PR only while the forge says it's open and its
 * branch holds nothing but Mahler's own commits, and never force-pushes, so a
 * reviewer's commits are never overwritten. Once a PR merges or closes, sync
 * drops the local copy and pulls; an edit made after the PR's last push is
 * kept, folded into the merged version when it merged.
 */

export interface PrSyncResult {
  done: string[];
  published: boolean;
}

interface Proposal {
  /** The PR's branch on the remote. */
  branch: string;
  url?: string;
  /** The commit Mahler last pushed to the branch. */
  head?: string;
}

interface NoteProposal extends Proposal {
  /** The note's git blob id as last pushed. */
  blob?: string;
  /** Merged, but edited here since in a way that conflicts with the merged note. */
  merged?: boolean;
}

interface BatchProposal extends Proposal {
  /** Each path's git blob id as last pushed, or null for a deletion. */
  files: Record<string, string | null>;
}

export interface Ledger {
  notes: Record<string, NoteProposal>;
  batch?: BatchProposal;
}

type PrState = "OPEN" | "MERGED" | "CLOSED" | "NONE";

/** What the forge says about a PR; NONE when its branch has none. */
interface PrInfo {
  state: PrState;
  url?: string;
  /** The PR's head commit: as merged or closed, once it is. */
  head?: string;
}

const LEDGER = "prs.json";

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
  const ledger = readLedger(dir);

  const batch = settleBatch(dir, remote, forge, ledger, true, done);
  let pulled = true;
  const behind = count(dir, `HEAD..${remote}`);
  if (behind > 0) {
    const merge = git(dir, ["merge", "--ff-only", "--quiet", remote]);
    if (merge.ok) {
      done.push(`pulled ${behind} ${behind === 1 ? "commit" : "commits"}`);
    } else {
      pulled = false;
      fall(
        `couldn't pull: local edits to ${overwrittenFiles(merge.stderr) || "some notes"} overlap changes on ${branch}. In ${dir}, keep the remote's version (discard or move your copy) or fold yours into it; your edits are proposed once the pull succeeds`,
      );
    }
  }
  // Edits made after a merged batch's last push, put back on top of the pull.
  for (const carry of batch.carries) writeOrRemove(resolve(dir, carry.path), pulled ? carry.text : carry.local);
  const notes = settlePendingNotes(dir, remote, forge, pulled, ledger, done, fall);
  if (quick) return { done, published };

  for (const file of pendingNotes(dir)) {
    const slug = basename(file, ".md");
    if (notes.waiting.has(slug)) continue;
    try {
      proposeNote(dir, remote, branch, slug, ledger, notes.states.get(slug), message, done, fall);
    } catch (error) {
      fall(`couldn't propose ${slug} (${(error as Error).message})`);
    }
  }
  // After a blocked pull the working tree sits on an old commit, and its
  // files would undo newer changes on the branch.
  if (!pulled) return { done, published };
  try {
    proposeEdits(dir, remote, branch, ledger, batch.state, done, fall);
  } catch (error) {
    fall(`couldn't propose your edits (${(error as Error).message})`);
  }
  return { done, published };
}

// ---------------------------------------------------------------------------
// Settling what reviewers merged or closed
// ---------------------------------------------------------------------------

/**
 * Settle pending notes whose PR merged or closed. A merged note is dropped
 * once the pull that brings it has succeeded, with any edit made after its
 * last push folded into the merged note; a closed one is dropped unless it
 * changed since, when it's proposed afresh. Returns each still-pending note's
 * PR state (absent when the forge couldn't say), and the merged notes that
 * wait on a pull or a hand merge, which must not be proposed again.
 */
function settlePendingNotes(
  dir: string,
  remote: string,
  forge: boolean,
  pulled: boolean,
  ledger: Ledger,
  done: string[],
  fall: (why: string) => void,
): { states: Map<string, PrState>; waiting: Set<string> } {
  const states = new Map<string, PrState>();
  const waiting = new Set<string>();
  let merged = 0;
  for (const file of pendingNotes(dir)) {
    const slug = basename(file, ".md");
    const entry = ledger.notes[slug];
    if (!entry) {
      states.set(slug, "NONE");
      continue;
    }
    const path = `notes/${slug}.md`;
    const info: PrInfo | undefined = entry.merged ? { state: "MERGED", head: entry.head } : noteState(dir, remote, forge, entry, path);
    if (!info) continue;
    if (info.url && !entry.url) {
      // A PR opened without Mahler hearing back.
      entry.url = info.url;
      done.push(`found ${info.url} for ${slug}`);
    }
    if (info.state === "OPEN" || info.state === "NONE") {
      states.set(slug, info.state);
      continue;
    }
    const name = entry.url ?? entry.branch;
    ensureCommit(dir, info.head);
    const proposed = proposedBlob(dir, info.head, path, entry.blob);
    const text = readFileSync(file, "utf8");
    const local = blobIdOf(dir, text);
    if (info.state === "CLOSED") {
      delete ledger.notes[slug];
      if (local === proposed) {
        rmSync(file);
        done.push(`dropped pending note ${slug} (its PR was closed unmerged)`);
      } else {
        states.set(slug, "NONE");
        done.push(`${name} for ${slug} was closed unmerged, but the note changed since; proposing it again`);
      }
      continue;
    }
    if (!pulled) {
      waiting.add(slug);
      continue;
    }
    if (local === proposed) {
      rmSync(file);
      delete ledger.notes[slug];
      merged += 1;
      continue;
    }
    // Edited after its last push: fold the edit into the note as merged, where
    // it goes up with the other edits.
    const theirs = existsSync(resolve(dir, path)) ? readFileSync(resolve(dir, path), "utf8") : undefined;
    const base = proposed ? readBlob(dir, proposed) : undefined;
    const folded = theirs === undefined || base === undefined ? undefined : theirs === base ? text : merge3(dir, text, base, theirs);
    if (folded === undefined) {
      Object.assign(entry, { merged: true, head: info.head, blob: proposed ?? entry.blob });
      waiting.add(slug);
      fall(`pending/${slug}.md changed after ${name} merged, in ways that conflict with the merged ${path}; fold your changes into it by hand and delete pending/${slug}.md`);
      continue;
    }
    writeFileSync(resolve(dir, path), folded);
    rmSync(file);
    delete ledger.notes[slug];
    merged += 1;
    done.push(`kept your later edits to ${slug}`);
  }
  writeLedger(dir, ledger);
  if (merged > 0) done.push(`${merged} pending ${merged === 1 ? "note" : "notes"} merged`);
  return { states, waiting };
}

/** The note's PR state: merged when the remote holds the note exactly as last pushed, else what the forge says. */
function noteState(dir: string, remote: string, forge: boolean, entry: NoteProposal, path: string): PrInfo | undefined {
  if (entry.head && entry.blob && blobId(dir, remote, path) === entry.blob) return { state: "MERGED", head: entry.head };
  return forge ? findPr(dir, entry) : undefined;
}

interface Carry {
  path: string;
  /** The file as it is now, put back if the pull fails; null when deleted. */
  local: string | null;
  /** The file to write once the pull succeeds. */
  text: string | null;
}

/**
 * Settle the open batch when its PR has merged (perhaps with a reviewer's
 * edits) or closed: put each file it proposed back to the clone's version, so
 * the pull can fast-forward over it. A file edited again since its last push
 * keeps the edit. For a merged batch, `carry` folds that edit into the merged
 * version, to write after the pull; without it, or when the edit conflicts,
 * the file is left as it is. Returns the batch's PR state (absent when the
 * forge couldn't say), and the folded edits.
 */
function settleBatch(
  dir: string,
  remote: string,
  forge: boolean,
  ledger: Ledger,
  carry: boolean,
  done: string[],
): { state?: PrState; carries: Carry[] } {
  const { batch } = ledger;
  if (!batch) return { state: "NONE", carries: [] };
  const entries = Object.entries(batch.files);
  let info: PrInfo | undefined;
  if (batch.head && entries.length > 0 && entries.every(([path, id]) => blobId(dir, remote, path) === id)) {
    info = { state: "MERGED", head: batch.head };
  } else if (forge) {
    info = findPr(dir, batch);
  }
  if (!info) return { carries: [] };
  if (info.state === "OPEN" || info.state === "NONE") {
    if (info.url && !batch.url) {
      batch.url = info.url;
      writeLedger(dir, ledger);
      done.push(`found ${info.url} for your edits`);
    }
    return { state: info.state, carries: [] };
  }
  ensureCommit(dir, info.head);
  const carries: Carry[] = [];
  let kept = 0;
  for (const [path, recorded] of entries) {
    const proposed = proposedBlob(dir, info.head, path, recorded);
    const local = localBlobId(dir, path);
    if (local === proposed) {
      restore(dir, path);
      continue;
    }
    kept += 1;
    if (info.state !== "MERGED" || !carry) continue;
    const theirs = blobId(dir, remote, path);
    const localText = local === null ? null : readFileSync(resolve(dir, path), "utf8");
    let text: string | null | undefined;
    if (theirs === proposed) {
      text = localText;
    } else if (localText !== null && proposed && theirs) {
      text = merge3(dir, localText, readBlob(dir, proposed) ?? "", readBlob(dir, theirs) ?? "");
    }
    if (text === undefined) continue;
    restore(dir, path);
    carries.push({ path, local: localText, text });
  }
  delete ledger.batch;
  writeLedger(dir, ledger);
  const name = batch.url ?? batch.branch;
  const later = kept > 0 ? `, keeping your later edits to ${kept} ${kept === 1 ? "file" : "files"}` : "";
  done.push(info.state === "MERGED" ? `${name} merged${later}` : `dropped the edits in ${name} (closed unmerged)${later}`);
  return { state: info.state, carries };
}

/**
 * The PR for a proposal: by URL, or failing that the newest PR from its
 * branch. NONE when the branch has none; undefined when the forge can't be
 * asked.
 */
function findPr(dir: string, proposal: Proposal): PrInfo | undefined {
  if (proposal.url) {
    const view = gh(dir, ["pr", "view", proposal.url, "--json", "state,headRefOid", "--jq", '.state + " " + .headRefOid']);
    const [state, head] = view.ok ? view.stdout.trim().split(" ") : [];
    if (isState(state)) return { state, url: proposal.url, head: head || undefined };
  }
  const list = gh(dir, [
    "pr", "list", "--head", proposal.branch, "--state", "all",
    "--json", "url,state,headRefOid", "--jq", '.[] | .url + " " + .state + " " + .headRefOid',
  ]);
  if (!list.ok) return undefined;
  const line = list.stdout.split("\n")[0]?.trim();
  if (!line) return proposal.url ? undefined : { state: "NONE" };
  const [url, state, head] = line.split(" ");
  return isState(state) ? { state, url, head: head || undefined } : undefined;
}

function isState(value: string | undefined): value is PrState {
  return value === "OPEN" || value === "MERGED" || value === "CLOSED";
}

/**
 * A file's blob id as the PR last proposed it: at the PR's head commit when
 * that's known and here, else as Mahler recorded pushing it.
 */
function proposedBlob(dir: string, head: string | undefined, path: string, recorded: string | null | undefined): string | null | undefined {
  if (head && git(dir, ["cat-file", "-e", `${head}^{commit}`]).ok) return blobId(dir, head, path);
  return recorded;
}

/** Fetch a PR's head commit when a deleted branch took it out of reach. */
function ensureCommit(dir: string, head: string | undefined): void {
  if (head && !git(dir, ["cat-file", "-e", `${head}^{commit}`]).ok) {
    git(dir, ["fetch", "--quiet", "origin", head], NETWORK_TIMEOUT_MS);
  }
}

// ---------------------------------------------------------------------------
// Proposing
// ---------------------------------------------------------------------------

/** Open a PR for a pending note, or push its local edits to the PR it has. */
function proposeNote(
  dir: string,
  remote: string,
  branch: string,
  slug: string,
  ledger: Ledger,
  state: PrState | undefined,
  message: string,
  done: string[],
  fall: (why: string) => void,
): void {
  const text = readFileSync(resolve(dir, "pending", `${slug}.md`), "utf8");
  const local = blobIdOf(dir, text);
  let entry = ledger.notes[slug];
  if (entry && state === undefined) {
    if (entry.blob !== local || !entry.url) fall(`couldn't check the PR for ${slug}; run \`mahler knowledge sync\` later`);
    return;
  }
  if (!entry) {
    // Name the branch once, so retries reuse it.
    entry = ledger.notes[slug] = { branch: `knowledge/${slug}-${randomBytes(2).toString("hex")}` };
    writeLedger(dir, ledger);
  }
  if (entry.blob !== local) {
    const path = `notes/${slug}.md`;
    const pushed = pushToBranch(dir, remote, entry, message.endsWith(slug) ? message : `knowledge: add ${slug}`, {
      has: (ref) => blobId(dir, ref, path) === local,
      fill: (worktree) => writeOrRemove(resolve(worktree, path), text),
    });
    if (pushed.foreign) {
      fall(`${entry.url ?? entry.branch} has commits from someone else, so Mahler leaves it alone; your newer edits to pending/${slug}.md wait until it merges or closes`);
      return;
    }
    if (pushed.error) {
      fall(`couldn't push ${slug} for review (${pushed.error}); run \`mahler knowledge sync\` later`);
      return;
    }
    Object.assign(entry, { head: pushed.head, blob: local });
    writeLedger(dir, ledger);
    if (entry.url) done.push(`updated ${entry.url} for ${slug}`);
  }
  if (entry.url) return;
  const note = parseNote(text, slug);
  const opened = openOrFindPr(dir, branch, entry.branch, `Knowledge: ${note.title}`, noteBody(note, slug));
  if (!opened.url) {
    fall(`couldn't open a PR for ${slug} (${opened.error}); run \`mahler knowledge sync\` later`);
    return;
  }
  entry.url = opened.url;
  writeLedger(dir, ledger);
  done.push(`opened ${opened.url} for ${slug}`);
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
 * the first edit, push new commits to it as edits change (undoing a file's
 * change there when its edit is undone here), and close it when every edit
 * is undone, so a file never sits in two competing PRs.
 */
function proposeEdits(
  dir: string,
  remote: string,
  branch: string,
  ledger: Ledger,
  state: PrState | undefined,
  done: string[],
  fall: (why: string) => void,
): void {
  const files: Record<string, string | null> = {};
  for (const path of changedPaths(dir)) files[path] = localBlobId(dir, path);
  const paths = Object.keys(files);
  let batch = ledger.batch;
  if (batch && state === undefined) {
    if (!sameFiles(batch.files, files) || !batch.url) {
      fall(`couldn't check ${batch.url ?? batch.branch}; your edits are proposed on a later sync`);
    }
    return;
  }
  const name = (proposal: Proposal) => proposal.url ?? proposal.branch;
  const foreign = (proposal: Proposal) =>
    fall(`${name(proposal)} has commits from someone else, so Mahler leaves it alone; your newer edits wait until it merges or closes`);
  if (batch && paths.length === 0) {
    // Every edit was undone: withdraw the PR.
    if (tip(dir, batch.branch) !== batch.head) {
      if (batch.head) return foreign(batch);
    } else if (batch.url) {
      const closed = gh(dir, ["pr", "close", batch.url, "--delete-branch", "--comment", "Mahler withdrew this PR: its edits were undone."]);
      if (!closed.ok) {
        fall(`couldn't close ${batch.url}, whose edits were undone (${firstLine(closed.stderr)}); close it on the forge`);
        return;
      }
    }
    delete ledger.batch;
    writeLedger(dir, ledger);
    done.push(`closed ${name(batch)}: its edits were undone`);
    return;
  }
  if (paths.length === 0) return;
  const title = paths.length === 1 ? `Knowledge: update ${paths[0]}` : `Knowledge: update ${paths.length} files`;
  const body = [
    "Edits to the knowledge store (verified dates, corrections, merges, or retirements):",
    "",
    ...paths.map((path) => `- \`${path}\`${files[path] === null ? " (removed)" : ""}`),
    "",
    "Proposed by Mahler, which updates this PR as the edits change. Merge to publish them to every clone of this store; close the PR to drop them.",
  ].join("\n");
  const changed = !batch || !sameFiles(batch.files, files);
  if (!batch) {
    batch = ledger.batch = { branch: `knowledge/update-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`, files: {} };
    writeLedger(dir, ledger);
  }
  if (changed) {
    const undone = Object.keys(batch.files).filter((path) => !(path in files));
    const pushed = pushToBranch(dir, remote, batch, title.replace(/^Knowledge: /, "knowledge: "), {
      has: (ref, base) =>
        paths.every((path) => blobId(dir, ref, path) === files[path]) &&
        undone.every((path) => blobId(dir, ref, path) === blobId(dir, base, path)),
      fill: (worktree, base) => {
        for (const path of paths) writeOrRemove(resolve(worktree, path), files[path] === null ? null : readFileSync(resolve(dir, path), "utf8"));
        for (const path of undone) writeOrRemove(resolve(worktree, path), blobId(dir, base, path) === null ? null : gitText(dir, ["show", `${base}:${path}`]) ?? "");
      },
    });
    if (pushed.foreign) return foreign(batch);
    if (pushed.error) {
      fall(`couldn't push your edits for review (${pushed.error}); run \`mahler knowledge sync\` later`);
      return;
    }
    Object.assign(batch, { head: pushed.head, files });
    writeLedger(dir, ledger);
    if (batch.url) {
      const edit = gh(dir, ["pr", "edit", batch.url, "--title", title, "--body", body]);
      done.push(`updated ${batch.url} with ${paths.length} ${paths.length === 1 ? "edit" : "edits"}`);
      if (!edit.ok) fall(`couldn't update the description of ${batch.url} (${firstLine(edit.stderr)})`);
      return;
    }
  }
  if (batch.url) return;
  const opened = openOrFindPr(dir, branch, batch.branch, title, body);
  if (!opened.url) {
    fall(`couldn't open a PR for your edits (${opened.error}); run \`mahler knowledge sync\` later`);
    return;
  }
  batch.url = opened.url;
  writeLedger(dir, ledger);
  done.push(`proposed ${paths.length} ${paths.length === 1 ? "edit" : "edits"} in ${opened.url}`);
}

function sameFiles(a: Record<string, string | null>, b: Record<string, string | null>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => key in b && a[key] === b[key]);
}

/** The remote-tracking tip of a PR branch, as of the last fetch. */
function tip(dir: string, head: string): string | undefined {
  const result = git(dir, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${head}`]);
  return result.ok ? result.stdout : undefined;
}

/**
 * Commit a change to a proposal's branch in a temporary worktree, on top of
 * the branch (or the remote branch, for a new one), and push it without
 * force. `has` says whether a commit already holds the change (a push whose
 * reply was lost); `base` is where the branch left the remote branch. A
 * branch whose tip isn't Mahler's last push has someone else's commits, and
 * is left alone. The clone's own checkout and working tree are untouched.
 */
function pushToBranch(
  dir: string,
  remote: string,
  proposal: Proposal,
  message: string,
  change: { has: (ref: string, base: string) => boolean; fill: (worktree: string, base: string) => void },
): { head?: string; foreign?: boolean; error?: string } {
  const current = tip(dir, proposal.branch);
  if (current === undefined && proposal.head) return { error: `its branch ${proposal.branch} is gone from the remote` };
  const base = current === undefined ? remote : git(dir, ["merge-base", remote, current]).stdout || remote;
  if (current !== undefined && change.has(current, base)) return { head: current };
  if (current !== undefined && current !== proposal.head) return { foreign: true };
  const scratch = mkdtempSync(resolve(tmpdir(), "mahler-knowledge-pr-"));
  const worktree = resolve(scratch, "tree");
  try {
    gitOrThrow(dir, ["worktree", "add", "--quiet", "--detach", worktree, current ?? remote]);
    change.fill(worktree, base);
    gitOrThrow(worktree, ["add", "--all"]);
    if (git(worktree, ["diff", "--cached", "--quiet"]).ok) return { head: current ?? undefined, error: current ? undefined : "nothing to propose" };
    gitOrThrow(worktree, ["commit", "--quiet", "-m", message]);
    const head = gitOrThrow(worktree, ["rev-parse", "HEAD"]);
    const push = git(worktree, ["push", "--quiet", "origin", `HEAD:refs/heads/${proposal.branch}`], NETWORK_TIMEOUT_MS);
    if (!push.ok) return { error: firstLine(push.stderr) };
    git(dir, ["update-ref", `refs/remotes/origin/${proposal.branch}`, head]);
    return { head };
  } finally {
    git(dir, ["worktree", "remove", "--force", worktree]);
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Open a PR from `head`, unless one is open already: an earlier `gh pr create`
 * may have succeeded without Mahler hearing back.
 */
function openOrFindPr(dir: string, branch: string, head: string, title: string, body: string): { url?: string; error?: string } {
  const existing = findPr(dir, { branch: head });
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
 * Direct publish after PR publish, before its commit: settle what PR publish
 * left behind. A pending note whose PR is open (or never opened) moves into
 * `notes/`, to be pushed like any other change; one whose PR closed is
 * dropped, unless it changed since; one whose PR merged arrives with the pull.
 * A batch's edits are published directly, unless its PR merged or closed.
 * Notes the forge can't settle wait in `pending/`. Returns what happened,
 * for the sync summary.
 */
export function leavePrMode(dir: string, branch: string): string[] {
  const ledger = readLedger(dir);
  const files = pendingNotes(dir);
  if (files.length === 0 && !ledger.batch && Object.keys(ledger.notes).length === 0) return [];
  const done: string[] = [];
  const remote = `refs/remotes/origin/${branch}`;
  git(dir, ["fetch", "--quiet", "--prune", "origin"], NETWORK_TIMEOUT_MS);
  const withdraw: string[] = [];
  if (ledger.batch) {
    const batch = ledger.batch;
    const { state } = settleBatch(dir, remote, true, ledger, false, done);
    if (state !== "MERGED" && state !== "CLOSED" && batch.url) withdraw.push(batch.url);
    delete ledger.batch;
  }
  let moved = 0;
  for (const file of files) {
    const slug = basename(file, ".md");
    const entry = ledger.notes[slug];
    const path = `notes/${slug}.md`;
    const info: PrInfo | undefined = !entry
      ? { state: "NONE" }
      : entry.merged
        ? { state: "MERGED", head: entry.head }
        : noteState(dir, remote, true, entry, path);
    if (!info) {
      done.push(`left pending/${slug}.md: couldn't check its PR, ${entry!.url ?? entry!.branch}`);
      continue;
    }
    const text = readFileSync(file, "utf8");
    const changed = () => {
      ensureCommit(dir, info.head);
      return blobIdOf(dir, text) !== proposedBlob(dir, info.head, path, entry?.blob);
    };
    if (info.state === "MERGED" && changed()) {
      done.push(`left pending/${slug}.md: it changed after its PR merged; fold your changes into ${path} by hand and delete it`);
      continue;
    }
    if (info.state === "MERGED" || (info.state === "CLOSED" && !changed())) {
      rmSync(file);
      delete ledger.notes[slug];
      continue;
    }
    if (existsSync(resolve(dir, path))) {
      done.push(`left pending/${slug}.md alone: ${path} already exists; merge them by hand`);
      continue;
    }
    mkdirSync(dirname(resolve(dir, path)), { recursive: true });
    writeFileSync(resolve(dir, path), text);
    rmSync(file);
    if (info.state === "OPEN" && entry?.url) withdraw.push(entry.url);
    delete ledger.notes[slug];
    moved += 1;
  }
  writeLedger(dir, ledger);
  if (moved > 0) done.push(`moved ${moved} pending ${moved === 1 ? "note" : "notes"} into notes/`);
  if (withdraw.length > 0) done.push(`close ${withdraw.join(", ")} on the forge: this sync publishes ${withdraw.length === 1 ? "its" : "their"} changes directly`);
  return done;
}

// ---------------------------------------------------------------------------
// Status, for doctor
// ---------------------------------------------------------------------------

export interface ProposalStatus {
  /** Pending notes, and edits in the open batch, awaiting review. */
  notes: number;
  batch?: { files: number; url?: string };
  /** Changes not in a PR yet, or changed since their PR's last push. */
  unproposed: number;
  /** Pending notes that changed after their PR merged and need a hand merge. */
  conflicted: string[];
}

export function proposalStatus(dir: string): ProposalStatus {
  const ledger = readLedger(dir);
  const files = pendingNotes(dir);
  let unproposed = 0;
  const conflicted: string[] = [];
  for (const file of files) {
    const slug = basename(file, ".md");
    const entry = ledger.notes[slug];
    if (entry?.merged) conflicted.push(slug);
    else if (!entry?.url || entry.blob !== blobIdOf(dir, readFileSync(file, "utf8"))) unproposed += 1;
  }
  const edits: Record<string, string | null> = {};
  for (const path of changedPaths(dir)) edits[path] = localBlobId(dir, path);
  const proposed = ledger.batch?.url ? ledger.batch.files : {};
  for (const path of new Set([...Object.keys(edits), ...Object.keys(proposed)])) {
    if (!(path in edits) || !(path in proposed) || edits[path] !== proposed[path]) unproposed += 1;
  }
  return {
    notes: files.length,
    batch: ledger.batch ? { files: Object.keys(ledger.batch.files).length, url: ledger.batch.url } : undefined,
    unproposed,
    conflicted,
  };
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

function readLedger(dir: string): Ledger {
  try {
    const parsed = JSON.parse(readFileSync(resolve(dir, "pending", LEDGER), "utf8")) as Partial<Ledger>;
    return { notes: parsed.notes ?? {}, batch: parsed.batch };
  } catch {
    return { notes: {} };
  }
}

function writeLedger(dir: string, ledger: Ledger): void {
  const file = resolve(dir, "pending", LEDGER);
  if (!ledger.batch && Object.keys(ledger.notes).length === 0) {
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

function readBlob(dir: string, id: string): string | undefined {
  return gitText(dir, ["cat-file", "blob", id]);
}

/** A three-way merge of file contents; undefined when they conflict. */
function merge3(dir: string, ours: string, base: string, theirs: string): string | undefined {
  const scratch = mkdtempSync(resolve(tmpdir(), "mahler-knowledge-merge-"));
  try {
    const [o, b, t] = (["ours", "base", "theirs"] as const).map((name, index) => {
      const file = resolve(scratch, name);
      writeFileSync(file, [ours, base, theirs][index]);
      return file;
    });
    return gitText(dir, ["merge-file", "-p", "-q", o, b, t]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function writeOrRemove(file: string, text: string | null): void {
  if (text === null) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** Put a file back to the clone's committed version (or remove a new one). */
function restore(dir: string, path: string): void {
  if (blobId(dir, "HEAD", path) !== null) gitOrThrow(dir, ["checkout", "--quiet", "HEAD", "--", path]);
  else rmSync(resolve(dir, path), { force: true });
}

function count(dir: string, range: string): number {
  return Number(git(dir, ["rev-list", "--count", range]).stdout || 0);
}

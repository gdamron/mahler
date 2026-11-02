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
  /** A commit Mahler was pushing when it last heard nothing back. */
  pushing?: string;
}

interface NoteProposal extends Proposal {
  /** The note's git blob id as last pushed. */
  blob?: string;
  /** Merged, but edited here since in a way that conflicts with the merged note. */
  merged?: boolean;
  /** The PR's head commit as merged, once it has. */
  mergedHead?: string;
}

interface BatchProposal extends Proposal {
  /** Each path's git blob id as last pushed, or null for a deletion. */
  files: Record<string, string | null>;
}

export interface Ledger {
  notes: Record<string, NoteProposal>;
  batch?: BatchProposal;
  /** Edits set aside for a pull, to put back once it's done; kept here so a crash can't lose them. */
  settling?: Carry[];
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
  const ledger = readLedger(dir);
  pruneLedger(dir, ledger, done);
  // Ask the forge before fetching, so a PR it calls merged is in the fetch.
  const answers = quick ? new Map<string, PrInfo | undefined>() : askForge(dir, ledger);
  const ask = (proposal: Proposal) => answers.get(proposal.branch);
  const fetch = git(dir, ["fetch", "--quiet", "--prune", "origin"], NETWORK_TIMEOUT_MS);
  if (!fetch.ok) {
    return {
      done: [...done, `couldn't reach ${repo} (${firstLine(fetch.stderr)}); run \`mahler knowledge sync\` later to propose your changes`],
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

  resumeSettling(dir, ledger, done);
  const batch = settleBatch(dir, remote, ledger, ask, true, done);
  const pulled = pull(dir, remote, branch, ledger, done, fall);
  const settled = applySettling(dir, ledger, pulled, fall);
  const notes = settlePendingNotes(dir, remote, ask, pulled, ledger, done, fall);
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
  if (!pulled || !settled) return { done, published };
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
 * once the pull that brings it has succeeded, with any edit made after the
 * push that merged folded into the merged note; a closed one is dropped
 * unless it changed since its last push, when it's proposed afresh. Returns each still-pending note's
 * PR state (absent when the forge couldn't say), and the merged notes that
 * wait on a pull or a hand merge, which must not be proposed again.
 */
function settlePendingNotes(
  dir: string,
  remote: string,
  ask: (proposal: Proposal) => PrInfo | undefined,
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
    const info: PrInfo | undefined = entry.merged ? { state: "MERGED", head: entry.mergedHead } : noteState(dir, remote, ask, entry, path);
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
    const text = readFileSync(file, "utf8");
    if (info.state === "CLOSED") {
      delete ledger.notes[slug];
      if (blobIdOf(dir, text) === entry.blob) {
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
    // An edit made after the last push that merged is folded into the note as
    // merged (keeping any reviewer's changes), to go up with the other edits.
    const base = baseBlob(dir, info.head, entry.head, path, entry.blob);
    const baseText = base ? readBlob(dir, base) : undefined;
    const theirs = existsSync(resolve(dir, path)) ? readFileSync(resolve(dir, path), "utf8") : undefined;
    const unchanged = text === baseText || text === theirs;
    const folded = unchanged || theirs === undefined || baseText === undefined ? undefined : merge3(dir, text, baseText, theirs);
    if (!unchanged && folded === undefined) {
      Object.assign(entry, { merged: true, mergedHead: info.head });
      waiting.add(slug);
      fall(`pending/${slug}.md changed after ${name} merged, in ways that conflict with the merged ${path}; fold your changes into it by hand and delete pending/${slug}.md`);
      continue;
    }
    if (folded !== undefined && folded !== theirs) {
      writeFileSync(resolve(dir, path), folded);
      done.push(`kept your later edits to ${slug}`);
    }
    rmSync(file);
    delete ledger.notes[slug];
    merged += 1;
  }
  writeLedger(dir, ledger);
  if (merged > 0) done.push(`${merged} pending ${merged === 1 ? "note" : "notes"} merged`);
  return { states, waiting };
}

/** The note's PR state: merged when the remote holds the note exactly as last pushed, else what the forge says. */
function noteState(
  dir: string,
  remote: string,
  ask: (proposal: Proposal) => PrInfo | undefined,
  entry: NoteProposal,
  path: string,
): PrInfo | undefined {
  if (entry.head && entry.blob && blobId(dir, remote, path) === entry.blob) return { state: "MERGED", head: entry.head };
  return ask(entry);
}

interface Carry {
  path: string;
  /** The file as it was, put back if the pull fails; null when deleted. */
  local: string | null;
  /** The file to write once the pull succeeds. */
  text: string | null;
  /** The remote's blob id that `text` was folded onto; null when the remote had no such file. */
  onto: string | null;
}

/**
 * Settle the open batch when its PR has merged (perhaps with a reviewer's
 * edits) or closed: put each file it proposed back to the clone's version, so
 * the pull can fast-forward over it. A file edited again since keeps the
 * edit. For a merged batch, `carry` folds that edit into the merged version
 * and sets it aside in the ledger to write after the pull; without it, or
 * when the edit conflicts, the file is left as it is. Returns the batch's PR
 * state, absent when the forge couldn't say.
 */
function settleBatch(
  dir: string,
  remote: string,
  ledger: Ledger,
  ask: (proposal: Proposal) => PrInfo | undefined,
  carry: boolean,
  done: string[],
): { state?: PrState } {
  const { batch } = ledger;
  if (!batch) return { state: "NONE" };
  const entries = Object.entries(batch.files);
  const info: PrInfo | undefined =
    batch.head && entries.length > 0 && entries.every(([path, id]) => blobId(dir, remote, path) === id)
      ? { state: "MERGED", head: batch.head }
      : ask(batch);
  if (!info) return {};
  if (info.state === "OPEN" || info.state === "NONE") {
    if (info.url && !batch.url) {
      batch.url = info.url;
      writeLedger(dir, ledger);
      done.push(`found ${info.url} for your edits`);
    }
    return { state: info.state };
  }
  ensureCommit(dir, info.head);
  // Decide everything first, and record the edits to carry over, so nothing
  // is lost if the restores below are interrupted.
  const restores: string[] = [];
  const carries: Carry[] = [];
  let kept = 0;
  for (const [path, recorded] of entries) {
    const local = localBlobId(dir, path);
    const base = info.state === "MERGED" ? baseBlob(dir, info.head, batch.head, path, recorded) : recorded;
    const theirs = blobId(dir, remote, path);
    if (local === base || local === theirs) {
      restores.push(path);
      continue;
    }
    const localText = local === null ? null : readFileSync(resolve(dir, path), "utf8");
    let text: string | null | undefined;
    if (info.state === "MERGED" && carry) {
      if (theirs === base) {
        text = localText;
      } else if (localText !== null && base && theirs) {
        text = merge3(dir, localText, readBlob(dir, base) ?? "", readBlob(dir, theirs) ?? "");
      }
    }
    if (text !== undefined && text === (theirs === null ? null : readBlob(dir, theirs))) {
      restores.push(path);
      continue;
    }
    kept += 1;
    if (text !== undefined) carries.push({ path, local: localText, text, onto: theirs });
  }
  // Files with nothing to keep go first: if one fails, the batch is still
  // recorded and the next sync settles it again.
  for (const path of restores) restore(dir, path);
  ledger.settling = [...(ledger.settling ?? []), ...carries];
  delete ledger.batch;
  writeLedger(dir, ledger);
  for (const carry of carries) restore(dir, carry.path);
  const name = batch.url ?? batch.branch;
  const later = kept > 0 ? `, keeping your later edits to ${kept} ${kept === 1 ? "file" : "files"}` : "";
  done.push(info.state === "MERGED" ? `${name} merged${later}` : `dropped the edits in ${name} (closed unmerged)${later}`);
  return { state: info.state };
}

/**
 * Fast-forward to the remote branch. Local edits in the way are folded into
 * the incoming changes (three-way, against HEAD) and put back after; only
 * edits that conflict block the pull.
 */
function pull(dir: string, remote: string, branch: string, ledger: Ledger, done: string[], fall: (why: string) => void): boolean {
  const behind = count(dir, `HEAD..${remote}`);
  if (behind === 0) return true;
  let merge = git(dir, ["merge", "--ff-only", "--quiet", remote]);
  let blocking = merge.ok ? [] : overwrittenPaths(merge.stderr);
  if (!merge.ok && blocking.length > 0) {
    const folds: Carry[] = [];
    const conflicts: string[] = [];
    for (const path of blocking) {
      const local = existsSync(resolve(dir, path)) ? readFileSync(resolve(dir, path), "utf8") : null;
      const head = blobId(dir, "HEAD", path);
      const theirs = blobId(dir, remote, path);
      const text = local === null || theirs === null ? undefined : merge3(dir, local, head ? readBlob(dir, head) ?? "" : "", readBlob(dir, theirs) ?? "");
      if (text === undefined) conflicts.push(path);
      else folds.push({ path, local, text, onto: theirs });
    }
    if (conflicts.length === 0) {
      ledger.settling = [...(ledger.settling ?? []), ...folds];
      writeLedger(dir, ledger);
      for (const fold of folds) restore(dir, fold.path);
      merge = git(dir, ["merge", "--ff-only", "--quiet", remote]);
      if (merge.ok) done.push(`folded your edits to ${folds.map((fold) => fold.path).join(", ")} into the pulled changes`);
      else blocking = overwrittenPaths(merge.stderr);
    } else {
      blocking = conflicts;
    }
  }
  if (merge.ok) {
    done.push(`pulled ${behind} ${behind === 1 ? "commit" : "commits"}`);
    return true;
  }
  fall(
    `couldn't pull: your edits to ${blocking.join(", ") || "some notes"} conflict with changes on ${branch}. In ${dir}, fold them into the remote's version by hand, then sync again; until then your edits aren't proposed`,
  );
  return false;
}

/** Put back edits set aside for the pull: folded after a successful one, as they were after a failed one. */
function applySettling(dir: string, ledger: Ledger, pulled: boolean, fall: (why: string) => void): boolean {
  if (!ledger.settling || ledger.settling.length === 0) return true;
  let clean = true;
  for (const carry of ledger.settling) {
    let text: string | null | undefined = pulled ? carry.text : carry.local;
    const head = blobId(dir, "HEAD", carry.path);
    // Folded onto an older remote (an interrupted sync): fold again onto this one.
    if (pulled && head !== carry.onto) {
      const ontoText = carry.onto === null ? "" : readBlob(dir, carry.onto);
      const headText = head === null ? undefined : readBlob(dir, head);
      text =
        carry.text === null || ontoText === undefined || headText === undefined
          ? undefined
          : merge3(dir, carry.text, ontoText, headText) ?? undefined;
      if (text === undefined) {
        clean = false;
        text = carry.local;
        fall(`your edits to ${carry.path} conflict with newer changes on the remote; fold them in by hand in ${dir}, then sync again`);
      }
    }
    writeOrRemove(resolve(dir, carry.path), text ?? null);
  }
  delete ledger.settling;
  writeLedger(dir, ledger);
  return clean;
}

/**
 * Pick up edits an interrupted sync set aside: restore the files it hadn't
 * yet, so this sync's pull puts them back. A file edited since is left as
 * it is, and the earlier edits are saved under `pending/recovered/`.
 */
function resumeSettling(dir: string, ledger: Ledger, done: string[]): void {
  if (!ledger.settling || ledger.settling.length === 0) return;
  ledger.settling = ledger.settling.filter((carry) => {
    const now = existsSync(resolve(dir, carry.path)) ? readFileSync(resolve(dir, carry.path), "utf8") : null;
    if (now === carry.text) return false;
    if (now === carry.local) {
      restore(dir, carry.path);
      return true;
    }
    if (localBlobId(dir, carry.path) === blobId(dir, "HEAD", carry.path)) return true;
    // Edited again since: keep the earlier edits beside it rather than choose.
    const saved = `pending/recovered/${carry.path}`;
    if (carry.local !== null) writeOrRemove(resolve(dir, saved), carry.local);
    done.push(
      carry.local === null
        ? `left ${carry.path} as you edited it (an interrupted sync had set aside its deletion)`
        : `left ${carry.path} as you edited it; your earlier edits to it, set aside by an interrupted sync, are in ${saved}`,
    );
    return false;
  });
  if (ledger.settling.length === 0) delete ledger.settling;
  writeLedger(dir, ledger);
}

/** Ask the forge about every recorded PR, once per sync. */
function askForge(dir: string, ledger: Ledger): Map<string, PrInfo | undefined> {
  const answers = new Map<string, PrInfo | undefined>();
  const proposals: Proposal[] = [
    ...(ledger.batch ? [ledger.batch] : []),
    ...Object.values(ledger.notes).filter((entry) => !entry.merged),
  ];
  for (const proposal of proposals) answers.set(proposal.branch, findPr(dir, proposal));
  return answers;
}

/** Forget PRs whose pending note is gone (deleted by hand, or dropped by an interrupted sync). */
function pruneLedger(dir: string, ledger: Ledger, done: string[]): void {
  const present = new Set(pendingNotes(dir).map((file) => basename(file, ".md")));
  const gone = Object.keys(ledger.notes).filter((slug) => !present.has(slug));
  if (gone.length === 0) return;
  for (const slug of gone) {
    const { url, merged } = ledger.notes[slug];
    delete ledger.notes[slug];
    if (url && !merged) done.push(`forgot the PR for ${slug}, since pending/${slug}.md is gone; close ${url} if it's still open`);
  }
  writeLedger(dir, ledger);
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
 * A file's blob id where a later local edit started from: where Mahler's
 * last push and the PR's merged head meet. That's Mahler's push when a
 * reviewer's commits followed it, and the merged head when Mahler pushed
 * again after the merge. Falls back to what Mahler recorded pushing.
 */
function baseBlob(
  dir: string,
  merged: string | undefined,
  ours: string | undefined,
  path: string,
  recorded: string | null | undefined,
): string | null | undefined {
  const meet = merged && ours ? git(dir, ["merge-base", merged, ours]) : undefined;
  return meet?.ok && meet.stdout ? blobId(dir, meet.stdout, path) : recorded;
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
  if (entry.blob !== local || lostBranch(dir, entry)) {
    const path = `notes/${slug}.md`;
    const pushed = pushToBranch(dir, remote, entry, message.endsWith(slug) ? message : `knowledge: add ${slug}`, {
      has: (ref) => blobId(dir, ref, path) === local,
      fill: (worktree) => writeOrRemove(resolve(worktree, path), text),
    }, () => writeLedger(dir, ledger));
    if (pushed.foreign) {
      fall(`${entry.url ?? entry.branch} has commits from someone else, so Mahler leaves it alone; your newer edits to pending/${slug}.md wait until it merges or closes`);
      return;
    }
    if (pushed.error) {
      fall(`couldn't push ${slug} for review (${pushed.error}); run \`mahler knowledge sync\` later`);
      return;
    }
    Object.assign(entry, { head: pushed.head, blob: local, pushing: undefined });
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
    const current = tip(dir, batch.branch);
    if (current !== batch.head && current !== batch.pushing) {
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
  const changed = !batch || !sameFiles(batch.files, files) || lostBranch(dir, batch);
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
    }, () => writeLedger(dir, ledger));
    if (pushed.foreign) return foreign(batch);
    if (pushed.error) {
      fall(`couldn't push your edits for review (${pushed.error}); run \`mahler knowledge sync\` later`);
      return;
    }
    Object.assign(batch, { head: pushed.head, files, pushing: undefined });
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

/** A branch pushed but gone from the remote before its PR opened. */
function lostBranch(dir: string, proposal: Proposal): boolean {
  return !proposal.url && proposal.head !== undefined && tip(dir, proposal.branch) === undefined;
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
 * branch whose tip isn't Mahler's last push (or the one it last tried) has
 * someone else's commits, and is left alone. The caller records the new
 * head and clears `pushing`. The clone's own checkout and working tree are untouched.
 */
function pushToBranch(
  dir: string,
  remote: string,
  proposal: Proposal,
  message: string,
  change: { has: (ref: string, base: string) => boolean; fill: (worktree: string, base: string) => void },
  save: () => void,
): { head?: string; foreign?: boolean; error?: string } {
  const current = tip(dir, proposal.branch);
  // A branch gone before its PR opened is simply pushed again.
  if (current === undefined && proposal.head && proposal.url) return { error: `its branch ${proposal.branch} is gone from the remote` };
  const base = current === undefined ? remote : git(dir, ["merge-base", remote, current]).stdout || remote;
  if (current !== undefined && change.has(current, base)) return { head: current };
  if (current !== undefined && current !== proposal.head && current !== proposal.pushing) return { foreign: true };
  const scratch = mkdtempSync(resolve(tmpdir(), "mahler-knowledge-pr-"));
  const worktree = resolve(scratch, "tree");
  try {
    gitOrThrow(dir, ["worktree", "add", "--quiet", "--detach", worktree, current ?? remote]);
    change.fill(worktree, base);
    gitOrThrow(worktree, ["add", "--all"]);
    if (git(worktree, ["diff", "--cached", "--quiet"]).ok) return { head: current ?? undefined, error: current ? undefined : "nothing to propose" };
    gitOrThrow(worktree, ["commit", "--quiet", "-m", message]);
    const head = gitOrThrow(worktree, ["rev-parse", "HEAD"]);
    // Recorded first: a push that lands without Mahler hearing back is still its own.
    proposal.pushing = head;
    save();
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
 * A batch's edits are published directly, unless its PR merged or closed;
 * when the forge can't say which, nothing is published (`blocked`). Notes
 * the forge can't settle wait in `pending/`. Returns what happened, for the
 * sync summary.
 */
export function leavePrMode(dir: string, branch: string): { done: string[]; blocked?: string } {
  const ledger = readLedger(dir);
  const done: string[] = [];
  pruneLedger(dir, ledger, done);
  const files = pendingNotes(dir);
  if (files.length === 0 && !ledger.batch && Object.keys(ledger.notes).length === 0 && !ledger.settling?.length) return { done };
  if (ledger.settling?.length) {
    return {
      done,
      blocked: `an interrupted PR-publish sync left edits to put back (${ledger.settling.map((carry) => carry.path).join(", ")}); set knowledge.publish to "pr" and sync once before publishing directly`,
    };
  }
  const answers = askForge(dir, ledger);
  const ask = (proposal: Proposal) => answers.get(proposal.branch);
  const remote = `refs/remotes/origin/${branch}`;
  git(dir, ["fetch", "--quiet", "--prune", "origin"], NETWORK_TIMEOUT_MS);
  const withdraw: string[] = [];
  if (ledger.batch) {
    const batch = ledger.batch;
    const { state } = settleBatch(dir, remote, ledger, ask, false, done);
    if (state === undefined) {
      // It may have closed: don't publish edits a reviewer turned down.
      return {
        done,
        blocked: `couldn't check ${batch.url ?? batch.branch}, the PR holding your edits, so nothing was published. Make sure \`gh\` works (\`gh auth status\`) and sync again, or set knowledge.publish back to "pr"`,
      };
    } else {
      if (state === "OPEN" && batch.url) withdraw.push(batch.url);
      delete ledger.batch;
    }
  }
  let moved = 0;
  for (const file of files) {
    const slug = basename(file, ".md");
    const entry = ledger.notes[slug];
    const path = `notes/${slug}.md`;
    const info: PrInfo | undefined = !entry
      ? { state: "NONE" }
      : entry.merged
        ? { state: "MERGED", head: entry.mergedHead }
        : noteState(dir, remote, ask, entry, path);
    if (!info) {
      done.push(`left pending/${slug}.md: couldn't check its PR, ${entry!.url ?? entry!.branch}`);
      continue;
    }
    const text = readFileSync(file, "utf8");
    const changed = () => {
      const local = blobIdOf(dir, text);
      if (info.state === "CLOSED") return local !== entry?.blob;
      ensureCommit(dir, info.head);
      return local !== baseBlob(dir, info.head, entry?.head, path, entry?.blob) && local !== blobId(dir, remote, path);
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
  return { done };
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
    return { notes: parsed.notes ?? {}, batch: parsed.batch, settling: parsed.settling };
  } catch {
    return { notes: {} };
  }
}

function writeLedger(dir: string, ledger: Ledger): void {
  const file = resolve(dir, "pending", LEDGER);
  if (!ledger.batch && Object.keys(ledger.notes).length === 0 && !ledger.settling?.length) {
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
function overwrittenPaths(stderr: string): string[] {
  return stderr
    .split("\n")
    .filter((line) => /^\s+\S/.test(line) && !/^\s*(Please|Aborting)/.test(line))
    .map((line) => line.trim());
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

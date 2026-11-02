import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import {
  type Flags,
  listFlag,
  required,
  stringFlag,
  UsageError,
  workspaceFlag,
} from "../args.js";
import { loadConfig } from "../config.js";
import {
  decisionsDir,
  formatNote,
  indexLine,
  knowledgeDir,
  type KnowledgeNote,
  type NewNote,
  notesForFiles,
  readLedgerNote,
  readNotes,
  searchNotes,
  setFrontmatterField,
  splitGlobs,
  writeIndexes,
} from "../knowledge.js";
import { repoForDir } from "../repos.js";
import type { HarnessConfig } from "../types.js";
import { slugify } from "../util.js";
import { changedFiles } from "./check.js";

const today = () => new Date().toISOString().slice(0, 10);

/** `mahler learn`: record one fact as a knowledge note. */
export function learn(flags: Flags): void {
  const workspace = workspaceFlag(flags);
  const config = loadConfig(workspace);
  const title = oneLine(required(stringFlag(flags, "title"), "--title is required: the fact itself, as a claim"));
  const description = oneLine(
    required(
      stringFlag(flags, "description"),
      "--description is required: one or two sentences an agent can act on from the index alone",
    ),
  );
  const file = recordNote(workspace, config, {
    ...scope(config, flags),
    slug: slugify(stringFlag(flags, "slug") ?? title),
    title,
    description,
    sources: listFlag(flags, "source"),
    body: noteBody(flags),
    date: today(),
  });
  console.log(`Recorded knowledge: ${file}`);
}

/**
 * `mahler knowledge import <ledger-note>`: turn a decisions ledger note into
 * a knowledge note. The rule becomes the slug, the issue the source, and the
 * body is copied. Title and description default to the rule and the ledger
 * summary; the agent rewrites them as a claim, unless it passed them.
 */
function importLedgerNote(workspace: string, config: HarnessConfig, target: string, flags: Flags): void {
  const ledger = decisionsDir(workspace);
  const source = [resolve(target), resolve(ledger, target), resolve(ledger, `${target}.md`)].find(
    (candidate) => existsSync(candidate) && !candidate.endsWith("INDEX.md") && !candidate.endsWith("README.md"),
  );
  if (!source) throw new Error(`No ledger note "${target}" (give its path, or its file name in ${ledger})`);
  const entry = readLedgerNote(source);
  const title = stringFlag(flags, "title");
  const description = stringFlag(flags, "description");
  const issue = entry.issue && entry.issue !== "unassigned" ? [entry.issue] : [];
  const file = recordNote(workspace, config, {
    ...scope(config, flags),
    slug: slugify(stringFlag(flags, "slug") ?? entry.rule),
    title: oneLine(title ?? entry.rule),
    description: oneLine(description ?? entry.summary),
    sources: [...new Set([...issue, ...listFlag(flags, "source")])],
    body: `${entry.body}\n\nImported from the decisions ledger (\`${basename(source)}\`).`,
    date: today(),
    created: entry.date || undefined,
    verified: entry.date || undefined,
  });
  console.log(`Imported ${basename(source)} as knowledge: ${file}`);
  if (flags.archive === true) {
    const archived = resolve(ledger, "archive", basename(source));
    if (existsSync(archived)) throw new Error(`Not archived: ${archived} already exists`);
    mkdirSync(dirname(archived), { recursive: true });
    const slug = basename(file, ".md");
    writeFileSync(archived, setFrontmatterField(readFileSync(source, "utf8"), "imported-to", slug));
    rmSync(source);
    writeIndexes(workspace, config);
    console.log(`Archived the ledger note: ${archived}`);
  }
  if (!title || !description) {
    console.log(
      "Now rewrite the note for readers outside the issue: a title that states the fact as a claim, and a description that carries it (see .harness/policies/knowledge.md).",
    );
  }
}

/** Tags, repos, and paths from flags, with repos checked against the config. */
function scope(config: HarnessConfig, flags: Flags): Pick<NewNote, "tags" | "repos" | "paths"> {
  const repos = listFlag(flags, "repos");
  const known = config.repos.map((repo) => repo.name);
  const unknown = repos.filter((repo) => !known.includes(repo));
  if (unknown.length > 0) {
    throw new UsageError(
      `Unknown repo ${unknown.map((repo) => `"${repo}"`).join(", ")}. Configured repos: ${known.join(", ") || "(none)"}`,
    );
  }
  return {
    tags: listFlag(flags, "tags").map(slugify).filter(Boolean),
    repos,
    paths: splitGlobs(stringFlag(flags, "paths") ?? ""),
  };
}

/**
 * Write a new note, refusing a slug already in use, rebuild the indexes, and
 * point at similar notes. Returns the note's file.
 */
function recordNote(workspace: string, config: HarnessConfig, note: NewNote): string {
  const { slug } = note;
  if (!slug) throw new UsageError("the title (or --slug) has no usable characters for a slug");
  const dir = knowledgeDir(workspace, config);
  for (const folder of ["notes", "pending", "archive"]) {
    const existing = resolve(dir, folder, `${slug}.md`);
    if (existsSync(existing)) slugTaken(dir, slug, existing, folder === "archive");
  }
  const others = readNotes(dir);
  const file = resolve(dir, "notes", `${slug}.md`);
  mkdirSync(resolve(dir, "notes"), { recursive: true });
  try {
    // "wx" fails if another session wrote the same slug since the check above.
    writeFileSync(file, formatNote(note), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") slugTaken(dir, slug, file, false);
    throw error;
  }
  writeIndexes(workspace, config);
  const similar = searchNotes(others, [note.title, note.description], undefined, 6).slice(0, 3);
  if (similar.length > 0) {
    console.log("Similar notes (merge into one of these if they cover the same fact):");
    for (const other of similar) console.log(indexLine(other, undefined, true));
  }
  return file;
}

function slugTaken(dir: string, slug: string, existing: string, retired: boolean): never {
  const note = readNotes(dir).find((candidate) => candidate.file === existing);
  throw new Error(
    [
      `A note already uses the slug "${slug}": ${existing}`,
      note ? `  ${note.description}` : "",
      retired
        ? "It is retired. Pass --slug for a new note, and link the old one if it helps."
        : "If it covers the same fact, update that note instead (set `updated:` to today). Otherwise pass --slug.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

/** `mahler knowledge index|search|verify|import`. */
export function knowledge(action: string, args: string[], flags: Flags): void {
  const workspace = workspaceFlag(flags);
  const config = loadConfig(workspace);
  switch (action) {
    case "index": {
      const counts = writeIndexes(workspace, config);
      console.log(
        `Indexed ${counts.notes} knowledge ${counts.notes === 1 ? "note" : "notes"} and ${counts.decisions} ledger ${counts.decisions === 1 ? "note" : "notes"}.`,
      );
      return;
    }
    case "search":
      search(workspace, config, args, flags);
      return;
    case "verify":
      verify(workspace, config, required(args[0], "the note's slug is required"));
      return;
    case "import":
      importLedgerNote(workspace, config, required(args[0], "the ledger note's path or file name is required"), flags);
      return;
    default:
      throw new UsageError(`unknown action "${action}": use index, search, verify, or import`);
  }
}

function search(workspace: string, config: HarnessConfig, terms: string[], flags: Flags): void {
  const limit = Number(stringFlag(flags, "limit") ?? 10);
  if (!Number.isInteger(limit) || limit < 1) throw new UsageError("--limit must be a positive whole number");
  let repo = stringFlag(flags, "repo");
  let files = listFlag(flags, "paths");
  if (flags.changed === true) {
    if (files.length > 0) throw new UsageError("pass --paths or --changed, not both");
    const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
    const found = top.status === 0 ? repoForDir(workspace, config.repos, top.stdout.trim()) : undefined;
    if (!found) {
      throw new Error("--changed needs to run inside a worktree of a configured repo; otherwise pass --paths and --repo.");
    }
    repo ??= found.name;
    files = changedFiles(workspace, found, top.stdout.trim());
    if (files.length === 0) {
      console.log("No files changed on this branch since it left its base.");
      if (terms.length === 0) return;
    }
  }
  if (terms.length === 0 && files.length === 0 && flags.changed !== true) {
    throw new UsageError("give search terms, --paths <file,...>, or --changed");
  }
  const changes = files.map((file) => changedFile(config, file, repo, flags.changed === true));
  const notes = readNotes(knowledgeDir(workspace, config));
  const matches = new Map<KnowledgeNote, string[]>();
  for (const note of notes) {
    const hit = changes.filter((change) => notesForFiles([note], [change.path], change.repo).length > 0);
    if (hit.length > 0) matches.set(note, hit.map((change) => change.file));
  }
  const byPath = [...matches.keys()];
  const byTerm = searchNotes(notes, terms, repo).filter((note) => !matches.has(note));
  const results = [...byPath, ...byTerm].slice(0, limit);
  if (results.length === 0) {
    console.log(notes.length === 0 ? "The knowledge store has no notes yet." : "No notes match.");
    return;
  }
  for (const note of results) {
    console.log(indexLine(note, undefined, true));
    const hit = matches.get(note);
    if (hit) console.log(`  matches: ${(hit.length > 3 ? [...hit.slice(0, 3), `and ${hit.length - 3} more`] : hit).join(", ")}`);
  }
  const more = byPath.length + byTerm.length - results.length;
  if (more > 0) console.log(`(${more} more; raise --limit to see them)`);
}

/**
 * A `--paths` file and the repo it belongs to. Paths are relative to their
 * repo; without `--repo`, a leading `<repo>/` names the repo, and a single
 * configured repo needs no prefix.
 */
function changedFile(
  config: HarnessConfig,
  file: string,
  repo: string | undefined,
  fromBranch: boolean,
): { file: string; path: string; repo: string | undefined } {
  if (repo || fromBranch) return { file, path: file, repo };
  const names = config.repos.map((candidate) => candidate.name);
  const prefixed = names.find((name) => file.startsWith(`${name}/`));
  if (prefixed) return { file, path: file.slice(prefixed.length + 1), repo: prefixed };
  if (names.length > 1) {
    throw new UsageError(
      `can't tell which repo "${file}" is in: pass --repo, or prefix the path with the repo name (${names.join(", ")})`,
    );
  }
  return { file, path: file, repo: names[0] };
}

function verify(workspace: string, config: HarnessConfig, slug: string): void {
  const dir = knowledgeDir(workspace, config);
  const file = ["notes", "pending"]
    .map((folder) => resolve(dir, folder, `${slug}.md`))
    .find((candidate) => existsSync(candidate));
  if (!file) throw new Error(`No active note "${slug}" in ${dir}`);
  const date = today();
  writeFileSync(file, setFrontmatterField(readFileSync(file, "utf8"), "verified", date));
  writeIndexes(workspace, config);
  console.log(`Verified ${slug} on ${date}: ${file}`);
}

function noteBody(flags: Flags): string {
  const body = stringFlag(flags, "body");
  const bodyFile = stringFlag(flags, "body-file");
  if (body && bodyFile) throw new UsageError("pass --body or --body-file, not both");
  if (bodyFile) return readFileSync(bodyFile, "utf8");
  return body ?? "";
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

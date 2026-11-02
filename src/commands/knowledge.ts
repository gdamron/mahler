import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
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
  formatNote,
  indexLine,
  knowledgeDir,
  type KnowledgeNote,
  notesForFiles,
  readNotes,
  searchNotes,
  setFrontmatterField,
  writeIndexes,
} from "../knowledge.js";
import { repoForDir } from "../repos.js";
import type { HarnessConfig } from "../types.js";
import { slugify, writeFileEnsured } from "../util.js";
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
  const slug = slugify(stringFlag(flags, "slug") ?? title);
  if (!slug) throw new UsageError("the title (or --slug) has no usable characters for a slug");
  const repos = listFlag(flags, "repos");
  const known = config.repos.map((repo) => repo.name);
  const unknown = repos.filter((repo) => !known.includes(repo));
  if (unknown.length > 0) {
    throw new UsageError(
      `Unknown repo ${unknown.map((repo) => `"${repo}"`).join(", ")}. Configured repos: ${known.join(", ") || "(none)"}`,
    );
  }
  const body = noteBody(flags);
  const dir = knowledgeDir(workspace, config);
  for (const folder of ["notes", "pending", "archive"]) {
    const existing = resolve(dir, folder, `${slug}.md`);
    if (existsSync(existing)) {
      const note = readNotes(dir).find((candidate) => candidate.file === existing);
      throw new Error(
        [
          `A note already uses the slug "${slug}": ${existing}`,
          note ? `  ${note.description}` : "",
          folder === "archive"
            ? "It is retired. Pass --slug for a new note, and link the old one if it helps."
            : "If it covers the same fact, update that note instead (set `updated:` to today). Otherwise pass --slug.",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
  }
  const others = readNotes(dir);
  const file = resolve(dir, "notes", `${slug}.md`);
  writeFileEnsured(
    file,
    formatNote({
      slug,
      title,
      description,
      tags: listFlag(flags, "tags").map(slugify).filter(Boolean),
      repos,
      paths: listFlag(flags, "paths"),
      sources: listFlag(flags, "source"),
      body,
      date: today(),
    }),
  );
  writeIndexes(workspace, config);
  console.log(`Recorded knowledge: ${file}`);
  const similar = searchNotes(others, [title, description], undefined, 6).slice(0, 3);
  if (similar.length > 0) {
    console.log("Similar notes (merge into one of these if they cover the same fact):");
    for (const note of similar) console.log(indexLine(note, workspace));
  }
}

/** `mahler knowledge index|search|verify`. */
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
    default:
      throw new UsageError(`unknown action "${action}": use index, search, or verify`);
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
  const notes = readNotes(knowledgeDir(workspace, config));
  const byPath = files.length > 0 ? notesForFiles(notes, files, repo) : [];
  const byTerm = searchNotes(notes, terms, repo).filter((note) => !byPath.includes(note));
  const results = [...byPath, ...byTerm].slice(0, limit);
  if (results.length === 0) {
    console.log(notes.length === 0 ? "The knowledge store has no notes yet." : "No notes match.");
    return;
  }
  for (const note of results) {
    console.log(indexLine(note, workspace));
    if (byPath.includes(note)) console.log(`  matches: ${matchedFiles(note, files).join(", ")}`);
  }
  const more = byPath.length + byTerm.length - results.length;
  if (more > 0) console.log(`(${more} more; raise --limit to see them)`);
}

function matchedFiles(note: KnowledgeNote, files: string[]): string[] {
  const matched = files.filter((file) => notesForFiles([note], [file]).length > 0);
  return matched.length > 3 ? [...matched.slice(0, 3), `and ${matched.length - 3} more`] : matched;
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

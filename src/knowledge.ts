import { existsSync, readFileSync, readdirSync } from "node:fs";
import { matchesGlob, relative, resolve } from "node:path";
import type { HarnessConfig, LinearIssue, RepoConfig } from "./types.js";
import { writeFileEnsured } from "./util.js";

// ---------------------------------------------------------------------------
// Knowledge store
//
// One markdown note per fact under `<knowledge path>/notes/`, with YAML
// frontmatter that Obsidian can read and edit. Mahler regenerates INDEX.md
// from the notes; search reads the notes themselves, so a stale index never
// hides a note. See docs/design/knowledge-store.md.
// ---------------------------------------------------------------------------

export interface KnowledgeNote {
  slug: string;
  /** Absolute path to the note file. */
  file: string;
  title: string;
  description: string;
  tags: string[];
  /** Workspace repo names; empty means workspace-wide. */
  repos: string[];
  /** Repo-relative globs for the files the note is about. */
  paths: string[];
  status: string;
  sources: string[];
  created?: string;
  updated?: string;
  verified?: string;
  /** Published for review but not merged yet (repo mode with PRs). */
  pending: boolean;
  body: string;
}

/** Fields `mahler learn` writes; the rest of a note's shape is derived. */
export interface NewNote {
  slug: string;
  title: string;
  description: string;
  tags: string[];
  repos: string[];
  paths: string[];
  sources: string[];
  body: string;
  date: string;
}

export function knowledgeDir(workspace: string, config: HarnessConfig): string {
  return resolve(workspace, config.knowledge.path);
}

export function decisionsDir(workspace: string): string {
  return resolve(workspace, ".harness", "decisions");
}

/** Active and pending notes; retired notes live in `archive/` and are skipped. */
export function readNotes(dir: string): KnowledgeNote[] {
  return [
    ...readNoteDir(resolve(dir, "notes"), false),
    ...readNoteDir(resolve(dir, "pending"), true),
  ].filter((note) => note.status !== "retired");
}

function readNoteDir(dir: string, pending: boolean): KnowledgeNote[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => {
      const file = resolve(dir, entry.name);
      return parseNote(readFileSync(file, "utf8"), entry.name.slice(0, -3), file, pending);
    });
}

/**
 * Parse a note. Frontmatter is the YAML subset Mahler writes and Obsidian's
 * property editor produces: `key: value`, flow lists (`[a, "b"]`), and block
 * lists (`- a` on the following lines).
 */
export function parseNote(text: string, slug: string, file = "", pending = false): KnowledgeNote {
  const { fields, body } = splitFrontmatter(text);
  const list = (key: string): string[] => {
    const value = fields[key];
    if (Array.isArray(value)) return value;
    return value ? [value] : [];
  };
  const scalar = (key: string): string | undefined => {
    const value = fields[key];
    const text = Array.isArray(value) ? value.join(", ") : value;
    return text || undefined;
  };
  return {
    slug,
    file,
    title: scalar("title") ?? slug,
    description: scalar("description") ?? firstSentence(body),
    tags: list("tags").map((tag) => tag.replace(/^#/, "")),
    repos: list("repos"),
    paths: list("paths"),
    status: scalar("status") ?? "active",
    sources: list("sources"),
    created: scalar("created"),
    updated: scalar("updated"),
    verified: scalar("verified"),
    pending,
    body: body.trim(),
  };
}

function splitFrontmatter(text: string): { fields: Record<string, string | string[]>; body: string } {
  const match = /^(?:<!--[\s\S]*?-->\s*)?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { fields: {}, body: text };
  const fields: Record<string, string | string[]> = {};
  let listKey: string | undefined;
  for (const line of match[1].split(/\r?\n/)) {
    const item = /^\s*-(?:\s+(.*))?$/.exec(line);
    if (item && listKey) {
      const current = fields[listKey];
      fields[listKey] = [...(Array.isArray(current) ? current : []), unquote((item[1] ?? "").trim())].filter(Boolean);
      continue;
    }
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!pair) continue;
    const [, key, raw] = pair;
    const value = raw.trim();
    listKey = undefined;
    if (value === "") {
      listKey = key;
      fields[key] = [];
    } else if (/^\[.*\](\s+#.*)?$/.test(value)) {
      fields[key] = splitFlowList(value.slice(1, value.lastIndexOf("]")));
    } else {
      fields[key] = unquote(value);
    }
  }
  return { fields, body: match[2] };
}

function splitFlowList(inner: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote: string | undefined;
  for (const char of inner) {
    if (quote) {
      current += char;
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === ",") {
      items.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  items.push(current);
  return items.map((item) => unquote(item.trim())).filter(Boolean);
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

/** YAML-safe scalar: plain when unambiguous, otherwise a JSON (double-quoted) string. */
function yamlScalar(value: string): string {
  return /^[A-Za-z0-9][\w./@-]*$/.test(value) ? value : JSON.stringify(value);
}

function yamlList(values: string[]): string {
  return `[${values.map(yamlScalar).join(", ")}]`;
}

export function formatNote(note: NewNote): string {
  const lines = [
    "---",
    `title: ${JSON.stringify(note.title)}`,
    `description: ${JSON.stringify(note.description)}`,
    `tags: ${yamlList(note.tags)}`,
    `repos: ${yamlList(note.repos)}`,
    `paths: ${yamlList(note.paths)}`,
    "status: active",
    `sources: ${yamlList(note.sources)}`,
    `created: ${note.date}`,
    `updated: ${note.date}`,
    `verified: ${note.date}`,
    "---",
    "",
  ];
  return `${lines.join("\n")}${note.body.trim() ? `${note.body.trim()}\n` : ""}`;
}

/** Set one frontmatter field in place, leaving the rest of the note as written. */
export function setFrontmatterField(text: string, key: string, value: string): string {
  const match = /^((?:<!--[\s\S]*?-->\s*)?---\r?\n)([\s\S]*?)(\r?\n---)/.exec(text);
  if (!match) throw new Error("note has no frontmatter");
  const eol = match[1].endsWith("\r\n") ? "\r\n" : "\n";
  const lines = match[2].split(/\r?\n/);
  const at = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (at >= 0) lines[at] = `${key}: ${value}`;
  else lines.push(`${key}: ${value}`);
  return `${match[1]}${lines.join(eol)}${text.slice(match[1].length + match[2].length)}`;
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

/**
 * One index line: the note, its description, and its tags. With `from`, the
 * title links to the note relative to that folder (for INDEX.md files). With
 * `plain`, the note's path follows the title as code, relative to `from` or
 * absolute without it (for briefs and terminal output, where a relative link
 * would resolve against the wrong folder).
 */
export function indexLine(note: KnowledgeNote, from?: string, plain = false): string {
  const path = (from === undefined ? note.file : relative(from, note.file)).split("\\").join("/");
  const head = plain ? `${note.title} (\`${path}\`)` : `[${note.title}](${encodeURI(path)})`;
  const tags = note.tags.map((tag) => ` #${tag}`).join("");
  const repos = note.repos.length > 0 ? ` (repos: ${note.repos.join(", ")})` : "";
  const pending = note.pending ? " (pending review)" : "";
  return `- ${head}: ${note.description}${tags}${repos}${pending}`;
}

/** INDEX.md for the knowledge store: every note once, grouped by its first tag. */
export function knowledgeIndex(dir: string, notes: KnowledgeNote[]): string {
  const groups = new Map<string, KnowledgeNote[]>();
  for (const note of [...notes].sort((a, b) => a.title.localeCompare(b.title))) {
    const group = note.tags[0] ?? "untagged";
    groups.set(group, [...(groups.get(group) ?? []), note]);
  }
  const sections = [...groups.keys()]
    .sort((a, b) => (a === "untagged" ? 1 : b === "untagged" ? -1 : a.localeCompare(b)))
    .map((group) => `## ${group}\n\n${groups.get(group)!.map((note) => indexLine(note, dir)).join("\n")}`);
  return [
    "<!-- Generated by `mahler knowledge index`; edits are overwritten. -->",
    "# Knowledge Index",
    "",
    `${notes.length} ${notes.length === 1 ? "note" : "notes"}. Search with \`mahler knowledge search <terms>\` or \`--changed\`; see \`.harness/policies/knowledge.md\`.`,
    "",
    sections.join("\n\n"),
    "",
  ].join("\n");
}

interface LedgerEntry {
  file: string;
  rule: string;
  issue: string;
  date: string;
  summary: string;
}

function readLedger(dir: string): LedgerEntry[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !["README.md", "INDEX.md"].includes(entry.name))
    .map((entry) => {
      const file = resolve(dir, entry.name);
      const { fields, body } = splitFrontmatter(readFileSync(file, "utf8"));
      const text = (key: string) => {
        const value = fields[key];
        return Array.isArray(value) ? value.join(", ") : value ?? "";
      };
      return {
        file,
        rule: text("rule") || entry.name.slice(0, -3),
        issue: text("issue"),
        date: text("date"),
        summary: text("description") || firstSentence(body),
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

/** INDEX.md for the decisions ledger: one line per active note, oldest first. */
export function ledgerIndex(dir: string): string {
  const entries = readLedger(dir);
  const lines = entries.map((entry) => {
    const link = relative(dir, entry.file).split("\\").join("/");
    const meta = [entry.issue, entry.date].filter(Boolean).join(", ");
    return `- [${entry.rule}](${link}): ${entry.summary}${meta ? ` (${meta})` : ""}`;
  });
  return [
    "<!-- Generated by Mahler; edits are overwritten. -->",
    "# Decisions Ledger Index",
    "",
    `${entries.length} active ${entries.length === 1 ? "note" : "notes"} (\`archive/\` not included). Read this index at session start, and open the notes that bear on your work.`,
    "",
    ...lines,
    "",
  ].join("\n");
}

/** Rebuild both indexes. Returns the number of knowledge notes and ledger entries. */
export function writeIndexes(workspace: string, config: HarnessConfig): { notes: number; decisions: number } {
  const dir = knowledgeDir(workspace, config);
  const notes = readNotes(dir);
  writeFileEnsured(resolve(dir, "INDEX.md"), knowledgeIndex(dir, notes));
  const ledger = decisionsDir(workspace);
  writeFileEnsured(resolve(ledger, "INDEX.md"), ledgerIndex(ledger));
  return { notes: notes.length, decisions: readLedger(ledger).length };
}

// ---------------------------------------------------------------------------
// Search and relevance
// ---------------------------------------------------------------------------

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Words too common to say anything about which note is meant. */
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "for", "from", "has", "in", "into", "is",
  "it", "its", "not", "of", "on", "or", "s", "t", "that", "the", "this", "to", "was", "when", "with",
]);

function appliesToRepo(note: KnowledgeNote, repo: string | undefined): boolean {
  return !repo || note.repos.length === 0 || note.repos.includes(repo);
}

function freshness(note: KnowledgeNote): string {
  return note.verified ?? note.updated ?? note.created ?? "";
}

/**
 * Notes matching search terms, best first: a term in the title or tags counts
 * 3, in the description 2, in the body 1. Each term counts once per field.
 */
export function searchNotes(
  notes: KnowledgeNote[],
  terms: string[],
  repo?: string,
  minScore = 1,
): KnowledgeNote[] {
  const query = [...new Set(terms.flatMap(words))].filter((term) => !STOP_WORDS.has(term));
  if (query.length === 0) return [];
  const scored = notes
    .filter((note) => appliesToRepo(note, repo))
    .map((note) => {
      const title = new Set([...words(note.title), ...note.tags.flatMap(words)]);
      const description = new Set(words(note.description));
      const body = new Set(words(note.body));
      const score = query.reduce(
        (sum, term) =>
          sum + (title.has(term) ? 3 : 0) + (description.has(term) ? 2 : 0) + (body.has(term) ? 1 : 0),
        0,
      );
      return { note, score };
    })
    .filter(({ score }) => score >= minScore);
  scored.sort((a, b) => b.score - a.score || freshness(b.note).localeCompare(freshness(a.note)));
  return scored.map(({ note }) => note);
}

/** Notes whose `paths` globs match any of the given repo-relative files. */
export function notesForFiles(
  notes: KnowledgeNote[],
  files: string[],
  repo?: string,
): KnowledgeNote[] {
  return notes.filter(
    (note) =>
      appliesToRepo(note, repo) &&
      note.paths.some((pattern) => files.some((file) => matchesGlob(file, pattern))),
  );
}

export interface Relevant {
  notes: KnowledgeNote[];
  /** How many notes matched before the limit. */
  matched: number;
}

/**
 * Notes for an issue's brief. Mahler knows only the issue's text, labels, and
 * repos at brief time, so this is a first pass: notes whose tags appear in
 * the issue come first (most tags matched, then most recently verified), and
 * notes that only match the issue's repos, or are workspace-wide, fill the
 * rest up to `limit`. A note scoped to other repos than the issue's is left
 * out even when its tags match; when the issue's repos are unknown, tag
 * matches from any repo are kept.
 */
export function relevantNotes(
  notes: KnowledgeNote[],
  issue: LinearIssue,
  repos: RepoConfig[],
  limit = 30,
): Relevant {
  const text = ` ${words([issue.title, issue.description ?? "", ...(issue.labels ?? []), ...(issue.projectLabels ?? [])].join(" ")).join(" ")} `;
  const mentions = (phrase: string) => {
    const normalized = words(phrase).join(" ");
    return normalized !== "" && (text.includes(` ${normalized} `) || text.includes(` ${normalized}s `));
  };
  const issueRepos =
    repos.length === 1 ? [repos[0].name] : repos.map((repo) => repo.name).filter(mentions);
  const forIssue = (note: KnowledgeNote) =>
    note.repos.length === 0 || issueRepos.length === 0 || note.repos.some((repo) => issueRepos.includes(repo));
  const tagged = notes
    .filter(forIssue)
    .map((note) => ({ note, hits: note.tags.filter(mentions).length }))
    .filter(({ hits }) => hits > 0)
    .sort((a, b) => b.hits - a.hits || freshness(b.note).localeCompare(freshness(a.note)))
    .map(({ note }) => note);
  const byRepo = notes
    .filter(
      (note) =>
        !tagged.includes(note) &&
        (note.repos.length === 0 || note.repos.some((repo) => issueRepos.includes(repo))),
    )
    .sort((a, b) => freshness(b).localeCompare(freshness(a)));
  const all = [...tagged, ...byRepo];
  return { notes: all.slice(0, limit), matched: all.length };
}

/** The brief's `## Relevant Knowledge` body. */
export function relevantKnowledgeMarkdown(
  relevant: Relevant,
  total: number,
  workspace: string,
): string {
  const how =
    "Search for more with `mahler knowledge search <terms>`; after planning, and when reviewing, run `mahler knowledge search --changed` (or `--paths <files>`) to find notes about the files being changed. Record what you learn with `mahler learn` (see `.harness/policies/knowledge.md`).";
  if (total === 0) return `No knowledge notes yet. ${how}`;
  if (relevant.notes.length === 0) {
    return `None of the ${total} knowledge notes match this issue's tags or repos. ${how}`;
  }
  const shown =
    relevant.matched > relevant.notes.length
      ? `${relevant.notes.length} shown of ${relevant.matched} matching`
      : `${relevant.matched} matching`;
  return [
    `Notes whose tags appear in this issue come first, then notes for its repos or the whole workspace (${shown}; ${total} in the store). Open a note before relying on it. ${how}`,
    "",
    ...relevant.notes.map((note) => indexLine(note, workspace, true)),
  ].join("\n");
}

function firstSentence(body: string): string {
  const text = body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^#.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
  // End at the first sentence break that isn't an abbreviation like "e.g.".
  const end = [...text.matchAll(/[.!?](?=\s|$)/g)].find(
    (match) => !/(?:^|[\s(])(?:e\.g|i\.e|vs|[A-Za-z])\.$/i.test(text.slice(0, match.index + 1)),
  );
  const sentence = end ? text.slice(0, end.index + 1) : text;
  return sentence.length > 200 ? `${sentence.slice(0, 197).trimEnd()}...` : sentence;
}

/** Split a comma-separated list of globs, keeping commas inside `{a,b}`. */
export function splitGlobs(value: string): string[] {
  const globs: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of value) {
    if (char === "{") depth += 1;
    if (char === "}") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      globs.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  globs.push(current);
  return globs.map((glob) => glob.trim()).filter(Boolean);
}

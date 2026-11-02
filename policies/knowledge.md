# Knowledge Policy

Agents relearn the workspace every session. The knowledge store carries what
earlier sessions learned about the code, tools, and project, so the next
session doesn't rediscover it. It lives at `knowledge.path` in
`.harness/config.json` (default `.harness/knowledge/`), one fact per note.

## What Goes Where

- **Knowledge** is about the world: "Supabase storage `exists()` returns
  false for a denied read." Record it with `mahler learn`.
- **A deviation** is about Mahler's rules: "I skipped the tester because the
  change was docs-only." Record it in `HANDOFF.md`, and with `mahler decide`
  when it generalizes (see the judgment policy).
- **A preference** is how this human wants work done. It belongs in
  `.harness/custom/` overlays or the instruction files, which the human owns.
- **Design rationale** for code belongs in that repo's docs, next to the code.

## Reading

- At session start, read the brief's `Relevant Knowledge` section. It is a
  first pass, matched on the issue's words and repos.
- After planning, once you know which files you'll change, run
  `mahler knowledge search --changed` from the worktree (or `--paths` with
  repo-relative files and `--repo`, or `<repo>/<file>` paths) and read the
  notes it finds.
- Before working in an unfamiliar area, run `mahler knowledge search <terms>`.
- A reviewer runs `mahler knowledge search --changed` on the diff. A change
  that walks into a trap a note describes is a finding.
- Open a note before relying on it; the index line is a summary.

## Writing

Write a note when you learn something a later session would otherwise have to
rediscover: a tool's surprising behavior, a constraint in the code, a check
that doesn't run where you'd expect, a setup step. Don't write one for what the
code or its docs already say plainly.

1. **Search first** (`mahler knowledge search <terms>`). If a note covers the
   fact, update it: correct the body, and set `updated:` to today.
2. **One fact per note.** Two facts that could be true or false separately
   are two notes; link them with `[[slug]]`.
3. **The title is the claim**, not the topic: "list() matches by prefix", not
   "Storage listing".
4. **The description carries the fact** in one or two sentences, including
   what to do instead. The index and search show only this line.
5. **The body stands alone.** Write it for someone who never saw the issue:
   no "as above", no issue-only context. Put issue IDs in `sources`.
6. **Scope it.** `--tags` for the areas it touches, `--repos` when it is true
   of only some repos, and `--paths` with globs for the files it is about,
   relative to the repo (`src/storage/**`), so path searches find it.
7. **No secrets, credentials, or customer data.** The store may be shared.

Conductors and composers run `mahler learn`. Slice conductors, testers, and
reviewers put proposed notes (title, description, scope) in their report, and
their parent records them.

## Keeping It True

- **Correcting a wrong note is expected**, not a deviation. Fix it in place.
- **Verify** a note when your work confirms it still holds, by hitting the
  behavior again or reading the code it describes:
  `mahler knowledge verify <slug>`.
- **Retire** a note that is no longer true: set `status: retired`, add
  `superseded-by: <slug>` when another note replaces it, and move it to
  `archive/`.
- When you notice duplicates, contradictions, or notes whose repos or paths
  no longer exist, raise them with the human rather than deleting notes.

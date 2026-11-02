# Knowledge Policy

Agents relearn the workspace every session. The knowledge store carries what
earlier sessions learned about the code, tools, and project, so the next
session doesn't rediscover it. It lives at `knowledge.path` in
`.harness/config.json` (default `.harness/knowledge/`), one fact per note.

## What Goes Where

- **Knowledge** is about the world: "The cache client's `get()` returns
  null on a timeout." Record it with `mahler learn`.
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
3. **The title is the claim**, not the topic: "get() returns null on a timeout",
   not "Cache behavior".
4. **The description carries the fact** in one or two sentences, including
   what to do instead. The index and search show only this line.
5. **The body stands alone.** Write it for someone who never saw the issue:
   no "as above", no issue-only context. Put issue IDs in `sources`.
6. **Scope it.** `--tags` for the areas it touches, `--repos` when it is true
   of only some repos, and `--paths` with globs for the files it is about,
   relative to the repo (`src/cache/**`), so path searches find it.
7. **No secrets, credentials, or customer data.** The store may be shared.

When the store is a shared repo (`knowledge.repo` in config), `learn`,
`verify`, and `import` publish the change, and briefs pull others' notes
first. After editing a note by hand, run `mahler knowledge sync`. If a sync
reports a conflict, your commit is kept locally: resolve it in the store
folder, or raise it with the human. A sync that couldn't reach the remote
only warns; the next sync publishes.

With `knowledge.publish: "pr"`, nothing lands until the human merges it. A
new note waits in `pending/` (search and briefs on this machine still find
it) with a PR of its own, which editing the pending note updates; edits to
existing notes, verified dates included, go up together in one open PR at
the next sync. Briefs only pull, so run `mahler knowledge sync` after
editing notes by hand. Never merge a knowledge PR
yourself, whatever the merge policy allows for code, and don't push to its
branch: Mahler stops updating a PR once anyone else commits to it. A PR the
human closes drops its change from this machine too, unless the change was
edited since.

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
- The audit skill reviews the store with the human: duplicates to merge,
  contradictions, notes whose repos or paths no longer exist, and notes not
  verified in a long time. Between audits, raise these with the human rather
  than deleting notes.

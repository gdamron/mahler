# Design: Knowledge Store and Decisions Ledger

Status: agreed design, ready to split into issues (2026-11-02)

## Problem

`.harness/decisions/` was meant for Tier 1 deviations, but in practice it
becomes the workspace's knowledge base. In a long-running workspace, most
notes turn out to be codebase gotchas, with the topic written into the `rule`
field. Every session is told to read the whole active ledger at start, which
can cost tens of thousands of tokens and grows with every note. Because the
ledger is append-only, a gotcha that turns out wrong or stale can't be fixed,
only archived by a human.

Sorting a ledger by hand works: archive notes already folded in elsewhere,
promote standing rules to `CLAUDE.md`, and move design notes into the repos.
That can shrink what each session reads several times over. This design
builds that sorting into Mahler.

## Goals

- Sessions read only the knowledge relevant to their work, not every note.
- Knowledge can be corrected: agents update or retire notes instead of adding
  near-duplicates.
- The knowledge store lives in a local folder or a git repo, and in repo mode
  it publishes directly or through PRs, as config says.
- The decisions ledger goes back to recording deviations, and the audit
  promotes the notes worth sharing.
- Notes stay plain markdown with frontmatter and `[[links]]`, so either folder
  opens as an Obsidian vault. Mahler doesn't need Obsidian.

## Non-Goals

- Embedding or vector search. `mahler knowledge search` is the interface, so a
  hybrid backend can replace the text search later without changing any skill
  or policy. Revisit if agents miss notes because they searched with different
  words, or once a store reaches thousands of notes.
- Syncing preferences. What one human wants stays in `.harness/custom/`
  overlays and instruction files, which the audit already reviews.
- Classifying notes automatically when migrating. The audit proposes, and the
  human approves.

## Three Kinds of Record

| Record | What it holds | Who reads it | Where it lives |
|---|---|---|---|
| Decision | A Tier 1 deviation and why: the norm didn't fit here | The audit; sessions read only its index | Ledger: local by default, optionally a private repo |
| Knowledge | What is true of the code, tools, or project | Sessions, chosen by relevance | Knowledge store: local folder or shared repo |
| Preference | How this human wants work done | Every session, through instruction files | `.harness/custom/` and instruction files (unchanged) |

Test for the agent writing a note: a deviation is about Mahler's rules ("I
skipped X because…"). Knowledge is about the world ("Y behaves like Z").

## Note Format

One note per fact, named by a stable slug: `notes/<slug>.md`.

```md
---
title: The cache client's get() returns null for a timeout as well as a miss
description: get() swallows timeouts and returns null, so callers treat a slow cache as empty and recompute. Use getOrThrow() where a timeout must surface.
tags: [cache]
repos: [api]
paths: ["src/cache/**"]
status: active
sources: [DEV-123]
created: 2026-09-08
updated: 2026-09-08
verified: 2026-10-30
---

<the explanation, written so it makes sense without the issue that found it>

Related: [[cache-keys-are-case-sensitive]]
```

- **Title:** the claim itself, not the topic.
- **Description:** one or two sentences that carry the fact, since the index
  and search results show it. An agent should often be able to act on the
  description alone.
- **Tags:** free-form areas. **Repos:** workspace repo names, optional (empty
  means workspace-wide). **Paths:** repo-relative globs for the files the note
  is about, optional. Briefs match on repos and tags; searches during the
  work match on paths.
- **Status:** `active` or `retired`. A retired note moves to `archive/` and
  says what replaced it, if anything (`superseded-by: <slug>`).
- **Verified:** the last date an agent confirmed the note still holds, for
  example by hitting the behavior again or reading the code it describes.
  `created` and `updated` track edits; `verified` tracks truth. The audit
  uses it to find notes nobody has confirmed in a long time.
- **No secrets, no credentials, no customer data.** A store may be shared.

The ledger keeps its current format (`date`, `issue`, `agent`, `rule`) and
adds a `description` line so it can be indexed too.

## Layout

```
<knowledge path>/            default: .harness/knowledge
  README.md                  conventions (installed by Mahler)
  INDEX.md                   generated; gitignored in repo mode
  notes/<slug>.md
  archive/<slug>.md
  pending/<slug>.md          PR mode only: published but not merged; gitignored

<decisions path>/            default: .harness/decisions
  README.md
  INDEX.md                   generated
  <date>-<slug>.md
  archive/
```

`INDEX.md` is one line per note, `- [title](notes/slug.md): description
#tags`, grouped by tag. It is generated, never edited, so two agents adding
notes never conflict over it. `mahler` rebuilds it after every write and every
sync.

## How Sessions Use It

1. **At brief time:** `mahler issue` and `mahler task` write a `## Relevant
   Knowledge` section into `AGENT_SESSION.md`. Mahler knows only the issue's
   text, labels, and repos then, so this is a first pass. Notes whose tags
   appear in the issue's title, description, or labels come first. Notes
   that only match the issue's repos, or apply to the whole workspace, fill
   the rest, up to about 30 lines. A note scoped to other repos is left out
   even when its tags match. The section says how many notes matched in all.
2. **At session start:** read that section and the ledger's `INDEX.md`. The
   ledger index stays short once the knowledge is moved out. Sessions no
   longer read every note.
3. **After planning:** once the conductor knows which files it will change,
   it runs `mahler knowledge search --paths <repo>/<file>,...` (or `--changed` once
   work is under way) and reads the matches.
   Paths have no synonyms, so this finds notes that the brief's word matching
   missed.
4. **While working:** before changing an unfamiliar area, run `mahler
   knowledge search <terms>`, and open the notes that match.
5. **At review:** the reviewer runs `mahler knowledge search --changed` on
   the diff, and checks the change against each matching note.
   A diff that walks into a known trap is a finding.
6. **On learning something:** search first. If a note covers it, update that
   note (`updated:` and the body). Otherwise run `mahler learn`. Correcting a
   wrong note is expected, not a deviation.
7. **On confirming a note:** when the work shows a note still holds, set its
   `verified:` date (`mahler knowledge verify <slug>`). In PR mode, verify
   dates batch into the next knowledge PR rather than opening one each.
8. **On deviating from a norm:** unchanged. Record it in `HANDOFF.md`, and run
   `mahler decide` when the reason generalizes beyond the issue.

## Commands

- `mahler learn --title <t> --description <d> [--tags a,b] [--repos r]
  [--paths 'glob,glob'] [--body-file f] [--slug s] [--source ISSUE]`: writes the note, rebuilds the
  index, and publishes it in repo mode. It refuses a slug that already exists
  and prints the existing note instead, so the agent updates it.
- `mahler knowledge search <terms> [--repo r] [--limit n]`: ranks title and tag
  matches over description over body, prints index lines with paths, and
  includes `pending/`. With `--paths <file,...>`, or `--changed` from a
  worktree (the files its branch changed since leaving its base, as `mahler
  check` computes them), it returns the notes whose `paths` globs match
  those files, in the matching repo. Paths are relative to their repo; a
  `<repo>/` prefix or `--repo` says which repo. No dependencies. This is where a hybrid backend would
  plug in.
- `mahler knowledge index`: rebuilds `INDEX.md` for both stores.
- `mahler knowledge sync`: in repo mode, pulls, publishes anything unpushed,
  clears pending notes once merged, and rebuilds the indexes. It runs
  automatically in `mahler issue` and `mahler task`, and after `learn`,
  `verify`, and `import`. A sync that can't reach the remote within 30
  seconds keeps the commit and warns; the next sync publishes it. Git never
  prompts for credentials. Besides `INDEX.md` and `pending/`, the store's repo
  ignores (and untracks) `.obsidian/`, `.trash/`, and `.DS_Store`, so editor
  state can't conflict between people.
- `mahler knowledge verify <slug>`: sets `verified:` to today.
- `mahler knowledge import <ledger-note> [--title t] [--description d]
  [--tags a,b] [--repos r] [--paths glob,glob] [--slug s] [--archive]`:
  converts a ledger note into a knowledge note. `rule` becomes the slug,
  `issue` becomes `sources`, the body is copied, and the ledger date becomes
  `created` and `verified`. The title and description default to the rule and
  the ledger summary; the audit passes the rewritten ones the human approved.
  `--archive` moves the ledger note to `archive/` with `imported-to: <slug>`,
  and a note that has `imported-to` can't be imported again. Used by the
  audit during migration.
- `mahler doctor`: reports each store's mode, whether the clone exists and
  tracks its remote, whether the index is fresh, and how many pending notes
  have waited more than a week.

## Configuration

Both stores use the same shape and backend code:

```json
"knowledge": {
  "path": ".harness/knowledge",
  "repo": "git@github.com:example/workspace-knowledge.git",
  "branch": "main",
  "publish": "direct"
},
"decisions": {
  "path": ".harness/decisions"
}
```

- No `repo`: a local folder. `publish` is ignored.
- With `repo`: install clones it into `path`. When `path` already holds a
  local store, install copies its notes into the clone (`sync` publishes
  them) and keeps the old folder beside it; a note that differs between the
  two stops the install with nothing changed. Doctor reports a folder that
  isn't a clone of that repo, for example when `repo` was set without
  rerunning install. A `branch` the remote doesn't have yet starts empty,
  not from the remote's default branch. Each
  workspace has its own store; the repo is how that store is shared between
  machines and people working in the same workspace.
- `publish: "direct"` (the default): `learn` commits on `branch` and pushes. On
  a non-fast-forward it pulls with rebase and retries once. New notes are new
  files, so this rarely conflicts. A conflict on an edited note stops and is
  reported.
- `publish: "pr"`: the clone only fast-forwards; every change goes up as a
  PR, opened with `gh` from a temporary worktree based on the remote
  `branch`, which must already exist. `learn` and `import` write the note to
  `pending/` instead of `notes/`, so sessions on this machine find it before
  the PR merges, and open a PR for it on `knowledge/<slug>-<random>` with the
  note's description, tags, and sources. (The random suffix, not the agent's
  name, keeps two machines' branches apart; `learn` doesn't know the agent.)
  The pending copy records the PR in `pr:` and `pr-branch:`, which the
  published note leaves out; editing the pending note updates its PR. Edits
  to notes already on `branch` (`verify`, hand edits, an audit) stay in the
  working tree and go up as one open batch PR, which each sync force-pushes
  to match the current edits, so a file never sits in two competing PRs.
  `pending/edits.json` records the batch by git blob id. The human reviews
  and merges knowledge PRs; no agent merges them, whatever the merge policy
  allows for code, because the store is shared between agents and the
  human. `sync` drops a pending note when the remote holds it exactly as
  proposed, or when `gh` says its PR merged (once the pull has brought the
  note) or closed unmerged; a different note with the same slug from
  another machine doesn't count. For the batch, it puts the files back to
  the clone's version (unless edited again since), remembers a closed
  batch's changes so they aren't proposed again, and then pulls. Before
  opening a PR, sync looks for one already open from the same branch, so a
  `gh pr create` whose reply was lost isn't repeated. PR mode keeps
  machine-local files out through `.git/info/exclude`, not `.gitignore`,
  which would itself need a PR. Briefs only pull and settle what git can
  see; they open no PRs. Switching back to `direct` moves pending notes into
  `notes/` for the next push.
- `decisions.repo`: a private backup of the ledger, which can live on a
  different remote from the knowledge repo. The ledger always publishes directly.
- Writes take a lock under `.harness/tmp/locks/` so parallel agents on one
  machine don't collide on the git index.

## Audit Changes

The audit skill becomes the step that promotes notes. For each active ledger
note, it proposes one outcome:

- **Knowledge:** `mahler knowledge import`, then rewrite it for readers outside
  the issue. Archive the ledger note.
- **Policy or overlay change:** the norm was wrong for this workspace.
- **Repo docs:** design rationale that belongs next to the code.
- **Preference:** an overlay or instruction-file rule.
- **Archive:** a one-off with nothing left to learn.
- **Keep:** a precedent still worth showing sessions.

It also reviews the knowledge store: duplicates to merge, notes that
contradict, notes whose repos or `paths` globs no longer match any file, and
notes whose
`verified:` date is old (or missing) in areas that change often. As today,
the audit applies only what the human approves. In PR mode, its knowledge edits
go through one PR per audit.

## Migration

Nothing breaks on upgrade. Install creates `.harness/knowledge/`, and sessions
read the brief's Relevant Knowledge section (empty until notes exist) plus the
ledger index. Doctor warns when the active ledger has more than about 20 notes
and suggests an audit. For a workspace with a large ledger, the first audit
sorts its notes using the outcomes above. Most become knowledge through `import`.

## Policy and Template Changes

- New `policies/knowledge.md`: what counts as knowledge, how to write a note
  (claim title, self-contained description, one fact, search before writing,
  no secrets), and when to update or retire one.
- `policies/judgment.md` and `policies/handoff.md`: the ledger is for
  deviations only, and sessions read its index rather than every note.
- Templates `root-agent-block`, `adapter`, `workflow`, `agent-session`, and
  `decisions-readme` get the new session-start steps. There's also a new
  `knowledge-readme`.
- `skills/audit`: the outcomes above.
- `skills/work-on-issue` and `skills/handoff`: the learn step, and the search
  step before working in an unfamiliar area.
- `skills/conduct`: a paths search after deciding the shape, before
  implementing.
- `policies/review.md` and the reviewer brief: a paths search on the diff,
  with any note the change contradicts reported as a finding.

## Delivery

Each item is one issue, risk medium unless noted:

1. **Local knowledge store.** Note format, `learn`, `verify`, `knowledge
   index` and `search` (terms, paths, and changed files), the ledger's
   generated index, the Relevant Knowledge section in briefs, the knowledge policy, the session-start changes, and the paths
   searches in conduct and review. Done when a fresh workspace can learn a
   note, find it by terms and by a changed file, see it in a new brief, and no
   session instruction still says to read the whole ledger.
2. **Ledger narrowing and audit promotion.** `knowledge import`, the ledger
   `description` line and index, audit outcomes, and the doctor warning. Done
   when a copy of a large existing ledger can be sorted by an audit with every note
   reaching an outcome.
3. **Repo mode, direct publish.** Clone on install, `sync`, push with one
   rebase retry, gitignored index, lock. Done when two clones of one
   workspace's knowledge repo each see the other's new note after `sync`.
4. **Repo mode, PR publish.** Branch and PR per note, `pending/`, cleanup on
   merge or close. Done when a pending note is searchable locally before its
   PR merges and disappears from `pending/` after.
5. **Ledger repo backup** (low). `decisions.repo` with direct publish.

## Decided

- **Knowledge PRs:** the human reviews and merges them, since the store is
  shared between agents and the human.
- **Scope:** one knowledge store per workspace.
- **Verified dates:** notes carry `verified:`, refreshed when an agent
  confirms a note still holds.
- **Name:** "knowledge" in commands and paths.
- **Relevance:** briefs match on tags, then repos; conductors and reviewers
  match on `paths` against the files being changed.

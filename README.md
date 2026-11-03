# Mahler

Mahler (as in Gustav, everyone's favorite composer/conductor) is a workflow
tool for multi-agent software work. A composer agent coordinates conductor
agents, each owning one issue, under a human developer who stays the final
accountable authority. It installs
project-scoped instructions, policies, and helpers so agents can be prompted
with small requests such as:

```sh
work on ISSUE-123
work on project "My Project" in issue tracking
```

Mahler keeps code work task-scoped. Project prompts resolve to individual
issues before any code workspace is created: a composer plans all of them, and
other roles pick one.

## Principles

- The human developer is the final accountable authority for quality,
  integration, merge, and release — not modeled as an agent.
- Agents form a hierarchy: a **composer** (the default role and primary
  interface to the human) plans multi-issue work and dispatches one
  **conductor** per issue. A conductor does the work itself by default and
  delegates slices to other conductors in **slice mode** only when the issue
  spans repos, splits into parallel parts, or is too large for one PR. A
  **reviewer** (read-only) reviews every diff, and a **tester** writes
  acceptance tests from the spec without reading the code. Agents pause at
  Tier 2 boundaries for their parent's go-ahead.
- The human doesn't review code by default. They write project-level
  acceptance criteria, and agents earn their trust with verification scaled
  to risk. Every issue or local task carries a risk level (`risk:low`,
  `risk:medium`, `risk:high`) set when it is written and only ever raised.
  Low risk gets the implementer's tests and a light review. Medium risk adds a
  tester after implementation whose tests must pass. High risk has the tester
  write tests before implementation, on a different model, plus a deep review
  and a rollout plan. Tester tests are frozen: `mahler check` fails if anyone
  else changes them, and disputes go to the composer.
- A project's acceptance suite lives in a repo of its own or in a directory
  of a shared repo (`acceptance` in `.harness/config.json`). `mahler
  acceptance run` tests each issue's worktrees, and base branches elsewhere,
  against it.
- Delegation costs tokens, so it must earn its place. The `delegate` skill
  decides whether to launch a sub-agent and on which **model tier**: named
  per-install tiers (`models` overrides in `.harness/config.json`, listed in
  `.harness/MODELS.md`) map to a model and
  reasoning effort per runtime, or hand a role to another skill, agent type, or
  shell command (for example a Codex review of Claude's work). A tier may name a
  `fallback` tier, such as a Claude review when Codex is out of usage, so agents
  switch instead of waiting. `concurrency` caps parallel agents and heavy
  commands, and `mahler capacity` reports machine load against them.
- Merging is a Tier 2 action only the composer takes, and only once the
  risk level's verification and the readiness checks pass. Labels in
  `merge.humanReviewLabels` (default `human-review`) always send a PR to the
  human. A PR that changes a path in `merge.humanReviewPaths` goes to the
  human unless a label in `merge.agentMergeLabels` (default `agent-merge`)
  pre-approves it. Otherwise the composer merges, at any risk level.
- Sub-agent delegation uses native/runtime agent capabilities plus the installed
  `sub-agent-delegation` policy and brief template. Sub-agents are read-only by
  default unless their brief explicitly grants scoped edit authority.
- Tasks are the atomic unit for code changes, commits, and PRs: a Linear
  issue, or a local task (`mahler task`) agreed in conversation when Linear
  would be more ceremony than the work needs. Agents write them with the
  `write-issue` skill, whose acceptance criteria a tester can check without
  seeing the code.
- A PR is one deliverable that can be reverted on its own, with a short
  description, its verification record, and proof that it works (attached
  with `gh --attach`). Dependent PRs form a GitHub stack (`gh stack`) that
  merges in one step.
- Agents create dedicated git worktrees only for the repos needed by a task,
  preferably under `workspaces/issues/<ISSUE>/repos/`.
- Policies live in canonical Mahler modules and are rendered into
  workspace-local Claude/Codex instruction surfaces.
- Skills compose policies into named workflows, and agent profiles declare
  which skills each role can use.
- Generated markdown (`WORKFLOW.md`, issue briefs, runtime adapters, agent
  definitions, installed READMEs) is rendered from `templates/*.md`; the
  TypeScript only fills `{{placeholders}}`.
- Linear MCP is the preferred source of issue and project context. If an agent
  can't fetch a named Linear issue, it must ask for missing metadata instead of
  inventing it.

## Commands

```sh
npm install -g https://github.com/gdamron/mahler/releases/download/v2026.11.0/mahler-2026.11.0.tgz   # pinned; see INSTALL.md
mahler --version
mahler install /path/to/product-workspace --linear-assignee gonzo --linear-label agent
mahler issue DEV-123 --workspace /path/to/product-workspace --agent codex
mahler task curved-declick --workspace /path/to/product-workspace --agent claude --task-file task.json
mahler project "Project X" --workspace /path/to/product-workspace --agent claude --linear-file project.json
mahler status --workspace /path/to/product-workspace
mahler profile codex --workspace /path/to/product-workspace
mahler can codex commit --workspace /path/to/product-workspace
mahler handoff DEV-123 --workspace /path/to/product-workspace --agent codex
mahler decide --rule scope --description "Fixed an adjacent bug in scope" --reason "expanded to fix adjacent bug" --issue DEV-123 --agent codex --workspace /path/to/product-workspace
mahler check --workspace /path/to/product-workspace [--repo <name>] [--issue DEV-123 | --path <worktree>]
mahler acceptance freeze --workspace /path/to/product-workspace --issue DEV-123 --repo <name> --commit <sha|base..sha> [--reason "<dispute decision>"]
mahler acceptance freeze --workspace /path/to/product-workspace --project <slug> --repo <name> --commit <sha>
mahler acceptance manifest --workspace /path/to/product-workspace --issue DEV-123 | --project <slug>
mahler acceptance run --workspace /path/to/product-workspace --project <slug> [--issue DEV-123]
mahler capacity --workspace /path/to/product-workspace
mahler cleanup DEV-123 --workspace /path/to/product-workspace [--dry-run]
mahler doctor /path/to/product-workspace
mahler linear-template issue
mahler linear-template project
mahler linear-template task
mahler <command> --help
```

`--help` (or `-h`) on any command prints its usage and does nothing else.
Commands reject options they don't know, extra arguments, and options missing
their value, so a mistyped command stops before it writes or deletes anything.

`mahler install` scans the target workspace for immediate child git repos and
writes them into `.harness/config.json`. Linear assignee and label filters are
explicit install options; Mahler does not ship a default assignee. When a repo
has a `package.json`, install pre-populates per-repo `checks` (test/lint/build
commands) from its scripts; edit `.harness/config.json` to adjust them.
Reinstalling keeps human-set config: the Mahler command, worktree root, Linear
filters, repo checks, merge labels and paths, risk labels, the acceptance
suite, each runtime's agent profile, the knowledge and decisions settings, and
changes to Mahler's default model tiers, concurrency caps, guardrails, and
Definition of Done, which are stored as overrides so new defaults still arrive (see
[INSTALL.md](INSTALL.md#what-reinstall-keeps)).

`mahler check` is a local mirror of CI: it runs each repo's configured check
commands and reports ok/fail per command. With `--issue` it checks every
worktree under the issue's `repos/` dir, including slice worktrees such as
`repos/<repo>-<slice>`, and fails if there are none; with `--path` it checks a
single worktree; otherwise it checks each source repo. It also fails when a
worktree changes frozen acceptance tests, and notes changes to
`merge.humanReviewPaths`. It is local feedback — the forge/CI remains the
Tier 3 authority.

`mahler task` writes a local task brief under `.harness/issues/local-<slug>/`,
in the same layout as an issue brief, from a task file (`mahler
linear-template task`) or `--title`, `--description`, and `--risk`.

`mahler acceptance freeze` records the commit that holds a tester's
acceptance tests, for an issue or a project; changing a frozen set needs
`--reason` with the dispute decision, and the old set stays in the history.
`mahler acceptance run` writes a revision manifest (each repo's issue
worktree, or its base branch) and runs `acceptance.run` with `<manifest>` and
`<project>` filled in.

`mahler capacity` prints CPU cores, load average, and the `concurrency` caps
from `.harness/config.json`, with an ok/busy verdict. Agents run it before
launching parallel agents or heavy commands. Like `check`, it is advisory.

`mahler cleanup` removes an issue's worktrees once its PRs are merged, keeping
branches and the issue brief. It refuses to remove a worktree with uncommitted
or untracked changes. Finished worktrees otherwise keep costing disk, and on
macOS, Spotlight indexing; `mahler doctor` reports when Spotlight is indexing
the worktree root (exclude it in System Settings → Spotlight → Search Privacy;
folder markers such as `.metadata_never_index` are not honored there).

`mahler learn` records what an agent learned about the code, tools, or project
as a note in the knowledge store (`.harness/knowledge/notes/<slug>.md` by
default): one fact per note, with a title that states the fact, a one-line
description, tags, repos, and the file paths it is about. Notes are plain
markdown that opens as an Obsidian vault, and agents correct them in place
rather than piling up near-duplicates. Sessions don't read every note: each
brief gets a `Relevant Knowledge` section matched on the issue's words and
repos, conductors and reviewers run `mahler knowledge search --changed` to
find notes about the files being changed, and `mahler knowledge search
<terms>` covers the rest. `mahler knowledge verify` marks a note confirmed, so the
audit can find notes nobody has checked in a long time.

The store is a local folder by default. To share it between machines and
people working in the same workspace, set `knowledge.repo` (and optionally
`knowledge.branch`) in `.harness/config.json` and rerun `mahler install`,
which clones the repo into the store folder and carries over any local notes.
From then on `learn`, `verify`, and `import` commit and push, briefs pull
first, and `mahler knowledge sync` does both on demand. The generated
`INDEX.md` stays out of the repo. With `knowledge.publish` set to `"pr"`,
changes go up as pull requests for a human to merge instead: each new note
gets its own PR and waits in `pending/` (still searchable on that machine),
and edits to existing notes go up together in one open PR that each sync
keeps current.

`mahler decide` appends a note to the decisions ledger
(`.harness/decisions/<YYYY-MM-DD>-<slug>.md`): the cross-session record of
Tier-1 deviations and the reasons behind them. Only deviations whose reason
_generalizes beyond the issue that produced them_ belong here; purely
issue-local calls stay in `HANDOFF.md`, and facts about the code go in the
knowledge store. Sessions read the generated `INDEX.md`, not every note. The
ledger is append-only, and humans curate it, promoting recurring decisions
into policy and moving stale notes to `.harness/decisions/archive/`. The
composer's `audit` skill helps: now and then it reviews the ledger, the
knowledge store, overlays, instruction files, and config, and proposes what
to archive, promote, update, or drop, for the human to approve. A ledger note
that turns out to be a fact about the code moves to the knowledge store with
`mahler knowledge import`. `mahler doctor` warns when the active ledger
passes 20 notes.

To back the ledger up, set `decisions.repo` (and optionally
`decisions.branch`) in `.harness/config.json` and rerun `mahler install`,
which clones the repo into `.harness/decisions/` and carries over the notes
already there. It can be its own repo, or the knowledge repo on another
branch. `mahler decide` and `mahler knowledge import --archive` then commit
and push, and briefs and `mahler knowledge sync` pull and push. The ledger
always pushes directly, never through PRs. When two machines record notes
with the same name, the one pushed second is renamed (`-2`), so both are kept.

Install compiles canonical Mahler source into native agent artifacts:

- Codex project skills in `.agents/skills/`
- Codex project agents in `.codex/agents/`
- Claude project skills in `.claude/skills/`
- Claude project agents in `.claude/agents/`
- Shared config, policies, profiles, and install state in `.harness/`

Use `mahler profile <agent>` and `mahler can <agent> <skill>` to inspect the
active profile gate. Review, commit, PR, and handoff behavior lives in the
generated native skills rather than CLI workflow commands.

Run `mahler doctor <workspace>` after install (or any time) to verify the
configured repos, policies, skills, profiles, and adapter docs. It exits
non-zero with a clear message if anything is missing, and warns when a profile
allows a skill that is not installed.

### Customizing a workspace

The install set is discovered by scanning Mahler's canonical source, so new
policies, skills, and profiles install automatically. To adapt the workflow for
one workspace without forking Mahler, drop files under
`.harness/custom/{policies,skills,agents}/`:

- A custom file with the **same name** as a Mahler default **replaces** it.
- A custom file with a **new name** is **added** to the install set.
- Reinstall (`mahler install`) never overwrites anything under `.harness/custom/`.
- Composed markdown carries a provenance header (for example
  `> Mahler default was replaced by .harness/custom/policies/review.md`) so
  agents read a single file. A malformed override fails `install`.

See `.harness/custom/README.md` (written on install) and `INSTALL.md` for details.

Use `mahler linear-template issue|project|task` to print the JSON shape expected by
`--linear-file`. Agents should write temporary Linear MCP metadata under
`.harness/tmp/linear/` in the product workspace before invoking Mahler.

`mahler issue` creates an issue brief under `.harness/issues/<ISSUE>/`. It does
not create branches or worktrees. Agents choose branch names from policy and
create worktrees only for the configured repos needed by the task.

See `INSTALL.md` for agent-facing installation instructions.

`INSTALL.md` also includes a manual dogfood checklist for validating a fresh
Codex or Claude session against a real Linear issue using the generated native
skills and agent definitions.

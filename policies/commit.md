# Commit Policy

## Core Principles

Committing is normally done by a profile that includes the commit skill. Role
fit is a Tier 1 norm (see the judgment policy): a deliberate, recorded
deviation is acceptable; an unrecorded one is not.

### The Save Point Pattern

Commit often and use the "save point" pattern:

```text
Agent starts work
    │
    ├── Makes a change
    │   ├── Test passes? → Commit → Continue
    │   └── Test fails? → Revert to last commit → Investigate
    │
    ├── Makes another change
    │   ├── Test passes? → Commit → Continue
    │   └── Test fails? → Revert to last commit → Investigate
    │
    └── Feature complete → All commits form a clean history
```

This pattern means you never lose more than one increment of work. If an agent
goes off the rails, `git reset --hard HEAD` takes you back to the last successful
state.

Each successful increment gets its own commit: implement a small step, test
it, commit, continue. Don't accumulate large uncommitted changes.

## Pre-Commit Hygiene

- Verify the workspace belongs to the active issue.
- Check `git status`.
- Run the focused tests for what you changed, or record why they were not
  run (a Tier 1 deviation). The full `mahler check` runs once, before you
  push or hand the work on, not before every commit.
- Review the staged diff.
- Do not include co-author metadata.

Before every commit:

```bash
# 1. Check what you're about to commit
git diff --staged

# 2. Ensure no secrets
git diff --staged | grep -i "password\|secret\|api_key\|token"

# 3. Run the focused tests for the change (the repo's own test command,
#    narrowed to what you touched)
```

Before pushing or handing the work on, run the configured checks once, on
committed work:

```bash
# A local mirror of CI. Per-repo commands live under "checks" in
# .harness/config.json; every configured check runs (test, lint, typecheck,
# build, then any others). --issue checks every worktree for the issue;
# --path checks just one.
mahler check --workspace <workspace> --issue <ISSUE>

# Then any checks CI runs that are not configured above (e.g. formatting)
```

`mahler check` skips a check that already passed on the same clean tree, so
running it again after a rebase that changed nothing, or at merge time, costs
nothing. It only remembers passes on committed work: commit first. Pass
`--fresh` when something outside the repo changed (a toolchain, a sibling
repo the checks build against).

### Generated Files

Commit generated files only when the project expects them (a lockfile, a
migration). Never commit build output, environment files, or personal IDE
config; the repo's `.gitignore` should cover them.

## Committing

### Descriptive Messages

Commit messages explain the _why_, not just the _what_:

```text
# Good: Explains intent
feat: add email validation to registration endpoint

Prevents invalid email formats from reaching the database.
Uses Zod schema validation at the route handler level,
consistent with existing validation patterns in auth.ts.

# Bad: Describes what's obvious from the diff
update auth.ts
```

But they should still be concise.

**Format:**

```text
<type>: <short description>

<optional body explaining why, not what>
```

**Types:**

- `feat` — New feature
- `fix` — Bug fix
- `refactor` — Code change that neither fixes a bug nor adds a feature
- `test` — Adding or updating tests
- `docs` — Documentation only
- `chore` — Tooling, dependencies, config

Avoid amending commits after pushing, as it rewrites history. If you need to fix
a commit, add a new commit that corrects the issue instead.

### Authorship

Your human collaborator is responsible for the work. Do not include co-authoring
notes to commits, "generate by" messages to PRs, or anything similar.

### Keep Concerns Separate

Don't combine formatting changes with behavior changes, or refactors with
features. Each is its own commit, and a refactor and a feature are ideally
separate PRs: each is then easier to review, revert, and find in history. A
small cleanup (renaming a variable) can ride along in a feature commit.

### Size Your Changes

A commit is one logical step that leaves the tests passing, so it can be
reverted or bisected on its own. Small commits are save points, not a review
courtesy. PR size follows the pr policy: one deliverable per PR, with stacks
for dependent parts.

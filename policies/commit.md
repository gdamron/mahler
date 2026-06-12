# Commit Policy

## Core Principles

Committing is normally done by a profile that includes the commit skill. Role
fit is a Tier 1 norm (see the judgment policy): a deliberate, recorded
deviation is acceptable; an unrecorded one is not. Pushing is a Tier 2 action
that needs explicit human go-ahead.

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

### Commit Early, Commit Often

Each successful increment gets its own commit. Don't accumulate large uncommitted
changes.

```text
Work pattern:
  Implement small slice → Test → Verify → Commit → Next small slice

Not this:
  Implement everything → Hope it works → Giant commit
```

Commits are save points. If the next change breaks something, you can revert to
the last known-good state instantly.

## Pre-Commit Hygiene

- Verify the workspace belongs to the active issue.
- Check `git status`.
- Run relevant tests or record why they were not run (a Tier 1 deviation).
- Review the staged diff.
- Do not include co-author metadata.

Before every commit:

```bash
# 1. Check what you're about to commit
git diff --staged

# 2. Ensure no secrets
git diff --staged | grep -i "password\|secret\|api_key\|token"

# 3. Run the configured checks for touched repos — a local mirror of CI.
#    Per-repo commands live under "checks" in .harness/config.json.
mahler check --workspace <workspace> --issue <ISSUE>

# 4. Run additional checks not configured above (e.g. type checking, formatting)
```

### Handling Generated Files

- **Commit generated files** only if the project expects them (e.g.,
  `package-lock.json`, Prisma migrations)
- **Don't commit** build output (`dist/`, `.next/`), environment files (`.env`),
  or IDE config (`.vscode/settings.json` unless shared)
- **Have a `.gitignore`** that covers: `node_modules/`, `dist/`, `.env`,
  `.env.local`, `*.pem`

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

Don't combine formatting changes with behavior changes. Don't combine refactors
with features. Each type of change should be a separate commit — and ideally a
separate PR:

```text
# Good: Separate concerns
git commit -m "refactor: extract validation logic to shared utility"
git commit -m "feat: add phone number validation to registration"

# Bad: Mixed concerns
git commit -m "refactor validation and add phone number field"
```

**Separate refactoring from feature work.** A refactoring change and a feature
change are two different changes — submit them separately. This makes each
change easier to review, revert, and understand in history. Small cleanups
(renaming a variable) can be included in a feature commit at reviewer discretion.

### Size Your Changes

Target ~100 lines per commit/PR. Changes over ~1000 lines should be split.

```text
~100 lines  → Easy to review, easy to revert
~300 lines  → Acceptable for a single logical change
~1000 lines → Split into smaller changes
```

## Verification

For every commit:

- [ ] Commit does one logical thing
- [ ] Message explains the why, follows type conventions
- [ ] Tests pass before committing
- [ ] No secrets in the diff
- [ ] No formatting-only changes mixed with behavior changes
- [ ] `.gitignore` covers standard exclusions

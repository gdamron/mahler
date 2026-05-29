# Branching Policy

## Use Trunk-Based Development

Keep the `main` branch stable and deployable at all times. Work in short-lived
feature branches that merge back within 1-3 days. When working, constantly ask
yourself "is it time to commit?" and "is time to open a PR?" Long-lived
development branches are hidden costs — they diverge, create merge conflicts,
and delay integration. DORA research consistently shows trunk-based development
correlates with high-performing engineering teams.

The `main` branch should always be stable and deployable.

This is the recommended default. Use this process unless a team or project
explicitly documents otherwise. For example, use gitflow if that process is
specified.

- **Dev branches are costs.** Every day a branch lives, it accumulates merge risk.
- **Release branches are acceptable.** When you need to stabilize a release while
  main moves forward.
- **Feature flags > long branches.** Prefer deploying incomplete work behind
  flags rather than keeping it on a branch for weeks.

## Branches

### Use Feature Branches

```text
main (always deployable)
  │
  ├── username/dev-1-task-creation    ← One feature per branch
  ├── username/dev-2-user-settings    ← Parallel work
  └── username/dev-3-fix-duplicate-tasks      ← Bug fixes
```

- Branch from `main` (or the team's default branch). Never work directly on `main`.
- Keep branches short-lived (merge within 1-3 days) — long-lived branches are
  hidden costs
- Delete branches after merge. This should be automatic after merging a PR, but
  always verify.
- Prefer feature flags over long-lived branches for incomplete features

Branches should follow a naming convention such as:

```text
<username>/<issue-name>-<short-description>   → feature/task-creation
```

- The username is the current human user (e.g. `gdamron`)
- The issue name is the relevant issue or ticket number, if available (e.g. `dev-123`)
- The short description is a concise summary of the change (e.g. `task-creation`)

Issue tracking software such as Linear often recommend branch names. Use them,
but you may shorten the description segment if it exceeds 5 words.

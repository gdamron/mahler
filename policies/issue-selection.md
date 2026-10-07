# Issue Selection Policy

Linear issues are the atomic unit of implementation, commits, and PRs.

When asked to work on a specific issue:

1. Use Linear MCP to fetch the issue title, description, status, labels, assignee,
   blockers, and project.
2. Run the Mahler issue workflow for that identifier.
3. If Linear MCP is unavailable or the issue metadata is incomplete, stop and ask
   the human for the missing context.

When asked to work on a Linear project:

1. Use Linear MCP to fetch project details and open project issues.
2. Select one eligible issue before doing code work.
3. Eligible issues must be open, unblocked, not already active in a workspace,
   assigned to a configured accepted agent user, and tagged with every configured
   required label.
4. Break ties by Linear priority first, then oldest update/create timestamp.
5. Run the normal issue workflow for the selected issue.

When a composer is asked to work on a Linear project or a set of issues:

1. Apply the same eligibility rules to every open project issue (explicitly
   named issues are in scope as named).
2. Order them by blockers, then priority, then oldest update/create timestamp,
   and group independent issues into waves in `COMPOSITION.md`.
3. Dispatch one conductor per issue; each runs the normal issue workflow.

Do not create code changes directly from a project-level prompt.

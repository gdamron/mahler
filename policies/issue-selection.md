# Issue Selection Policy

Linear issues are the atomic unit of implementation, commits, and PRs.

When asked to work on a specific issue:

1. Use Linear MCP to fetch the issue title, description, status, labels, assignee, blockers, and project.
2. Run the Mahler issue workflow for that identifier.
3. If Linear MCP is unavailable or the issue metadata is incomplete, stop and ask the human for the missing context.

When asked to work on a Linear project:

1. Use Linear MCP to fetch project details and open project issues.
2. Select one eligible issue before doing code work.
3. Eligible issues must be open, unblocked, not already active in a workspace, assigned to a configured accepted agent user, and tagged with every configured required label.
4. Break ties by Linear priority first, then oldest update/create timestamp.
5. Run the normal issue workflow for the selected issue.

Do not create code changes directly from a project-level prompt.

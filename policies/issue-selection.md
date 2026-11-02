# Issue Selection Policy

An issue is the atomic unit of implementation, commits, and PRs. Most come
from Linear; a local task, agreed in conversation, is the same unit without
Linear.

When asked to work on a specific issue:

1. Use Linear MCP to fetch the issue title, description, status, labels, assignee,
   blockers, and project.
2. Run the Mahler issue workflow for that identifier.
3. If the named issue can't be fetched from Linear, or its metadata is
   incomplete, stop and ask the human for the missing context.

When the human describes work in conversation instead of naming an issue:

1. Agree on the task first, written with the write-issue skill: a title,
   acceptance criteria, non-goals, and a risk level with its reason.
2. Write it with `mahler task <slug> --task-file <task.json>` (template:
   `mahler linear-template task`). The identifier is `local-<slug>`, and the
   brief has the same layout as an issue's.
3. Wait for the human's go-ahead on the criteria and risk, then run the normal
   issue workflow for `local-<slug>`. Don't stop because there is no Linear
   issue.

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

---
name: select-project-issue
description: Resolve a Linear project prompt to one eligible issue and create its brief.
---

# Select Project Issue

## Triggers

- "work on project X in Linear"
- "pick up project X"
- "start on Linear project X"

## Required Policies

- judgment
- issue-selection
- interview
- workspace-safety
- handoff

## Allowed Commands

- `mahler linear-template project`
- `mahler project <PROJECT> --agent <agent> --linear-file <project.json>`
- Linear MCP project and issue lookup

## Expected Inputs

- Linear project name or ID
- Linear project metadata and issue list from MCP

## Linear MCP Resolution

1. Use Linear MCP `get_project` with the requested project name or ID.
2. Use Linear MCP `list_issues` for that project.
3. If project lookup fails, issue lookup fails, or required fields are missing,
   stop and ask the human for the missing metadata.
4. Map MCP fields into the JSON shape printed by `mahler linear-template project`;
   every issue must include `identifier` and `title`.
5. Write the metadata to `.harness/tmp/linear/<project-slug>.json` in the product
   workspace, creating the directory if needed.
6. Run `mahler project <PROJECT> --agent <agent> --linear-file .harness/tmp/linear/<project-slug>.json`.

## Required Outputs

- One selected eligible issue
- Project brief under `.harness/projects/`
- Generated issue brief for the selected issue

## Stop Conditions

- Linear MCP is unavailable
- Linear project metadata or issue list is unavailable or incomplete
- no eligible issue matches configured assignee and label filters
- selected issue is blocked or already active in another workspace
- active profile does not allow this skill

# Skill: Select Project Issue

## Triggers

- "work on project X in Linear"
- "pick up project X"
- "start on Linear project X"

## Required Policies

- issue-selection
- workspace-safety
- handoff

## Allowed Commands

- `mahler project <PROJECT> --agent <agent> --linear-file <project.json>`
- Linear MCP project and issue lookup

## Expected Inputs

- Linear project name or ID
- Linear project metadata and issue list from MCP

## Required Outputs

- One selected eligible issue
- Project brief under `workspaces/projects/`
- Generated issue workspace for the selected issue

## Stop Conditions

- Linear MCP is unavailable
- no eligible issue matches configured assignee and label filters
- selected issue is blocked or already active in another workspace
- active profile does not allow this skill

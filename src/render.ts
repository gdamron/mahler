import type { AgentName, HarnessConfig, LinearIssue, LinearProject } from "./types.js";

export function workflowMarkdown(): string {
  return `# Mahler Workflow

This workspace uses Mahler for human-orchestrated multi-agent development.

## What To Do When Prompted

- If asked to "work on FUG-123", run the Mahler issue workflow for that issue.
- If asked to "work on project X in Linear", use Linear MCP to inspect the project, select one eligible issue, then run the issue workflow.
- Do not edit code in the product workspace root.
- Do not edit sibling issue workspaces.
- Before changing code, read the generated issue workspace files: \`TASK.md\`, \`AGENT_SESSION.md\`, and \`HANDOFF.md\`.
- Before stopping, update \`HANDOFF.md\` with changed files, tests run, blockers, and next steps.

## Atomic Unit

Linear issues are the atomic unit for code changes, commits, and PRs. Project prompts are issue-selection prompts.

## Linear Selection Rules

For project prompts, select the highest-priority issue that:

- is open and unblocked,
- is not already active in a workspace,
- is assigned to an accepted configured agent user,
- has all required configured labels.

Tie-break by priority first, then oldest update/create timestamp.

## Human Orchestration

The human remains responsible for final review and merge decisions unless a prompt explicitly delegates a narrower action.
`;
}

export function rootAgentBlock(config: HarnessConfig): string {
  return `\n## Mahler Workflow\n\nThis workspace uses Mahler. If prompted to work on a Linear issue or project, follow \`WORKFLOW.md\`, the workspace-local skills under \`.harness/skills/\`, and policy modules under \`.harness/policies/\`.\n\n- Issue prompt: use Linear MCP to fetch issue metadata, write it under \`.harness/tmp/linear/\` using \`${config.mahlerCommand} linear-template issue\` as the shape, then run \`${config.mahlerCommand} issue <ISSUE> --agent <codex|claude> --linear-file <issue.json>\`.\n- Project prompt: use Linear MCP to fetch project details and issues, write the metadata under \`.harness/tmp/linear/\` using \`${config.mahlerCommand} linear-template project\` as the shape, then run \`${config.mahlerCommand} project \"<PROJECT>\" --agent <codex|claude> --linear-file <project.json>\`.\n- Work only in generated issue workspaces under \`${config.workspaceDir}/issues/\`.\n- If a requested action is not allowed by the active profile in \`.harness/agents/profiles/\` or Linear metadata is unavailable, stop and ask the human.\n`;
}

export function taskMarkdown(issue: LinearIssue, source: string): string {
  return `# ${issue.identifier}: ${issue.title}

Linear source: ${source}
${issue.url ? `Linear URL: ${issue.url}\n` : ""}
## Description

${issue.description?.trim() || "_No description supplied. If Linear MCP is unavailable, ask the human for missing context before inventing requirements._"}

## Required First Steps

- Read \`AGENT_SESSION.md\`.
- Read \`HANDOFF.md\`.
- Inspect the repo before changing code.
- Keep work scoped to this Linear issue.
`;
}

export function sessionMarkdown(issue: LinearIssue, agent: AgentName, repoPath: string): string {
  return `# Agent Session

- Issue: ${issue.identifier}
- Agent: ${agent}
- Code workspace: ${repoPath}

## Rules

- Work only inside this issue workspace and its repo worktrees.
- Do not edit the product workspace root.
- Follow installed skills in \`.harness/skills/\` and policies in \`.harness/policies/\`.
- Update \`HANDOFF.md\` before stopping.
`;
}

export function handoffMarkdown(issue: LinearIssue): string {
  return `# Handoff: ${issue.identifier}

## Status

- State: not started
- Current owner:
- Blockers:

## Changes

-

## Tests

- Not run yet.

## Next Steps

-
`;
}

export function projectMarkdown(project: LinearProject, selected: LinearIssue, reason: string): string {
  return `# Linear Project: ${project.name}

${project.description?.trim() || "_No project description supplied._"}

## Selected Issue

- ${selected.identifier}: ${selected.title}
- Reason: ${reason}

## Policy

Project prompts resolve to a single eligible Linear issue before code work begins. Continue in the issue workspace for ${selected.identifier}.
`;
}

export function nativeAdapter(agent: "codex" | "claude"): string {
  return `# Mahler Native Adapter: ${agent}

This file is generated from Mahler canonical skills, profiles, and policies.

When the user asks to work on a Linear issue or project:

1. Read \`WORKFLOW.md\`.
2. Read the active profile under \`.harness/agents/profiles/\`.
3. Use the matching skill under \`.harness/skills/\`.
4. Read every policy named by that skill.
5. Use Linear MCP for issue or project details.
6. Write Linear metadata JSON under \`.harness/tmp/linear/\` using \`mahler linear-template issue|project\` as the shape.
7. Run the Mahler command described in \`.harness/config.json\`.
8. Work only in the generated issue workspace.
9. Stop and ask the human if the active profile does not allow the requested skill or Linear metadata is unavailable.

Do not bypass the Mahler workspace setup just because the product repo is visible from the root directory.
`;
}

export function launchCommand(agent: AgentName, repoPath: string, metadataPath: string): string {
  if (agent === "codex") {
    return `codex --cd ${shell(repoPath)} --add-dir ${shell(metadataPath)}`;
  }
  if (agent === "claude") {
    return `claude --add-dir ${shell(metadataPath)} ${shell(repoPath)}`;
  }
  return `<launch ${agent} in ${repoPath} with metadata dir ${metadataPath}>`;
}

function shell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

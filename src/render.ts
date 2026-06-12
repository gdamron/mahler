import type {
  AgentName,
  HarnessConfig,
  InstalledProfile,
  LinearIssue,
  LinearProject,
} from "./types.js";

export function workflowMarkdown(): string {
  return `# Mahler Workflow

This workspace uses Mahler for human-orchestrated multi-agent development.

## What To Do When Prompted

- If asked to "work on FUG-123", run the Mahler issue workflow for that issue brief.
- If asked to "work on project X in Linear", use Linear MCP to inspect the project, select one eligible issue, then create the issue brief.
- Do not edit code in the product workspace root.
- Do not edit sibling issue workspaces.
- Before changing code, read the generated issue brief files: \`TASK.md\`, \`AGENT_SESSION.md\`, and \`HANDOFF.md\`.
- Create git worktrees only for repos needed by the task.
- Prefer project-local worktrees under \`workspaces/issues/<ISSUE>/repos/<repo>\`.
- Choose branch names using \`.harness/policies/branching.md\`; Mahler does not choose branch names for you.
- Record deliberate workflow deviations in \`HANDOFF.md\`.
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
  const codex = config.agents.codex;
  const claude = config.agents.claude;
  const codexProfile = codex
    ? `codex: ${codex.profile}`
    : "codex: configured profile";
  const claudeProfile = claude
    ? `claude: ${claude.profile}`
    : "claude: configured profile";
  const guardrailLines = (config.guardrails ?? []).map((line) => `- ${line}`).join("\n") || "- (none declared)";
  return `\n## Mahler Workflow\n\nThis workspace uses Mahler. Bare prompts like \`work on MAH-123\`, \`start MAH-123\`, or \`work on project X in Linear\` should route through Mahler before code changes so the agent has the issue brief and shared policies.\n\nMahler compiles canonical workflow source into native agent artifacts:\n\n- Codex skills: \`.agents/skills/<skill>/SKILL.md\`\n- Codex agents: \`.codex/agents/<profile>.toml\`\n- Claude skills: \`.claude/skills/<skill>/SKILL.md\`\n- Claude agents: \`.claude/agents/<profile>.md\`\n- Shared config and policies: \`.harness/config.json\` and \`.harness/policies/\`\n\nRecommended routing:\n\n- Active profile check: inspect \`.harness/config.json\` and the active profile in \`.harness/agents/profiles/\` (${codexProfile}; ${claudeProfile}) before choosing a skill.\n- Issue prompt: use the native \`work-on-issue\` skill. It fetches Linear metadata, writes \`.harness/tmp/linear/<ISSUE>.json\`, then runs \`${config.mahlerCommand} issue <ISSUE> --agent <codex|claude> --linear-file <issue.json>\` to create a brief.\n- Project prompt: use the native \`select-project-issue\` skill. It fetches Linear project metadata, writes \`.harness/tmp/linear/<project>.json\`, then runs \`${config.mahlerCommand} project \"<PROJECT>\" --agent <codex|claude> --linear-file <project.json>\`.\n- For review, commit, PR, and handoff prompts, use the matching native skill and the policies it names.\n- Create git worktrees only for repos needed by the task, preferably under \`${config.workspaceDir}/issues/<ISSUE>/repos/<repo>\`.\n- Choose branch names using \`.harness/policies/branching.md\`; Mahler does not choose branch names for agents.\n- Record deliberate workflow deviations in \`.harness/issues/<ISSUE>/HANDOFF.md\`.\n- If the requested skill is outside the active profile, treat it as a Tier 1 deviation: you may proceed deliberately, but record the reason (see \`.harness/policies/judgment.md\`). Stop and ask the human if Linear metadata is unavailable.\n\nGuardrails (Tier 3 — declared here so agents anticipate them; enforced by the forge/CI, not Mahler):\n\n${guardrailLines}\n`;
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
- Decide which configured repos need worktrees for this task.
- Choose branch names using \`.harness/policies/branching.md\`.
- Keep work scoped to this Linear issue.
`;
}

export function sessionMarkdown(
  issue: LinearIssue,
  agent: AgentName,
  recommendedWorktreeRoot: string,
  repos: HarnessConfig["repos"],
  profile?: InstalledProfile,
  guardrails: string[] = [],
): string {
  const repoLines = repos.length === 0
    ? "- (none configured)"
    : repos.map((repo) => `- ${repo.name}: source \`${repo.path}\`, base \`${repo.baseBranch}\`, recommended worktree \`${recommendedWorktreeRoot}/repos/${repo.name}\``).join("\n");
  return `# Agent Session

- Issue: ${issue.identifier}
- Agent: ${agent}
${
  profile
    ? `- Profile: ${profile.name}
- Allowed skills: ${profile.allowedSkills.join(", ") || "(none)"}
- Denied skills: ${profile.deniedSkills.join(", ") || "(none)"}
`
    : ""
}- Recommended worktree root: ${recommendedWorktreeRoot}

## Configured Repos

${repoLines}

## Guardrails (enforced outside Mahler — anticipate them)

${guardrails.length === 0 ? "- (none declared in .harness/config.json)" : guardrails.map((line) => `- ${line}`).join("\n")}

## Rules

- Create worktrees only for repos needed by this task.
- Prefer project-local worktrees under the recommended worktree root.
- Choose short-lived branch names using \`.harness/policies/branching.md\`.
- Do not edit the product workspace root.
- Follow the native installed skills for this agent and policies in \`.harness/policies/\`.
- Record deliberate workflow deviations in \`HANDOFF.md\`.
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

## Workflow Deviations

- None recorded.
`;
}

export function projectMarkdown(
  project: LinearProject,
  selected: LinearIssue,
  reason: string,
): string {
  return `# Linear Project: ${project.name}

${project.description?.trim() || "_No project description supplied._"}

## Selected Issue

- ${selected.identifier}: ${selected.title}
- Reason: ${reason}

## Policy

Project prompts resolve to a single eligible Linear issue before code work begins. Continue from the issue brief for ${selected.identifier}.
`;
}

export function nativeAdapter(agent: "codex" | "claude"): string {
  if (agent === "codex") return codexAdapter();
  return claudeAdapter();
}

function codexAdapter(): string {
  return `# Mahler Native Adapter: Codex

This file is generated from Mahler canonical skills, profiles, and policies.

## Prompt Routing

When the user asks to work on a Linear issue or project, including bare prompts like \`work on MAH-123\`:

1. Read \`WORKFLOW.md\`.
2. Read \`.harness/config.json\` to identify the active Codex profile.
3. Read that profile under \`.harness/agents/profiles/\`.
4. For \`work on ISSUE-123\`, use \`.agents/skills/work-on-issue/SKILL.md\`.
5. For project prompts, use \`.agents/skills/select-project-issue/SKILL.md\`.
6. Read every policy named by the selected skill from \`.harness/policies/\`.
7. Use Linear MCP for issue or project details.
8. Write Linear metadata JSON under \`.harness/tmp/linear/\` using \`mahler linear-template issue|project\` as the shape.
9. Run the Mahler command described in \`.harness/config.json\` to create the issue brief.
10. Decide which configured repos need worktrees, choose branch names using \`.harness/policies/branching.md\`, and create only those worktrees.
11. Prefer project-local worktrees under \`workspaces/issues/<ISSUE>/repos/<repo>\`.
12. Record deliberate workflow deviations in \`HANDOFF.md\`.
13. Stop and ask the human if the active profile does not allow the requested skill or Linear metadata is unavailable.

Do not skip the Mahler issue brief just because the product repo is visible from the root directory.
`;
}

function claudeAdapter(): string {
  return `# Mahler Native Adapter: Claude

This file is generated from Mahler canonical skills, profiles, and policies.

## Prompt Routing

When the user asks to work on a Linear issue or project, including bare prompts like \`work on MAH-123\`:

1. Read \`WORKFLOW.md\`.
2. Read \`.harness/config.json\` to identify the active Claude profile.
3. Read that profile under \`.harness/agents/profiles/\`.
4. For \`work on ISSUE-123\`, use \`.claude/skills/work-on-issue/SKILL.md\`.
5. For project prompts, use \`.claude/skills/select-project-issue/SKILL.md\`.
6. Read every policy named by the selected skill from \`.harness/policies/\`.
7. Use Linear MCP for issue or project details.
8. Write Linear metadata JSON under \`.harness/tmp/linear/\` using \`mahler linear-template issue|project\` as the shape.
9. Run the Mahler command described in \`.harness/config.json\` to create the issue brief.
10. Decide which configured repos need worktrees, choose branch names using \`.harness/policies/branching.md\`, and create only those worktrees.
11. Prefer project-local worktrees under \`workspaces/issues/<ISSUE>/repos/<repo>\`.
12. Record deliberate workflow deviations in \`HANDOFF.md\`.
13. Stop and ask the human if the active profile does not allow the requested skill or Linear metadata is unavailable.

Project-local Claude instructions in \`CLAUDE.md\` intentionally point back to these canonical installed skills and policies.
`;
}

export function codexAgentDefinition(profile: InstalledProfile): string {
  return `# Generated by Mahler. Edit agents/${profile.name}.json, then rerun mahler install.
name = "${tomlString(profile.name)}"
description = "${tomlString(profile.description ?? `${profile.name} Mahler profile`)}"

developer_instructions = """
You are operating with the Mahler ${profile.name} profile.

Allowed skills: ${profile.allowedSkills.join(", ") || "(none)"}
Denied skills: ${profile.deniedSkills.join(", ") || "(none)"}

Before choosing a workflow skill, read .harness/config.json and .harness/agents/profiles/${profile.name}.json. Use the native skill under .agents/skills/<skill>/SKILL.md only if this profile allows it. If a requested skill is denied, stop and ask the human to switch profiles or delegate the workflow.
"""
`;
}

export function claudeAgentDefinition(profile: InstalledProfile): string {
  return `---
name: ${profile.name}
description: ${profile.description ?? `${profile.name} Mahler profile`}
---

# Mahler ${profile.name} Profile

Generated by Mahler. Edit \`agents/${profile.name}.json\`, then rerun \`mahler install\`.

Allowed skills: ${profile.allowedSkills.join(", ") || "(none)"}
Denied skills: ${profile.deniedSkills.join(", ") || "(none)"}

Before choosing a workflow skill, read \`.harness/config.json\` and \`.harness/agents/profiles/${profile.name}.json\`. Use the native skill under \`.claude/skills/<skill>/SKILL.md\` only if this profile allows it. If a requested skill is denied, stop and ask the human to switch profiles or delegate the workflow.
`;
}

export function launchCommand(
  agent: AgentName,
  repoPath: string,
  metadataPath: string,
): string {
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

function tomlString(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n");
}

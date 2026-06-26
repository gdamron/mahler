import type {
  AgentName,
  HarnessConfig,
  InstalledProfile,
  LinearIssue,
  LinearProject,
} from "./types.js";

export function workflowMarkdown(): string {
  return `# Mahler Workflow

This workspace uses Mahler for multi-agent development. An **orchestrator agent** coordinates the work; the **human developer** stays the final accountable authority.

## What To Do When Prompted

- If asked to "work on FUG-123", run the Mahler issue workflow for that issue brief.
- If asked to "work on project X in Linear", use Linear MCP to inspect the project, select one eligible issue, then create the issue brief.
- Do not edit code in the product workspace root.
- Do not edit sibling issue workspaces.
- Before changing code, read the generated issue brief files: \`TASK.md\`, \`AGENT_SESSION.md\`, and \`HANDOFF.md\`.
- Create git worktrees only for repos needed by the task.
- Prefer project-local worktrees under \`workspaces/issues/<ISSUE>/repos/<repo>\`.
- Choose branch names using \`.harness/policies/branching.md\`; Mahler does not choose branch names for you.
- At session start, read the active \`.harness/decisions/\` ledger (not \`archive/\`) to recover durable decisions from earlier sessions.
- Record deliberate workflow deviations in \`HANDOFF.md\`; only when the reason generalizes beyond this issue, also append a note with \`mahler decide\` to \`.harness/decisions/\`.
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

## Roles

- **Human developer** — the final accountable authority for quality, integration, merge, and release. Owns final review and merge decisions unless a prompt explicitly delegates a narrower action. The human is not modeled as an agent.
- **Orchestrator agent** — the default coordinating role and the primary interface to the human developer: it surfaces risks to the human, reports synthesis, and asks for direction. It plans agent-level work, delegates scoped slices to sub-agents, coordinates sub-agents, synthesizes their outputs, and runs quality checks within the bounds of the delegated work. It is empowered to take any action directly when delegation is not warranted, pausing at Tier 2 boundaries (push/PR) for human go-ahead.
- **Sub-agents** — scoped specialist agents launched and delegated by the orchestrator for a specific slice of the task.

Tier 2 actions (push, PR) and Tier 3 guardrails (base-branch merge, CI) still apply: the orchestrator pauses for human go-ahead and never bypasses the forge.
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
  return `\n## Mahler Workflow\n\nThis workspace uses Mahler. Bare prompts like \`work on MAH-123\`, \`start MAH-123\`, or \`work on project X in Linear\` should route through Mahler before code changes so the agent has the issue brief and shared policies.\n\nMahler compiles canonical workflow source into native agent artifacts:\n\n- Codex skills: \`.agents/skills/<skill>/SKILL.md\`\n- Codex agents: \`.codex/agents/<profile>.toml\`\n- Claude skills: \`.claude/skills/<skill>/SKILL.md\`\n- Claude agents: \`.claude/agents/<profile>.md\`\n- Shared config and policies: \`.harness/config.json\` and \`.harness/policies/\`\n\nRecommended routing:\n\n- Active profile check: inspect \`.harness/config.json\` and the active profile in \`.harness/agents/profiles/\` (${codexProfile}; ${claudeProfile}) before choosing a skill.\n- Issue prompt: use the native \`work-on-issue\` skill. It fetches Linear metadata, writes \`.harness/tmp/linear/<ISSUE>.json\`, then runs \`${config.mahlerCommand} issue <ISSUE> --agent <codex|claude> --linear-file <issue.json>\` to create a brief.\n- Project prompt: use the native \`select-project-issue\` skill. It fetches Linear project metadata, writes \`.harness/tmp/linear/<project>.json\`, then runs \`${config.mahlerCommand} project \"<PROJECT>\" --agent <codex|claude> --linear-file <project.json>\`.\n- For review, commit, PR, and handoff prompts, use the matching native skill and the policies it names.\n- Create git worktrees only for repos needed by the task, preferably under \`${config.workspaceDir}/issues/<ISSUE>/repos/<repo>\`.\n- Choose branch names using \`.harness/policies/branching.md\`; Mahler does not choose branch names for agents.\n- Record deliberate workflow deviations in \`.harness/issues/<ISSUE>/HANDOFF.md\`; only when the reason generalizes beyond this issue, also append a note with \`mahler decide\` to \`.harness/decisions/\`. Read the active ledger (not \`archive/\`) at session start to recover durable decisions.\n- If the requested skill is outside the active profile, treat it as a Tier 1 deviation: you may proceed deliberately, but record the reason (see \`.harness/policies/judgment.md\`). Stop and ask the human if Linear metadata is unavailable.\n\nGuardrails (Tier 3 — declared here so agents anticipate them; enforced by the forge/CI, not Mahler):\n\n${guardrailLines}\n`;
}

export function taskMarkdown(
  issue: LinearIssue,
  source: string,
  definitionOfDone: string[] = [],
): string {
  return `# ${issue.identifier}: ${issue.title}

Linear source: ${source}
${issue.url ? `Linear URL: ${issue.url}\n` : ""}
## Description

${issue.description?.trim() || "_No description supplied. If Linear MCP is unavailable, ask the human for missing context before inventing requirements._"}
${issueContextMarkdown(issue)}

## Definition of Done

${definitionOfDoneChecklist(issue, definitionOfDone)}

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
  definitionOfDone: string[] = [],
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

## Definition of Done

${definitionOfDoneChecklist(issue, definitionOfDone)}

## Rules

- Create worktrees only for repos needed by this task.
- Prefer project-local worktrees under the recommended worktree root.
- Choose short-lived branch names using \`.harness/policies/branching.md\`.
- Do not edit the product workspace root.
- Follow the native installed skills for this agent and policies in \`.harness/policies/\`.
- At session start, read the active \`.harness/decisions/\` ledger (not \`archive/\`) to recover durable decisions from earlier sessions.
- Record deliberate workflow deviations in \`HANDOFF.md\`; only when the reason generalizes beyond this issue, also append a note with \`mahler decide\` to \`.harness/decisions/\`.
- Update \`HANDOFF.md\` before stopping.
`;
}

export function handoffMarkdown(issue: LinearIssue): string {
  return `# Handoff: ${issue.identifier}

## Status

- Phase: brief-created
- State: not started
- Current owner:
- Blockers:

## Reviews

- Self-review: not started
- Agent review: not requested
- Human review: pending

## Quality

- Relevant tests/checks:
- Full test suite:
- Known risks:
- Skipped checks and reasons:

## Changes

-

## Next Steps

-

## Workflow Deviations

Record deliberate deviations here. Reference a \`.harness/decisions/\` ledger note when one exists (see \`.harness/policies/judgment.md\`).

| Decision | Reason | Risk | Follow-up |
|---|---|---|---|
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
12. Record deliberate workflow deviations in \`HANDOFF.md\`; only when the reason generalizes beyond this issue, also append a note with \`mahler decide --rule <rule> --reason "<why>" --issue <ISSUE> --agent codex\` to \`.harness/decisions/\`. At session start, read the active ledger in \`.harness/decisions/\` (not \`archive/\`) to recover durable decisions — the next session never reads a prior issue's HANDOFF.
13. If the requested skill is outside the active profile, treat it as a deliberate deviation: confirm with the human, then record the reason in \`HANDOFF.md\` and the \`.harness/decisions/\` ledger. Stop and ask if Linear metadata is unavailable.

## Confirm Before Outward Actions

Pushing, opening a PR, and using a skill outside the active profile are Tier 2
actions (see \`.harness/policies/judgment.md\`): outward-facing or hard to
reverse. Stop and get explicit human go-ahead for the specific action before
proceeding. Mahler does not perform or block these actions itself; the pause is
the gate.

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
12. Record deliberate workflow deviations in \`HANDOFF.md\`; only when the reason generalizes beyond this issue, also append a note with \`mahler decide --rule <rule> --reason "<why>" --issue <ISSUE> --agent claude\` to \`.harness/decisions/\`. At session start, read the active ledger in \`.harness/decisions/\` (not \`archive/\`) to recover durable decisions — the next session never reads a prior issue's HANDOFF.
13. If the requested skill is outside the active profile, treat it as a deliberate deviation: confirm with the human, then record the reason in \`HANDOFF.md\` and the \`.harness/decisions/\` ledger. Stop and ask if Linear metadata is unavailable.

## Confirm Before Outward Actions

Pushing, opening a PR, and using a skill outside the active profile are Tier 2
actions (see \`.harness/policies/judgment.md\`): outward-facing or hard to
reverse. Stop and get explicit human go-ahead for the specific action before
proceeding. Mahler does not perform or block these actions itself; the pause is
the gate.

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

Before choosing a workflow skill, read .harness/config.json and .harness/agents/profiles/${profile.name}.json. Use the native skill under .agents/skills/<skill>/SKILL.md only if this profile allows it. If a requested skill is outside this profile, pause and get explicit human confirmation before using it, then record the deviation and reason in HANDOFF.md (see .harness/policies/judgment.md).
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

Before choosing a workflow skill, read \`.harness/config.json\` and \`.harness/agents/profiles/${profile.name}.json\`. Use the native skill under \`.claude/skills/<skill>/SKILL.md\` only if this profile allows it. If a requested skill is outside this profile, pause and get explicit human confirmation before using it, then record the deviation and reason in HANDOFF.md (see .harness/policies/judgment.md).
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

function definitionOfDoneChecklist(issue: LinearIssue, baseline: string[]): string {
  const items = uniqueNonEmpty([...(baseline ?? []), ...(issue.acceptanceCriteria ?? [])]);
  if (items.length === 0) return "- [ ] No Definition of Done configured.";
  return items.map((item) => `- [ ] ${item}`).join("\n");
}

function issueContextMarkdown(issue: LinearIssue): string {
  const sections = [
    issueListSection("Non-Goals", issue.nonGoals),
    issueListSection("Protected Areas", issue.protectedAreas),
    issueListSection("Risk Notes", issue.riskNotes),
  ].filter(Boolean);
  return sections.length === 0 ? "" : `\n${sections.join("\n\n")}`;
}

function issueListSection(title: string, items?: string[]): string {
  const normalized = uniqueNonEmpty(items ?? []);
  if (normalized.length === 0) return "";
  return `## ${title}\n\n${normalized.map((item) => `- ${item}`).join("\n")}`;
}

function uniqueNonEmpty(items: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

import { renderTemplate } from "./templates.js";
import type {
  AgentName,
  HarnessConfig,
  InstalledProfile,
  LinearIssue,
  LinearProject,
  MergeConfig,
} from "./types.js";

// Prose lives in templates/*.md; these functions only shape data into
// template variables.

type Runtime = "codex" | "claude";

const runtimes: Record<
  Runtime,
  { label: string; skillsDir: string; rootInstructions: string }
> = {
  codex: {
    label: "Codex",
    skillsDir: ".agents/skills",
    rootInstructions: "AGENTS.md",
  },
  claude: {
    label: "Claude",
    skillsDir: ".claude/skills",
    rootInstructions: "CLAUDE.md",
  },
};

export function workflowMarkdown(): string {
  return renderTemplate("workflow");
}

export function rootAgentBlock(config: HarnessConfig): string {
  const profileFor = (runtime: Runtime) =>
    `${runtime}: ${config.agents[runtime]?.profile ?? "configured profile"}`;
  return renderTemplate("root-agent-block", {
    codexProfile: profileFor("codex"),
    claudeProfile: profileFor("claude"),
    mahlerCommand: config.mahlerCommand,
    workspaceDir: config.workspaceDir,
    guardrails: bulletList(config.guardrails ?? [], "- (none declared)"),
    humanReviewLabels: labelList(config.merge?.humanReviewLabels ?? []),
    agentMergeLabels: labelList(config.merge?.agentMergeLabels ?? []),
  });
}

export function taskMarkdown(
  issue: LinearIssue,
  source: string,
  definitionOfDone: string[] = [],
): string {
  return renderTemplate("task", {
    identifier: issue.identifier,
    title: issue.title,
    source,
    urlLine: issue.url ? `Linear URL: ${issue.url}\n` : "",
    description:
      issue.description?.trim() ||
      "_No description supplied. If Linear MCP is unavailable, ask the human for missing context before inventing requirements._",
    context: issueContextMarkdown(issue),
    definitionOfDone: definitionOfDoneChecklist(issue, definitionOfDone),
  });
}

export function sessionMarkdown(
  issue: LinearIssue,
  agent: AgentName,
  recommendedWorktreeRoot: string,
  repos: HarnessConfig["repos"],
  profile?: InstalledProfile,
  guardrails: string[] = [],
  definitionOfDone: string[] = [],
  merge?: MergeConfig,
): string {
  const profileLines = profile
    ? `- Profile: ${profile.name}
- Allowed skills: ${skillList(profile.allowedSkills)}
- Denied skills: ${skillList(profile.deniedSkills)}
`
    : "";
  return renderTemplate("agent-session", {
    identifier: issue.identifier,
    agent,
    profileLines,
    worktreeRoot: recommendedWorktreeRoot,
    repos: bulletList(
      repos.map(
        (repo) =>
          `${repo.name}: source \`${repo.path}\`, base \`${repo.baseBranch}\`, recommended worktree \`${recommendedWorktreeRoot}/repos/${repo.name}\``,
      ),
      "- (none configured)",
    ),
    guardrails: bulletList(
      guardrails,
      "- (none declared in .harness/config.json)",
    ),
    definitionOfDone: definitionOfDoneChecklist(issue, definitionOfDone),
    merge: mergeRouting(issue, merge),
  });
}

/**
 * Describes which merge rule the issue's and its project's labels trigger, so
 * agents can anticipate the decision (see policies/merge.md). A human-review
 * label on either always wins.
 */
export function mergeRouting(
  issue: LinearIssue,
  merge: MergeConfig = { humanReviewLabels: [], agentMergeLabels: [] },
): string {
  const issueLabels = issue.labels ?? [];
  const labels = uniqueNonEmpty([...issueLabels, ...(issue.projectLabels ?? [])]);
  const matching = (wanted: string[]) =>
    labels.filter((label) =>
      wanted.some((w) => w.toLowerCase() === label.toLowerCase()),
    );
  const human = matching(merge.humanReviewLabels);
  const agent = matching(merge.agentMergeLabels);
  const rule =
    human.length > 0
      ? `Human review required: label ${labelList(human)} matches \`merge.humanReviewLabels\`.`
      : agent.length > 0
        ? `Agent merge pre-approved: label ${labelList(agent)} matches \`merge.agentMergeLabels\`; a composer may merge once readiness checks pass, unless it judges the PR high risk.`
        : "No merge label: a composer decides by the risk rubric; without a composer, the human decides.";
  const projectLine =
    issue.projectLabels === undefined
      ? "(unknown; the composer checks the project's labels at merge time)"
      : issue.projectLabels.length > 0
        ? labelList(issue.projectLabels)
        : "(none)";
  return [
    `- Issue labels: ${issueLabels.length > 0 ? labelList(issueLabels) : "(none)"}`,
    `- Project labels: ${projectLine}`,
    `- ${rule}`,
    "- Labels can change after this brief was written; confirm them at merge time (see `.harness/policies/merge.md`).",
  ].join("\n");
}

export function handoffMarkdown(issue: LinearIssue): string {
  return renderTemplate("handoff", { identifier: issue.identifier });
}

export function projectMarkdown(
  project: LinearProject,
  selected: LinearIssue,
  reason: string,
): string {
  return renderTemplate("project", {
    name: project.name,
    description:
      project.description?.trim() || "_No project description supplied._",
    labels: labelList(project.labels ?? []),
    identifier: selected.identifier,
    title: selected.title,
    reason,
  });
}

export function nativeAdapter(runtime: Runtime): string {
  const { label, skillsDir, rootInstructions } = runtimes[runtime];
  return renderTemplate("adapter", {
    runtime,
    runtimeLabel: label,
    skillsDir,
    rootInstructions,
  });
}

export function codexAgentDefinition(profile: InstalledProfile): string {
  return `# Generated by Mahler. Edit agents/${profile.name}.json, then rerun mahler install.
name = "${tomlString(profile.name)}"
description = "${tomlString(profileDescription(profile))}"

developer_instructions = """
${agentInstructions(profile, "codex")}"""
`;
}

export function claudeAgentDefinition(profile: InstalledProfile): string {
  return renderTemplate("claude-agent", {
    name: profile.name,
    description: profileDescription(profile),
    instructions: agentInstructions(profile, "claude").trimEnd(),
  });
}

function agentInstructions(profile: InstalledProfile, runtime: Runtime): string {
  return renderTemplate("agent-profile", {
    name: profile.name,
    allowedSkills: skillList(profile.allowedSkills),
    deniedSkills: skillList(profile.deniedSkills),
    skillsDir: runtimes[runtime].skillsDir,
  });
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

function profileDescription(profile: InstalledProfile): string {
  return profile.description ?? `${profile.name} Mahler profile`;
}

function skillList(skills: string[]): string {
  return skills.join(", ") || "(none)";
}

function labelList(labels: string[]): string {
  return labels.map((label) => `\`${label}\``).join(", ") || "(none)";
}

function bulletList(items: string[], empty: string): string {
  if (items.length === 0) return empty;
  return items.map((item) => `- ${item}`).join("\n");
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

function definitionOfDoneChecklist(
  issue: LinearIssue,
  baseline: string[],
): string {
  const items = uniqueNonEmpty([
    ...(baseline ?? []),
    ...(issue.acceptanceCriteria ?? []),
  ]);
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
  return `## ${title}\n\n${bulletList(normalized, "")}`;
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

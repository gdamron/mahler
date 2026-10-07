import { renderTemplate } from "./templates.js";
import { tierChoice, tierVariants, type TierVariant } from "./models.js";
import type {
  AgentName,
  HarnessConfig,
  InstalledProfile,
  LinearIssue,
  LinearProject,
  MergeConfig,
  ModelsConfig,
  TierChoice,
  Runtime,
} from "./types.js";

// Prose lives in templates/*.md; these functions only shape data into
// template variables.

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

/**
 * `model` pins the profile's default tier. With `variant`, renders that tier's
 * definition instead (`<profile>-<tier>`): Codex applies a custom agent's
 * settings over spawn values, so a tier is chosen by agent name.
 */
export function codexAgentDefinition(
  profile: InstalledProfile,
  model?: TierChoice,
  variant?: TierVariant,
): string {
  const pinned = variant?.choice ?? model;
  const modelLines = [
    pinned?.model ? `model = "${tomlString(pinned.model)}"\n` : "",
    pinned?.effort
      ? `model_reasoning_effort = "${tomlString(pinned.effort)}"\n`
      : "",
  ].join("");
  return `# Generated by Mahler. Edit agents/${profile.name}.json, then rerun mahler install.
name = "${tomlString(variant?.name ?? profile.name)}"
description = "${tomlString(variant ? variantDescription(profile, variant) : profileDescription(profile))}"
${modelLines}
developer_instructions = """
${agentInstructions(profile, "codex")}"""
`;
}

/**
 * `model` pins the profile's default tier. With `variant`, renders that tier's
 * definition instead (`<profile>-<tier>`), since Claude can't set effort per
 * launch.
 */
export function claudeAgentDefinition(
  profile: InstalledProfile,
  model?: TierChoice,
  variant?: TierVariant,
): string {
  const pinned = variant?.choice ?? model;
  return renderTemplate("claude-agent", {
    name: variant?.name ?? profile.name,
    profile: profile.name,
    description: variant
      ? variantDescription(profile, variant)
      : profileDescription(profile),
    modelLines: [
      pinned?.model ? `model: ${pinned.model}\n` : "",
      pinned?.effort ? `effort: ${pinned.effort}\n` : "",
    ].join(""),
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

/** `.harness/MODELS.md`: the install's effective tiers, for agents choosing one. */
export function modelsMarkdown(models: ModelsConfig, profiles: string[]): string {
  const cell = (choice?: TierChoice) => {
    if (!choice) return "inherit";
    if (choice.skill) return `skill: \`${choice.skill}\``;
    const agent = choice.agent ? `agent: \`${choice.agent}\`` : "";
    return [agent, tierSummary(choice)].filter(Boolean).join(", ") || "inherit";
  };
  const tiers = Object.entries(models.tiers).map(
    ([tier, runtimes]) =>
      `| \`${tier}\` | ${cell(runtimes.claude)} | ${cell(runtimes.codex)} |`,
  );
  const rows = profiles
    .filter((profile) => models.profiles[profile])
    .map((profile) => {
      const { default: base, allowed } = models.profiles[profile];
      const agents = (runtime: Runtime) => {
        const variants = new Map(
          tierVariants(models, profile, runtime).map((v) => [v.tier, v.name]),
        );
        return allowed
          .map((tier) => {
            const route = tierChoice(models, tier, runtime);
            const name = route?.skill
              ? `skill \`${route.skill}\``
              : route?.agent
                ? `agent \`${route.agent}\``
                : `\`${variants.get(tier) ?? profile}\``;
            return `${tier}: ${name}`;
          })
          .join("; ");
      };
      return `| \`${profile}\` | \`${base}\` | ${allowed.map((t) => `\`${t}\``).join(", ")} | ${agents("claude")} | ${agents("codex")} |`;
    });
  return renderTemplate("models", {
    tiers: tiers.join("\n") || "| (none) | | |",
    profiles: rows.join("\n") || "| (none) | | | | |",
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

function tierSummary(choice: TierChoice): string {
  const model = choice.model === "inherit" ? undefined : choice.model;
  return (
    [model, choice.effort && `${choice.effort} effort`]
      .filter(Boolean)
      .join(", ") || "the launching agent's model"
  );
}

function variantDescription(profile: InstalledProfile, variant: TierVariant): string {
  return `${profile.name} at the ${variant.tier} tier (${tierSummary(variant.choice)}). Same role and instructions as ${profile.name}; launch it when the delegate skill picks this tier.`;
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

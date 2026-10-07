import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { INHERIT_TIER, modelOverrides, resolveModels } from "./models.js";
import type {
  ConcurrencyConfig,
  HarnessConfig,
  ModelsConfig,
  ModelsOverrides,
} from "./types.js";

export function defaultConfig(_workspace: string): HarnessConfig {
  return {
    version: 1,
    mahlerCommand: "mahler",
    workspaceDir: "workspaces",
    repos: [],
    linear: {
      acceptedAssignees: [],
      requiredLabels: [],
    },
    guardrails: [
      "PRs larger than about 1000 lines should be split into smaller, stacked PRs.",
      "High-risk PRs (identified by agent judgment or by issue or project labels) must be approved and merged by a human reviewer (see `.harness/policies/merge.md`).",
      "Required CI checks must pass before merge (enforced by CI).",
      "Changes reach main only through a merged PR (enforced by the forge).",
      "Only a human reviewer may merge a PR whose required CI checks are failing.",
    ],
    definitionOfDone: [
      "`mahler check` passes for every touched repo.",
      "Self-review is complete.",
      "Sub-agent review is complete.",
      "Sub-agent review comments are addressed.",
      "A PR is open for every touched repo, with a description of the change and its context.",
      "`HANDOFF.md` is current with changed files, checks run, blockers, and next steps.",
      "The change stays within the Linear issue scope.",
    ],
    merge: {
      humanReviewLabels: ["high-risk"],
      agentMergeLabels: ["agent-merge"],
    },
    models: defaultModels(),
    concurrency: defaultConcurrency(),
    agents: {
      codex: {
        runtime: "codex",
        profile: "composer",
        role: "composer",
        skills: [
          "compose",
          "conduct",
          "delegate",
          "select-project-issue",
          "work-on-issue",
          "interview",
          "implement",
          "commit",
          "review",
          "pr",
          "merge",
          "handoff",
        ],
        policies: [
          "branching",
          "commit",
          "definition-of-done",
          "handoff",
          "implementation",
          "interview",
          "issue-selection",
          "judgment",
          "merge",
          "pr",
          "review",
          "sub-agent-delegation",
          "workspace-safety",
        ],
      },
      claude: {
        runtime: "claude",
        profile: "composer",
        role: "composer",
        skills: [
          "compose",
          "conduct",
          "delegate",
          "select-project-issue",
          "work-on-issue",
          "interview",
          "implement",
          "commit",
          "review",
          "pr",
          "merge",
          "handoff",
        ],
        policies: [
          "branching",
          "commit",
          "definition-of-done",
          "handoff",
          "implementation",
          "interview",
          "issue-selection",
          "judgment",
          "merge",
          "pr",
          "review",
          "sub-agent-delegation",
          "workspace-safety",
        ],
      },
    },
  };
}

/**
 * Claude tiers use model aliases so they track the latest release. Profiles a
 * human may talk to directly default to `inherit`, so the session keeps the
 * model the human chose.
 */
export function defaultModels(): ModelsConfig {
  return {
    tiers: {
      trivial: {
        claude: { model: "haiku", effort: "high" },
        codex: { model: "gpt-6-luna", effort: "high" },
      },
      light: {
        claude: { model: "sonnet", effort: "high" },
        codex: { model: "gpt-6.1-sol", effort: "medium" },
      },
      standard: {
        claude: { model: "opus", effort: "medium" },
        codex: { model: "gpt-6.1-sol", effort: "high" },
      },
      deep: {
        claude: { model: "opus", effort: "high" },
        codex: { model: "gpt-6-astra", effort: "high" },
      },
    },
    profiles: {
      composer: { default: INHERIT_TIER, allowed: [INHERIT_TIER] },
      conductor: {
        default: INHERIT_TIER,
        allowed: [INHERIT_TIER, "trivial", "light", "standard", "deep"],
      },
      reviewer: {
        default: "light",
        allowed: ["trivial", "light", "standard", "deep"],
      },
    },
  };
}

export function defaultConcurrency(): ConcurrencyConfig {
  return {
    maxIssueAgents: 3,
    maxSliceAgents: 2,
    maxHeavyCommands: 2,
    loadPerCore: 0.8,
  };
}

export function withInstallOptions(
  config: HarnessConfig,
  options: {
    repos?: HarnessConfig["repos"];
    mahlerCommand?: string;
    workspaceDir?: string;
    acceptedAssignees?: string[];
    requiredLabels?: string[];
    merge?: HarnessConfig["merge"];
    models?: HarnessConfig["models"];
    concurrency?: HarnessConfig["concurrency"];
  },
): HarnessConfig {
  return {
    ...config,
    repos: options.repos ?? config.repos,
    mahlerCommand: options.mahlerCommand ?? config.mahlerCommand,
    workspaceDir: options.workspaceDir ?? config.workspaceDir,
    merge: options.merge ?? config.merge,
    models: options.models ?? config.models,
    concurrency: options.concurrency ?? config.concurrency,
    linear: {
      acceptedAssignees:
        options.acceptedAssignees ?? config.linear.acceptedAssignees,
      requiredLabels: options.requiredLabels ?? config.linear.requiredLabels,
    },
  };
}

export function configPath(workspace: string): string {
  return resolve(workspace, ".harness", "config.json");
}

export function loadConfig(workspace: string): HarnessConfig {
  const path = configPath(workspace);
  if (!existsSync(path)) {
    return defaultConfig(workspace);
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as HarnessConfig;
  const defaults = defaultConfig(workspace);
  return {
    ...parsed,
    guardrails: parsed.guardrails ?? [],
    definitionOfDone: parsed.definitionOfDone ?? defaults.definitionOfDone,
    merge: {
      humanReviewLabels:
        parsed.merge?.humanReviewLabels ?? defaults.merge.humanReviewLabels,
      agentMergeLabels:
        parsed.merge?.agentMergeLabels ?? defaults.merge.agentMergeLabels,
    },
    models: resolveModels(defaults.models, parsed.models as ModelsOverrides | undefined),
    concurrency: { ...defaults.concurrency, ...parsed.concurrency },
  };
}

/**
 * The config as written to disk: `models` and `concurrency` keep only the
 * install's changes to Mahler's defaults, so later default changes still
 * reach this install. Entries equal to a default are dropped.
 */
export function serializeConfig(config: HarnessConfig): string {
  const defaults = defaultConfig("");
  const concurrency = Object.fromEntries(
    Object.entries(config.concurrency).filter(
      ([key, value]) => defaults.concurrency[key as keyof ConcurrencyConfig] !== value,
    ),
  );
  return `${JSON.stringify(
    {
      ...config,
      models: modelOverrides(defaults.models, config.models),
      concurrency,
    },
    null,
    2,
  )}\n`;
}

/** Where an issue's brief (`meta`) and its repo worktrees (`worktreeRoot`) live. */
export function issuePaths(
  workspace: string,
  config: HarnessConfig,
  identifier: string,
): { meta: string; worktreeRoot: string } {
  return {
    meta: resolve(workspace, ".harness", "issues", identifier),
    worktreeRoot: resolve(workspace, config.workspaceDir, "issues", identifier),
  };
}

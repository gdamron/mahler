import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ConcurrencyConfig,
  HarnessConfig,
  ModelsConfig,
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
 * Claude tiers use model aliases so they track the latest release. Codex tiers
 * set effort only and inherit the session model; add `model` per tier to route
 * Codex to a smaller model.
 */
export function defaultModels(): ModelsConfig {
  return {
    tiers: {
      light: {
        claude: { model: "haiku" },
        codex: { effort: "low" },
      },
      standard: {
        claude: { model: "sonnet", effort: "high" },
        codex: { effort: "medium" },
      },
      deep: {
        claude: { model: "opus", effort: "medium" },
        codex: { effort: "high" },
      },
    },
    profiles: {
      composer: { default: "deep", allowed: ["deep"] },
      conductor: {
        default: "standard",
        allowed: ["light", "standard", "deep"],
      },
      reviewer: {
        default: "standard",
        allowed: ["light", "standard", "deep"],
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
    models: {
      tiers: parsed.models?.tiers ?? defaults.models.tiers,
      profiles: parsed.models?.profiles ?? defaults.models.profiles,
    },
    concurrency: { ...defaults.concurrency, ...parsed.concurrency },
  };
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

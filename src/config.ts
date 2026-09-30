import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { HarnessConfig } from "./types.js";

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
      "PRs greater than 1000 lines of code should be broken into smaller, stacked PRs.",
      "Merging high-risk -- identified through agent judgement or issue labels -- must be approved by a human reviewer.",
      "Required CI checks must pass before merge (enforced by CI).",
      "Merging to main must be done through a PR (enforced by CI).",
      "Merging to main with CI failures can only be done by a human reviewer.",
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
    agents: {
      codex: {
        runtime: "codex",
        profile: "composer",
        role: "composer",
        skills: [
          "compose",
          "orchestrate",
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
          "orchestrate",
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

export function withInstallOptions(
  config: HarnessConfig,
  options: {
    repos?: HarnessConfig["repos"];
    acceptedAssignees?: string[];
    requiredLabels?: string[];
  },
): HarnessConfig {
  return {
    ...config,
    repos: options.repos ?? config.repos,
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

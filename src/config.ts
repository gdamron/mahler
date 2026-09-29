import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { HarnessConfig } from "./types.js";

export function defaultConfig(workspace: string): HarnessConfig {
  return {
    version: 1,
    mahlerCommand: "mahler",
    workspaceDir: "workspaces",
    repos: [],
    linear: {
      acceptedAssignees: [],
      requiredLabels: []
    },
    guardrails: [
      "Merging to a repo's base branch requires a human-approved PR (enforced by the forge).",
      "Required CI checks must pass before merge (enforced by CI)."
    ],
    definitionOfDone: [
      "`mahler check` passes for every touched repo.",
      "Self-review is complete.",
      "`HANDOFF.md` is current with changed files, checks run, blockers, and next steps.",
      "The change stays within the Linear issue scope.",
      "A PR is opened for human review before merge."
    ],
    agents: {
      codex: {
        runtime: "codex",
        profile: "orchestrator",
        role: "orchestrator",
        skills: ["select-project-issue", "work-on-issue", "interview", "review", "commit", "pr", "handoff"],
        policies: [
          "issue-selection",
          "workspace-safety",
          "sub-agent-delegation",
          "judgment",
          "implementation",
          "definition-of-done",
          "review",
          "commit",
          "pr",
          "handoff"
        ]
      },
      claude: {
        runtime: "claude",
        profile: "orchestrator",
        role: "orchestrator",
        skills: ["select-project-issue", "work-on-issue", "interview", "review", "commit", "pr", "handoff"],
        policies: [
          "issue-selection",
          "workspace-safety",
          "sub-agent-delegation",
          "judgment",
          "implementation",
          "definition-of-done",
          "review",
          "commit",
          "pr",
          "handoff"
        ]
      }
    }
  };
}

export function withInstallOptions(
  config: HarnessConfig,
  options: {
    repos?: HarnessConfig["repos"];
    acceptedAssignees?: string[];
    requiredLabels?: string[];
  }
): HarnessConfig {
  return {
    ...config,
    repos: options.repos ?? config.repos,
    linear: {
      acceptedAssignees: options.acceptedAssignees ?? config.linear.acceptedAssignees,
      requiredLabels: options.requiredLabels ?? config.linear.requiredLabels
    }
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
    definitionOfDone: parsed.definitionOfDone ?? defaults.definitionOfDone
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

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
    agents: {
      codex: {
        runtime: "codex",
        profile: "implementer",
        role: "implementer",
        skills: ["work-on-issue", "select-project-issue", "handoff"],
        policies: [
          "issue-selection",
          "workspace-safety",
          "implementation",
          "review",
          "commit",
          "pr",
          "handoff"
        ]
      },
      claude: {
        runtime: "claude",
        profile: "implementer",
        role: "implementer",
        skills: ["work-on-issue", "select-project-issue", "handoff"],
        policies: [
          "issue-selection",
          "workspace-safety",
          "implementation",
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
  return parsed;
}

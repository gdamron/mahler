import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { HarnessConfig } from "./types.js";

export function defaultConfig(workspace: string): HarnessConfig {
  return {
    version: 1,
    harnessCommand: "harness",
    workspaceDir: "workspaces",
    repos: [
      {
        name: "fugue",
        path: "fugue",
        baseBranch: "main",
        remote: "origin"
      }
    ],
    linear: {
      acceptedAssignees: ["gonzo"],
      requiredLabels: ["agent"]
    },
    agents: {
      codex: {
        runtime: "codex",
        role: "implementer",
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
        role: "implementer",
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

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Flags, stringFlag, workspaceFlag } from "../args.js";
import { issuePaths, loadConfig } from "../config.js";
import { readIssueFile, readProjectFile, selectProjectIssue } from "../linear.js";
import { requireSkill } from "../profiles.js";
import {
  handoffMarkdown,
  launchCommand,
  projectMarkdown,
  sessionMarkdown,
  taskMarkdown,
} from "../render.js";
import type { LinearIssue } from "../types.js";
import {
  ensureDir,
  listDirectories,
  slugify,
  writeFileEnsured,
} from "../util.js";

export function createIssue(identifier: string, flags: Flags): void {
  const workspace = workspaceFlag(flags);
  const agent = String(flags.agent ?? "codex");
  const config = loadConfig(workspace);
  const active = requireSkill(workspace, agent, "work-on-issue");
  const issue =
    readIssueFile(stringFlag(flags, "linear-file")) ??
    fallbackIssue(identifier, flags);
  if (issue.identifier !== identifier) {
    throw new Error(
      `Linear issue file identifier ${issue.identifier} does not match ${identifier}`,
    );
  }
  const paths = issuePaths(workspace, config, issue.identifier);
  if (config.repos.length === 0) {
    throw new Error(
      "No repos configured. Run `mahler install` in a workspace containing git repos or edit .harness/config.json.",
    );
  }
  ensureDir(paths.meta);
  writeFileEnsured(
    resolve(paths.meta, "TASK.md"),
    taskMarkdown(
      issue,
      flags["linear-file"] ? "linear-file" : "manual/fallback",
      config.definitionOfDone,
    ),
  );
  writeFileEnsured(
    resolve(paths.meta, "AGENT_SESSION.md"),
    sessionMarkdown(
      issue,
      agent,
      paths.worktreeRoot,
      config.repos,
      active.profile,
      config.guardrails,
      config.definitionOfDone,
      config.merge,
    ),
  );
  writeFileEnsured(resolve(paths.meta, "HANDOFF.md"), handoffMarkdown(issue));
  writeJson(resolve(paths.meta, "linear-issue.json"), issue);
  console.log(`Issue brief ready: ${paths.meta}`);
  console.log(`Recommended worktree root: ${paths.worktreeRoot}`);
  console.log("Configured repos:");
  for (const repo of config.repos) {
    console.log(
      `- ${repo.name}: source ${repo.path}, base ${repo.baseBranch}, suggested ${resolve(paths.worktreeRoot, "repos", repo.name)}`,
    );
  }
  console.log("Next steps:");
  console.log("- Inspect the issue brief and configured repos.");
  console.log("- Create worktrees only for repos needed by the task.");
  console.log("- Choose branch names using .harness/policies/branching.md.");
  console.log("- Record deliberate workflow deviations in HANDOFF.md.");
  console.log(
    `Suggested launch after creating a repo worktree:\n${launchCommand(agent, resolve(paths.worktreeRoot, "repos", "<repo>"), paths.meta)}`,
  );
}

export function createProject(projectName: string, flags: Flags): void {
  const workspace = workspaceFlag(flags);
  const agent = String(flags.agent ?? "codex");
  const config = loadConfig(workspace);
  requireSkill(workspace, agent, "select-project-issue");
  const project = readProjectFile(stringFlag(flags, "linear-file"));
  if (!project) {
    throw new Error(
      "Project workflow requires --linear-file with Linear MCP project details and issues in v1",
    );
  }
  const active = new Set(
    listDirectories(resolve(workspace, ".harness", "issues")),
  );
  const selection = selectProjectIssue(project, config, active);
  const projectDir = resolve(
    workspace,
    ".harness",
    "projects",
    slugify(projectName),
  );
  ensureDir(projectDir);
  writeFileEnsured(
    resolve(projectDir, "PROJECT.md"),
    projectMarkdown(project, selection.issue, selection.reason),
  );
  writeJson(resolve(projectDir, "linear-project.json"), project);
  console.log(`Project brief ready: ${projectDir}`);
  console.log(
    `Selected ${selection.issue.identifier}: ${selection.issue.title}`,
  );
  const selectedIssueFile = resolve(projectDir, "selected-issue.json");
  writeJson(selectedIssueFile, selection.issue);
  createIssue(selection.issue.identifier, {
    ...flags,
    agent,
    "linear-file": selectedIssueFile,
  });
}

export function handoff(identifier: string, flags: Flags): void {
  const workspace = workspaceFlag(flags);
  const agent = String(flags.agent ?? "codex");
  requireSkill(workspace, agent, "handoff");
  const path = resolve(
    workspace,
    ".harness",
    "issues",
    identifier,
    "HANDOFF.md",
  );
  if (!existsSync(path)) {
    throw new Error(`No handoff found at ${path}`);
  }
  console.log(readFileSync(path, "utf8"));
}

function fallbackIssue(identifier: string, flags: Flags): LinearIssue {
  const title = stringFlag(flags, "title");
  if (!title) {
    throw new Error(
      "Linear MCP metadata is required. Pass --linear-file or --title for manual fallback.",
    );
  }
  return {
    identifier,
    title,
    description: stringFlag(flags, "description") ?? undefined,
    labels: [],
    blocked: false,
  };
}

function writeJson(path: string, value: unknown): void {
  writeFileEnsured(path, `${JSON.stringify(value, null, 2)}\n`);
}

#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultConfig, loadConfig } from "./config.js";
import { readIssueFile, readProjectFile, selectProjectIssue } from "./linear.js";
import {
  handoffMarkdown,
  launchCommand,
  nativeAdapter,
  projectMarkdown,
  rootAgentBlock,
  sessionMarkdown,
  taskMarkdown,
  workflowMarkdown
} from "./render.js";
import type { AgentName, HarnessConfig, LinearIssue } from "./types.js";
import { abs, ensureDir, listDirectories, run, slugify, writeFileEnsured } from "./util.js";

interface Args {
  command?: string;
  rest: string[];
  flags: Record<string, string | boolean>;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case "install":
      install(required(args.rest[0], "workspace path is required"));
      break;
    case "issue":
      createIssue(required(args.rest[0], "issue identifier is required"), args.flags);
      break;
    case "project":
      createProject(required(args.rest[0], "project name is required"), args.flags);
      break;
    case "status":
      status(workspaceFlag(args.flags));
      break;
    case "handoff":
      handoff(required(args.rest[0], "issue identifier is required"), workspaceFlag(args.flags));
      break;
    default:
      usage();
  }
}

function install(workspaceInput: string): void {
  const workspace = resolve(workspaceInput);
  ensureDir(workspace);
  const config = defaultConfig(workspace);
  ensureDir(resolve(workspace, ".harness", "policies"));
  ensureDir(resolve(workspace, ".harness", "agents", "codex"));
  ensureDir(resolve(workspace, ".harness", "agents", "claude"));
  writeFileEnsured(resolve(workspace, ".harness", "config.json"), `${JSON.stringify(config, null, 2)}\n`);
  writeFileEnsured(resolve(workspace, ".harness", "README.md"), installedReadme());
  writeFileEnsured(resolve(workspace, "WORKFLOW.md"), workflowMarkdown());
  for (const policy of policyNames()) {
    writeFileEnsured(resolve(workspace, ".harness", "policies", `${policy}.md`), readPolicy(policy));
  }
  writeFileEnsured(resolve(workspace, ".harness", "agents", "codex", "HARNESS.md"), nativeAdapter("codex"));
  writeFileEnsured(resolve(workspace, ".harness", "agents", "claude", "HARNESS.md"), nativeAdapter("claude"));
  mergeRootInstruction(resolve(workspace, "AGENTS.md"), rootAgentBlock(config));
  mergeRootInstruction(resolve(workspace, "CLAUDE.md"), rootAgentBlock(config));
  console.log(`Installed harness workflow into ${workspace}`);
}

function createIssue(identifier: string, flags: Record<string, string | boolean>): void {
  const workspace = workspaceFlag(flags);
  const agent = String(flags.agent ?? "codex");
  const config = loadConfig(workspace);
  const issue = readIssueFile(stringFlag(flags, "linear-file")) ?? fallbackIssue(identifier, flags);
  if (issue.identifier !== identifier) {
    throw new Error(`Linear issue file identifier ${issue.identifier} does not match ${identifier}`);
  }
  const paths = issuePaths(workspace, config, issue.identifier);
  ensureDir(paths.meta);
  for (const repo of config.repos) {
    const source = abs(workspace, repo.path);
    const target = resolve(paths.repos, repo.name);
    if (!existsSync(target)) {
      ensureDir(dirname(target));
      run("git", ["worktree", "add", "-B", issue.identifier, target, repo.baseBranch], source);
    }
  }
  const primaryRepo = resolve(paths.repos, config.repos[0].name);
  writeFileEnsured(resolve(paths.meta, "TASK.md"), taskMarkdown(issue, flags["linear-file"] ? "linear-file" : "manual/fallback"));
  writeFileEnsured(resolve(paths.meta, "AGENT_SESSION.md"), sessionMarkdown(issue, agent, primaryRepo));
  writeFileEnsured(resolve(paths.meta, "HANDOFF.md"), handoffMarkdown(issue));
  writeFileEnsured(resolve(paths.meta, "linear-issue.json"), `${JSON.stringify(issue, null, 2)}\n`);
  console.log(`Issue workspace ready: ${paths.root}`);
  console.log(`Launch command:\n${launchCommand(agent, primaryRepo, paths.meta)}`);
}

function createProject(projectName: string, flags: Record<string, string | boolean>): void {
  const workspace = workspaceFlag(flags);
  const agent = String(flags.agent ?? "codex");
  const config = loadConfig(workspace);
  const project = readProjectFile(stringFlag(flags, "linear-file"));
  if (!project) {
    throw new Error("Project workflow requires --linear-file with Linear MCP project details and issues in v1");
  }
  const active = new Set(listDirectories(resolve(workspace, config.workspaceDir, "issues")));
  const selection = selectProjectIssue(project, config, active);
  const projectDir = resolve(workspace, config.workspaceDir, "projects", slugify(projectName));
  ensureDir(projectDir);
  writeFileEnsured(resolve(projectDir, "PROJECT.md"), projectMarkdown(project, selection.issue, selection.reason));
  writeFileEnsured(resolve(projectDir, "linear-project.json"), `${JSON.stringify(project, null, 2)}\n`);
  console.log(`Project brief ready: ${projectDir}`);
  console.log(`Selected ${selection.issue.identifier}: ${selection.issue.title}`);
  createIssue(selection.issue.identifier, {
    ...flags,
    agent,
    "linear-file": writeSelectedIssueFile(projectDir, selection.issue)
  });
}

function status(workspace: string): void {
  const config = loadConfig(workspace);
  const issueRoot = resolve(workspace, config.workspaceDir, "issues");
  const issues = listDirectories(issueRoot);
  if (issues.length === 0) {
    console.log("No issue workspaces.");
    return;
  }
  for (const issue of issues) {
    const issueDir = resolve(issueRoot, issue);
    const repo = resolve(issueDir, "repos", config.repos[0].name);
    let branch = "(missing repo)";
    let dirty = "";
    if (existsSync(repo)) {
      branch = readGit(repo, ["branch", "--show-current"]);
      dirty = readGit(repo, ["status", "--short"]);
    }
    const handoff = existsSync(resolve(issueDir, "HANDOFF.md")) ? "handoff: yes" : "handoff: missing";
    console.log(`${issue}: ${branch || "(detached)"} ${dirty ? "dirty" : "clean"} ${handoff}`);
  }
}

function handoff(identifier: string, workspace: string): void {
  const config = loadConfig(workspace);
  const path = resolve(workspace, config.workspaceDir, "issues", identifier, "HANDOFF.md");
  if (!existsSync(path)) {
    throw new Error(`No handoff found at ${path}`);
  }
  console.log(readFileSync(path, "utf8"));
}

function fallbackIssue(identifier: string, flags: Record<string, string | boolean>): LinearIssue {
  const title = stringFlag(flags, "title");
  if (!title) {
    throw new Error("Linear MCP metadata is required. Pass --linear-file or --title for manual fallback.");
  }
  return {
    identifier,
    title,
    description: stringFlag(flags, "description") ?? undefined,
    labels: [],
    blocked: false
  };
}

function issuePaths(workspace: string, config: HarnessConfig, identifier: string): { root: string; meta: string; repos: string } {
  const root = resolve(workspace, config.workspaceDir, "issues", identifier);
  return {
    root,
    meta: root,
    repos: resolve(root, "repos")
  };
}

function readGit(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.stdout.trim();
}

function writeSelectedIssueFile(projectDir: string, issue: LinearIssue): string {
  const path = resolve(projectDir, "selected-issue.json");
  writeFileEnsured(path, `${JSON.stringify(issue, null, 2)}\n`);
  return path;
}

function installedReadme(): string {
  return `# Installed Harness Files

This directory contains runtime configuration and policies installed by the Harness CLI.

- \`config.json\`: workspace-specific harness configuration.
- \`policies/\`: canonical workflow policies used by all agents.
- \`agents/\`: workspace-local native adapters for supported agents.
`;
}

function mergeRootInstruction(path: string, block: string): void {
  const start = "<!-- HARNESS:START -->";
  const end = "<!-- HARNESS:END -->";
  const nextBlock = `${start}\n${block.trim()}\n${end}\n`;
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const pattern = new RegExp(`${escapeRegex(start)}[\\s\\S]*?${escapeRegex(end)}\\n?`);
  const next = pattern.test(current) ? current.replace(pattern, nextBlock) : `${current.trimEnd()}\n\n${nextBlock}`;
  writeFileEnsured(path, next.trimStart());
}

function readPolicy(name: string): string {
  const path = resolve(repoRoot(), "policies", `${name}.md`);
  return readFileSync(path, "utf8");
}

function policyNames(): string[] {
  return ["issue-selection", "workspace-safety", "implementation", "review", "commit", "pr", "handoff"];
}

function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function parseArgs(argv: string[]): Args {
  const [command, ...tail] = argv;
  const rest: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < tail.length; index += 1) {
    const part = tail[index];
    if (part.startsWith("--")) {
      const key = part.slice(2);
      const next = tail[index + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }
    } else {
      rest.push(part);
    }
  }
  return { command, rest, flags };
}

function workspaceFlag(flags: Record<string, string | boolean>): string {
  return resolve(String(flags.workspace ?? process.cwd()));
}

function stringFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

function required(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function usage(): void {
  console.log(`Usage:
  harness install <workspace>
  harness issue <ISSUE> --workspace <path> --agent codex|claude [--linear-file issue.json]
  harness project <PROJECT> --workspace <path> --agent codex|claude --linear-file project.json
  harness status --workspace <path>
  harness handoff <ISSUE> --workspace <path>
`);
}

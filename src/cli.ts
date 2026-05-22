#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultConfig, loadConfig, withInstallOptions } from "./config.js";
import { adapterRuntimes, policyNames, profileNames, skillNames } from "./scaffold.js";
import { linearIssueTemplate, linearProjectTemplate, readIssueFile, readProjectFile, selectProjectIssue } from "./linear.js";
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
import type { AgentName, HarnessConfig, InstalledProfile, LinearIssue } from "./types.js";
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
      install(required(args.rest[0], "workspace path is required"), args.flags);
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
    case "profile":
      printProfile(required(args.rest[0], "agent is required"), workspaceFlag(args.flags));
      break;
    case "can":
      canUseSkill(
        required(args.rest[0], "agent is required"),
        required(args.rest[1], "skill is required"),
        workspaceFlag(args.flags)
      );
      break;
    case "review":
      scaffoldWorkflow(required(args.rest[0], "issue identifier is required"), "review", args.flags);
      break;
    case "commit":
      scaffoldWorkflow(required(args.rest[0], "issue identifier is required"), "commit", args.flags);
      break;
    case "pr":
      scaffoldWorkflow(required(args.rest[0], "issue identifier is required"), "pr", args.flags);
      break;
    case "handoff":
      handoff(required(args.rest[0], "issue identifier is required"), args.flags);
      break;
    case "doctor":
      doctor(required(args.rest[0], "workspace path is required"));
      break;
    case "linear-template":
      printLinearTemplate(required(args.rest[0], "template kind is required: issue or project"));
      break;
    default:
      usage();
  }
}

interface DoctorResult {
  level: "ok" | "warn" | "error";
  message: string;
}

function doctor(workspaceInput: string): void {
  const workspace = resolve(workspaceInput);
  const results: DoctorResult[] = [];
  const harness = resolve(workspace, ".harness");

  if (!existsSync(workspace)) {
    fail([{ level: "error", message: `workspace not found: ${workspace}` }]);
    return;
  }

  const configPath = resolve(harness, "config.json");
  if (!existsSync(configPath)) {
    fail([{ level: "error", message: `missing .harness/config.json — run \`mahler install ${workspace}\`` }]);
    return;
  }

  let config: HarnessConfig;
  try {
    config = loadConfig(workspace);
    results.push({ level: "ok", message: ".harness/config.json parses" });
  } catch (error) {
    fail([{ level: "error", message: `.harness/config.json invalid: ${error instanceof Error ? error.message : String(error)}` }]);
    return;
  }

  if (config.repos.length === 0) {
    results.push({ level: "error", message: "no repos configured — run install in a workspace containing git repos or edit .harness/config.json" });
  } else {
    for (const repo of config.repos) {
      const repoPath = abs(workspace, repo.path);
      if (!existsSync(resolve(repoPath, ".git"))) {
        results.push({ level: "error", message: `repo \"${repo.name}\" missing .git at ${repoPath}` });
      } else {
        results.push({ level: "ok", message: `repo ${repo.name} present (${repo.baseBranch})` });
      }
    }
  }

  checkFiles(results, harness, "policies", policyNames(), ".md");
  checkFiles(results, harness, "skills", skillNames(), ".md");

  for (const profile of profileNames()) {
    const path = resolve(harness, "agents", "profiles", `${profile}.json`);
    if (!existsSync(path)) {
      results.push({ level: "error", message: `missing profile: agents/profiles/${profile}.json` });
      continue;
    }
    try {
      JSON.parse(readFileSync(path, "utf8"));
      results.push({ level: "ok", message: `profile ${profile} present` });
    } catch (error) {
      results.push({ level: "error", message: `profile ${profile} is not valid JSON: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  for (const runtime of adapterRuntimes()) {
    const path = resolve(harness, "agents", runtime, "HARNESS.md");
    if (!existsSync(path)) {
      results.push({ level: "error", message: `missing adapter: agents/${runtime}/HARNESS.md` });
      continue;
    }
    const body = readFileSync(path, "utf8");
    if (
      !body.includes("work on MAH-123") ||
      !body.includes(".harness/skills") ||
      !body.includes(".harness/policies") ||
      !body.includes(".harness/agents/profiles") ||
      !body.includes(".harness/tmp/linear") ||
      !body.includes("mahler linear-template issue|project")
    ) {
      results.push({ level: "error", message: `adapter agents/${runtime}/HARNESS.md missing routing/profile/skill/policy references` });
    } else {
      results.push({ level: "ok", message: `adapter ${runtime} wired` });
    }
  }

  const workflow = resolve(workspace, "WORKFLOW.md");
  if (!existsSync(workflow)) {
    results.push({ level: "error", message: "missing WORKFLOW.md" });
  } else {
    results.push({ level: "ok", message: "WORKFLOW.md present" });
  }

  for (const rootFile of ["AGENTS.md", "CLAUDE.md"]) {
    const path = resolve(workspace, rootFile);
    if (!existsSync(path)) {
      results.push({ level: "error", message: `missing ${rootFile}` });
      continue;
    }
    if (!readFileSync(path, "utf8").includes("<!-- HARNESS:START -->")) {
      results.push({ level: "error", message: `${rootFile} missing <!-- HARNESS:START --> block` });
    } else {
      results.push({ level: "ok", message: `${rootFile} contains harness block` });
    }
  }

  if (config.linear.acceptedAssignees.length === 0) {
    results.push({ level: "warn", message: "no Linear assignee filter configured — add --linear-assignee on install or edit .harness/config.json" });
  }

  fail(results);
}

function checkFiles(results: DoctorResult[], harness: string, dir: string, names: string[], ext: string): void {
  for (const name of names) {
    const path = resolve(harness, dir, `${name}${ext}`);
    if (!existsSync(path)) {
      results.push({ level: "error", message: `missing ${dir}/${name}${ext}` });
    } else {
      results.push({ level: "ok", message: `${dir}/${name}${ext} present` });
    }
  }
}

function fail(results: DoctorResult[]): void {
  let errors = 0;
  let warnings = 0;
  for (const result of results) {
    const prefix = result.level === "ok" ? "ok  " : result.level === "warn" ? "warn" : "err ";
    console.log(`${prefix} ${result.message}`);
    if (result.level === "error") errors += 1;
    if (result.level === "warn") warnings += 1;
  }
  console.log(`\n${results.length} checks, ${errors} error(s), ${warnings} warning(s)`);
  if (errors > 0) process.exit(1);
}

function install(workspaceInput: string, flags: Record<string, string | boolean>): void {
  const workspace = resolve(workspaceInput);
  ensureDir(workspace);
  const config = withInstallOptions(defaultConfig(workspace), {
    repos: discoverRepos(workspace),
    acceptedAssignees: listFlag(flags, "linear-assignee"),
    requiredLabels: listFlag(flags, "linear-label")
  });
  ensureDir(resolve(workspace, ".harness", "policies"));
  ensureDir(resolve(workspace, ".harness", "skills"));
  ensureDir(resolve(workspace, ".harness", "agents", "profiles"));
  writeFileEnsured(resolve(workspace, ".harness", "config.json"), `${JSON.stringify(config, null, 2)}\n`);
  writeFileEnsured(resolve(workspace, ".harness", "README.md"), installedReadme());
  writeFileEnsured(resolve(workspace, "WORKFLOW.md"), workflowMarkdown());
  for (const policy of policyNames()) {
    writeFileEnsured(resolve(workspace, ".harness", "policies", `${policy}.md`), readPolicy(policy));
  }
  for (const skill of skillNames()) {
    writeFileEnsured(resolve(workspace, ".harness", "skills", `${skill}.md`), readSkill(skill));
  }
  for (const profile of profileNames()) {
    writeFileEnsured(resolve(workspace, ".harness", "agents", "profiles", `${profile}.json`), readProfile(profile));
  }
  for (const runtime of adapterRuntimes()) {
    ensureDir(resolve(workspace, ".harness", "agents", runtime));
    writeFileEnsured(resolve(workspace, ".harness", "agents", runtime, "HARNESS.md"), nativeAdapter(runtime));
  }
  mergeRootInstruction(resolve(workspace, "AGENTS.md"), rootAgentBlock(config));
  mergeRootInstruction(resolve(workspace, "CLAUDE.md"), rootAgentBlock(config));
  console.log(`Installed Mahler workflow into ${workspace}`);
  console.log(`Configured ${config.repos.length} repo(s): ${config.repos.map((repo) => repo.name).join(", ") || "(none)"}`);
  if (config.linear.acceptedAssignees.length === 0) {
    console.log("No Linear assignee filter configured. Add one with --linear-assignee <username> or edit .harness/config.json.");
  }
}

function createIssue(identifier: string, flags: Record<string, string | boolean>): void {
  const workspace = workspaceFlag(flags);
  const agent = String(flags.agent ?? "codex");
  const config = loadConfig(workspace);
  const active = requireSkill(workspace, agent, "work-on-issue");
  const issue = readIssueFile(stringFlag(flags, "linear-file")) ?? fallbackIssue(identifier, flags);
  if (issue.identifier !== identifier) {
    throw new Error(`Linear issue file identifier ${issue.identifier} does not match ${identifier}`);
  }
  const paths = issuePaths(workspace, config, issue.identifier);
  if (config.repos.length === 0) {
    throw new Error("No repos configured. Run `mahler install` in a workspace containing git repos or edit .harness/config.json.");
  }
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
  writeFileEnsured(resolve(paths.meta, "AGENT_SESSION.md"), sessionMarkdown(issue, agent, primaryRepo, active.profile));
  writeFileEnsured(resolve(paths.meta, "HANDOFF.md"), handoffMarkdown(issue));
  writeFileEnsured(resolve(paths.meta, "linear-issue.json"), `${JSON.stringify(issue, null, 2)}\n`);
  console.log(`Issue workspace ready: ${paths.root}`);
  console.log(`Launch command:\n${launchCommand(agent, primaryRepo, paths.meta)}`);
}

function createProject(projectName: string, flags: Record<string, string | boolean>): void {
  const workspace = workspaceFlag(flags);
  const agent = String(flags.agent ?? "codex");
  const config = loadConfig(workspace);
  requireSkill(workspace, agent, "select-project-issue");
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
  if (config.repos.length === 0) {
    console.log("No repos configured.");
    return;
  }
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

function printProfile(agent: string, workspace: string): void {
  const active = loadActiveProfile(workspace, agent);
  console.log(`Agent: ${agent}`);
  console.log(`Runtime: ${active.agent.runtime}`);
  console.log(`Profile: ${active.profile.name}`);
  if (active.profile.description) console.log(`Description: ${active.profile.description}`);
  console.log(`Allowed skills: ${active.profile.allowedSkills.join(", ") || "(none)"}`);
  console.log(`Denied skills: ${active.profile.deniedSkills.join(", ") || "(none)"}`);
}

function canUseSkill(agent: string, skill: string, workspace: string): void {
  const active = loadActiveProfile(workspace, agent);
  const result = checkSkill(active.profile, skill);
  if (!result.allowed) {
    console.error(askHumanMessage(agent, active.profile.name, skill, result.reason));
    process.exit(1);
  }
  console.log(`${agent} can use ${skill} via profile ${active.profile.name}`);
}

function scaffoldWorkflow(identifier: string, skill: "review" | "commit" | "pr", flags: Record<string, string | boolean>): void {
  const workspace = workspaceFlag(flags);
  const agent = String(flags.agent ?? "codex");
  const active = requireSkill(workspace, agent, skill);
  const config = loadConfig(workspace);
  const issueDir = resolve(workspace, config.workspaceDir, "issues", identifier);
  if (!existsSync(issueDir)) {
    throw new Error(`No issue workspace found at ${issueDir}`);
  }

  console.log(`${skill} workflow allowed for ${agent} (${active.profile.name}).`);
  console.log(`Issue workspace: ${issueDir}`);
  console.log(`Skill: ${resolve(workspace, ".harness", "skills", `${skill}.md`)}`);
  console.log(`Policies: ${resolve(workspace, ".harness", "policies")}`);
  if (skill === "review") {
    console.log("Next step: inspect the issue workspace diff and record findings before updating HANDOFF.md.");
  } else if (skill === "commit") {
    console.log("Next step: verify tests and staged diff, then commit the issue-scoped changes manually.");
  } else {
    console.log("Next step: verify the branch is committed, then prepare or open the PR manually.");
  }
}

function handoff(identifier: string, flags: Record<string, string | boolean>): void {
  const workspace = workspaceFlag(flags);
  const agent = String(flags.agent ?? "codex");
  requireSkill(workspace, agent, "handoff");
  const config = loadConfig(workspace);
  const path = resolve(workspace, config.workspaceDir, "issues", identifier, "HANDOFF.md");
  if (!existsSync(path)) {
    throw new Error(`No handoff found at ${path}`);
  }
  console.log(readFileSync(path, "utf8"));
}

function requireSkill(workspace: string, agent: string, skill: string): { agent: HarnessConfig["agents"][string]; profile: InstalledProfile } {
  const active = loadActiveProfile(workspace, agent);
  const result = checkSkill(active.profile, skill);
  if (!result.allowed) {
    throw new Error(askHumanMessage(agent, active.profile.name, skill, result.reason));
  }
  return active;
}

function loadActiveProfile(workspace: string, agent: string): { agent: HarnessConfig["agents"][string]; profile: InstalledProfile } {
  const config = loadConfig(workspace);
  const agentConfig = config.agents[agent];
  if (!agentConfig) {
    throw new Error(`Unknown agent "${agent}". Configure it in .harness/config.json before using Mahler workflow gates.`);
  }
  const profilePath = resolve(workspace, ".harness", "agents", "profiles", `${agentConfig.profile}.json`);
  if (!existsSync(profilePath)) {
    throw new Error(`Missing profile for ${agent}: ${profilePath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(profilePath, "utf8"));
  } catch (error) {
    throw new Error(`Profile ${agentConfig.profile} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { agent: agentConfig, profile: normalizeProfile(parsed, agentConfig.profile) };
}

function normalizeProfile(value: unknown, expectedName: string): InstalledProfile {
  if (!value || typeof value !== "object") {
    throw new Error(`Profile ${expectedName} must be a JSON object`);
  }
  const record = value as Record<string, unknown>;
  const allowedSkills = stringArray(record.allowedSkills);
  const deniedSkills = stringArray(record.deniedSkills);
  if (typeof record.name !== "string" || record.name.length === 0) {
    throw new Error(`Profile ${expectedName} is missing name`);
  }
  if (!allowedSkills || !deniedSkills) {
    throw new Error(`Profile ${expectedName} must define allowedSkills and deniedSkills arrays`);
  }
  return {
    name: record.name,
    description: typeof record.description === "string" ? record.description : undefined,
    allowedSkills,
    deniedSkills,
    runtimeHints: undefined
  };
}

function checkSkill(profile: InstalledProfile, skill: string): { allowed: boolean; reason: string } {
  if (!skillNames().includes(skill)) {
    return { allowed: false, reason: `unknown skill "${skill}"` };
  }
  if (profile.deniedSkills.includes(skill)) {
    return { allowed: false, reason: `profile explicitly denies "${skill}"` };
  }
  if (!profile.allowedSkills.includes(skill)) {
    return { allowed: false, reason: `profile does not allow "${skill}"` };
  }
  return { allowed: true, reason: "allowed" };
}

function askHumanMessage(agent: string, profile: string, skill: string, reason: string): string {
  return `Profile gate denied: agent "${agent}" uses profile "${profile}" and cannot use skill "${skill}" (${reason}). Ask the human to switch profiles or delegate this workflow.`;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) return undefined;
  return value;
}

function printLinearTemplate(kind: string): void {
  if (kind === "issue") {
    console.log(`${JSON.stringify(linearIssueTemplate(), null, 2)}\n`);
    return;
  }
  if (kind === "project") {
    console.log(`${JSON.stringify(linearProjectTemplate(), null, 2)}\n`);
    return;
  }
  throw new Error(`Unknown Linear template "${kind}". Expected "issue" or "project".`);
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
  return `# Installed Mahler Files

This directory contains runtime configuration and policies installed by the Mahler CLI.

- \`config.json\`: workspace-specific Mahler configuration.
- \`policies/\`: canonical workflow policies used by all agents.
- \`skills/\`: task entrypoints composed from policies.
- \`agents/profiles/\`: role and capability profiles.
- \`agents/\`: workspace-local native adapters for supported runtimes.
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

function readSkill(name: string): string {
  const path = resolve(repoRoot(), "skills", `${name}.md`);
  return readFileSync(path, "utf8");
}

function readProfile(name: string): string {
  const path = resolve(repoRoot(), "agents", `${name}.json`);
  return readFileSync(path, "utf8");
}

function discoverRepos(workspace: string): HarnessConfig["repos"] {
  return listDirectories(workspace)
    .filter((entry) => existsSync(resolve(workspace, entry, ".git")))
    .map((entry) => ({
      name: entry,
      path: entry,
      baseBranch: detectBaseBranch(resolve(workspace, entry)),
      remote: "origin"
    }));
}

function detectBaseBranch(repoPath: string): string {
  const candidates = ["main", "master"];
  for (const candidate of candidates) {
    const result = spawnSync("git", ["rev-parse", "--verify", candidate], { cwd: repoPath, encoding: "utf8" });
    if (result.status === 0) return candidate;
  }
  const current = spawnSync("git", ["branch", "--show-current"], { cwd: repoPath, encoding: "utf8" });
  return current.stdout.trim() || "main";
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

function listFlag(flags: Record<string, string | boolean>, key: string): string[] {
  const value = stringFlag(flags, key);
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
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
  mahler install <workspace> [--linear-assignee user[,user...]] [--linear-label label[,label...]]
  mahler issue <ISSUE> --workspace <path> --agent codex|claude [--linear-file issue.json]
  mahler project <PROJECT> --workspace <path> --agent codex|claude --linear-file project.json
  mahler status --workspace <path>
  mahler profile <agent> --workspace <path>
  mahler can <agent> <skill> --workspace <path>
  mahler review <ISSUE> --workspace <path> --agent codex|claude
  mahler commit <ISSUE> --workspace <path> --agent codex|claude
  mahler pr <ISSUE> --workspace <path> --agent codex|claude
  mahler handoff <ISSUE> --workspace <path> --agent codex|claude
  mahler doctor <workspace>
  mahler linear-template issue|project
`);
}

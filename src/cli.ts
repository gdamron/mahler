#!/usr/bin/env node
import {
  type Args,
  type ArgSpec,
  parseArgs,
  required,
  UsageError,
  wantsHelp,
  workspaceFlag,
} from "./args.js";
import { capacity } from "./commands/capacity.js";
import { check } from "./commands/check.js";
import { cleanup } from "./commands/cleanup.js";
import { decide } from "./commands/decide.js";
import { doctor } from "./commands/doctor.js";
import { install } from "./commands/install.js";
import { createIssue, createProject, handoff } from "./commands/issue.js";
import { printLinearTemplate } from "./commands/linear-template.js";
import { canUseSkill, printProfile } from "./commands/profile.js";
import { status } from "./commands/status.js";
import { mahlerVersion } from "./util.js";

interface Command extends ArgSpec {
  usage: string;
  summary: string;
  run: (args: Args) => void;
}

const workspace = { workspace: "string" } as const;

const commands: Record<string, Command> = {
  version: {
    usage: "mahler --version",
    summary: "Print the CLI version.",
    positionals: 0,
    flags: {},
    run: () => console.log(mahlerVersion()),
  },
  install: {
    usage:
      "mahler install <workspace> [--linear-assignee user[,user...]] [--linear-label label[,label...]]",
    summary: "Install or refresh Mahler in a product workspace.",
    positionals: 1,
    flags: { "linear-assignee": "string", "linear-label": "string" },
    run: (args) =>
      install(required(args.rest[0], "workspace path is required"), args.flags),
  },
  issue: {
    usage:
      "mahler issue <ISSUE> --workspace <path> --agent codex|claude [--linear-file issue.json | --title <title> [--description <text>]]",
    summary: "Create an issue's brief and worktree root.",
    positionals: 1,
    flags: {
      ...workspace,
      agent: "string",
      "linear-file": "string",
      title: "string",
      description: "string",
    },
    run: (args) =>
      createIssue(required(args.rest[0], "issue identifier is required"), args.flags),
  },
  project: {
    usage:
      "mahler project <PROJECT> --workspace <path> --agent codex|claude --linear-file project.json",
    summary: "Pick a project's next issue and create its brief.",
    positionals: 1,
    flags: { ...workspace, agent: "string", "linear-file": "string" },
    run: (args) =>
      createProject(required(args.rest[0], "project name is required"), args.flags),
  },
  status: {
    usage: "mahler status --workspace <path>",
    summary: "Show the workspace's issues and worktrees.",
    positionals: 0,
    flags: workspace,
    run: (args) => status(workspaceFlag(args.flags)),
  },
  profile: {
    usage: "mahler profile <agent> --workspace <path>",
    summary: "Print an agent's active profile.",
    positionals: 1,
    flags: workspace,
    run: (args) =>
      printProfile(required(args.rest[0], "agent is required"), workspaceFlag(args.flags)),
  },
  can: {
    usage: "mahler can <agent> <skill> --workspace <path>",
    summary: "Exit 0 if the agent's profile allows the skill.",
    positionals: 2,
    flags: workspace,
    run: (args) =>
      canUseSkill(
        required(args.rest[0], "agent is required"),
        required(args.rest[1], "skill is required"),
        workspaceFlag(args.flags),
      ),
  },
  handoff: {
    usage: "mahler handoff <ISSUE> --workspace <path> --agent codex|claude",
    summary: "Print an issue's handoff.",
    positionals: 1,
    flags: { ...workspace, agent: "string" },
    run: (args) =>
      handoff(required(args.rest[0], "issue identifier is required"), args.flags),
  },
  decide: {
    usage:
      'mahler decide --rule <rule> --reason "<why>" [--issue <ISSUE>] [--agent codex|claude] [--slug <slug>] [--workspace <path>]',
    summary: "Record a deviation from a rule.",
    positionals: 0,
    flags: {
      ...workspace,
      rule: "string",
      reason: "string",
      issue: "string",
      agent: "string",
      slug: "string",
    },
    run: (args) => decide(args.flags),
  },
  check: {
    usage:
      "mahler check --workspace <path> [--repo <name>] [--issue <ISSUE> | --path <worktree>]",
    summary: "Run the configured checks.",
    positionals: 0,
    flags: { ...workspace, repo: "string", issue: "string", path: "string" },
    run: (args) => check(args.flags),
  },
  capacity: {
    usage: "mahler capacity --workspace <path>",
    summary: "Show agent and heavy-command capacity.",
    positionals: 0,
    flags: workspace,
    run: (args) => capacity(workspaceFlag(args.flags)),
  },
  cleanup: {
    usage: "mahler cleanup <ISSUE> --workspace <path> [--dry-run]",
    summary:
      "Remove an issue's clean worktrees (branches are kept). --dry-run lists what would be removed.",
    positionals: 1,
    flags: { ...workspace, "dry-run": "boolean" },
    run: (args) =>
      cleanup(required(args.rest[0], "issue identifier is required"), args.flags),
  },
  doctor: {
    usage: "mahler doctor <workspace>",
    summary: "Verify a workspace's install.",
    positionals: 1,
    flags: {},
    run: (args) => doctor(required(args.rest[0], "workspace path is required")),
  },
  "linear-template": {
    usage: "mahler linear-template issue|project",
    summary: "Print the Linear JSON template for an issue or project.",
    positionals: 1,
    flags: {},
    run: (args) =>
      printLinearTemplate(
        required(args.rest[0], "template kind is required: issue or project"),
      ),
  },
};

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function main(argv: string[]): void {
  const [name, ...tail] = argv;
  if (name === undefined || name === "help" || name === "--help" || name === "-h") {
    const topic = name === "help" ? tail[0] : undefined;
    if (topic && commands[topic]) commandUsage(commands[topic]);
    else usage(console.log);
    return;
  }
  const command = commands[name === "--version" ? "version" : name];
  if (!command) {
    usage(console.error);
    throw new Error(`unknown command: ${name}`);
  }
  // Checked before parsing so help never runs a command, whatever else is passed.
  if (wantsHelp(tail)) {
    commandUsage(command);
    return;
  }
  try {
    command.run(parseArgs(tail, command));
  } catch (error) {
    if (error instanceof UsageError) {
      throw new UsageError(`${error.message}\nUsage: ${command.usage}`);
    }
    throw error;
  }
}

function commandUsage(command: Command): void {
  console.log(`Usage: ${command.usage}\n\n${command.summary}`);
}

function usage(print: (text: string) => void): void {
  const lines = Object.values(commands).map((command) => `  ${command.usage}`);
  print(`Usage:\n${lines.join("\n")}\n  mahler <command> --help`);
}

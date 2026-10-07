#!/usr/bin/env node
import { parseArgs, required, workspaceFlag } from "./args.js";
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

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case "--version":
    case "version":
      console.log(mahlerVersion());
      break;
    case "install":
      install(required(args.rest[0], "workspace path is required"), args.flags);
      break;
    case "issue":
      createIssue(
        required(args.rest[0], "issue identifier is required"),
        args.flags,
      );
      break;
    case "project":
      createProject(
        required(args.rest[0], "project name is required"),
        args.flags,
      );
      break;
    case "status":
      status(workspaceFlag(args.flags));
      break;
    case "profile":
      printProfile(
        required(args.rest[0], "agent is required"),
        workspaceFlag(args.flags),
      );
      break;
    case "can":
      canUseSkill(
        required(args.rest[0], "agent is required"),
        required(args.rest[1], "skill is required"),
        workspaceFlag(args.flags),
      );
      break;
    case "handoff":
      handoff(
        required(args.rest[0], "issue identifier is required"),
        args.flags,
      );
      break;
    case "decide":
      decide(args.flags);
      break;
    case "check":
      check(args.flags);
      break;
    case "cleanup":
      cleanup(required(args.rest[0], "issue identifier is required"), args.flags);
      break;
    case "capacity":
      capacity(workspaceFlag(args.flags));
      break;
    case "doctor":
      doctor(required(args.rest[0], "workspace path is required"));
      break;
    case "linear-template":
      printLinearTemplate(
        required(args.rest[0], "template kind is required: issue or project"),
      );
      break;
    default:
      usage();
  }
}

function usage(): void {
  console.log(`Usage:
  mahler --version
  mahler install <workspace> [--linear-assignee user[,user...]] [--linear-label label[,label...]]
  mahler issue <ISSUE> --workspace <path> --agent codex|claude [--linear-file issue.json]
  mahler project <PROJECT> --workspace <path> --agent codex|claude --linear-file project.json
  mahler status --workspace <path>
  mahler profile <agent> --workspace <path>
  mahler can <agent> <skill> --workspace <path>
  mahler handoff <ISSUE> --workspace <path> --agent codex|claude
  mahler decide --rule <rule> --reason "<why>" [--issue <ISSUE>] [--agent codex|claude] [--slug <slug>] [--workspace <path>]
  mahler check --workspace <path> [--repo <name>] [--issue <ISSUE> | --path <worktree>]
  mahler capacity --workspace <path>
  mahler cleanup <ISSUE> --workspace <path> [--dry-run]
  mahler doctor <workspace>
  mahler linear-template issue|project
`);
}

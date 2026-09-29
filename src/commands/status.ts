import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../config.js";
import { readGit } from "../repos.js";
import { listDirectories } from "../util.js";

export function status(workspace: string): void {
  const config = loadConfig(workspace);
  if (config.repos.length === 0) {
    console.log("No repos configured.");
    return;
  }
  const issueRoot = resolve(workspace, config.workspaceDir, "issues");
  const briefRoot = resolve(workspace, ".harness", "issues");
  const issues = listDirectories(briefRoot);
  if (issues.length === 0) {
    console.log("No issue briefs.");
    return;
  }
  for (const issue of issues) {
    const issueDir = resolve(briefRoot, issue);
    const repoStatuses: string[] = [];
    for (const configuredRepo of config.repos) {
      const repo = resolve(issueRoot, issue, "repos", configuredRepo.name);
      if (!existsSync(repo)) continue;
      const branch =
        readGit(repo, ["branch", "--show-current"]) || "(detached)";
      const dirty = readGit(repo, ["status", "--short"]) ? "dirty" : "clean";
      repoStatuses.push(`${configuredRepo.name}:${branch} ${dirty}`);
    }
    const handoff = existsSync(resolve(issueDir, "HANDOFF.md"))
      ? "handoff: yes"
      : "handoff: missing";
    console.log(
      `${issue}: ${repoStatuses.join(", ") || "(no worktrees)"} ${handoff}`,
    );
  }
}

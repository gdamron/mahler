import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { configPath, loadConfig } from "./config.js";
import type { HarnessConfig, RepoChecks } from "./types.js";
import { listDirectories } from "./util.js";

/** Git repos directly under the workspace root, with detected base branch and checks. */
export function discoverRepos(workspace: string): HarnessConfig["repos"] {
  return listDirectories(workspace)
    .filter((entry) => existsSync(resolve(workspace, entry, ".git")))
    .map((entry) => {
      const repoPath = resolve(workspace, entry);
      const checks = detectChecks(repoPath);
      return {
        name: entry,
        path: entry,
        baseBranch: detectBaseBranch(repoPath),
        remote: "origin",
        ...(checks ? { checks } : {}),
      };
    });
}

/**
 * Re-running install rediscovers repos from disk, but `detectChecks` only
 * knows about npm. Preserve any per-repo `checks` a human has set in the
 * existing config (e.g. cargo commands) so a reinstall does not wipe them.
 * Discovered checks win only when the existing config has none for that repo.
 */
export function withPreservedChecks(
  workspace: string,
  discovered: HarnessConfig["repos"],
): HarnessConfig["repos"] {
  const configFile = configPath(workspace);
  if (!existsSync(configFile)) return discovered;
  const existingChecks = new Map<string, RepoChecks | undefined>(
    loadConfig(workspace).repos.map((repo) => [repo.name, repo.checks]),
  );
  return discovered.map((repo) => {
    const existing = existingChecks.get(repo.name);
    if (existing && Object.keys(existing).length > 0) {
      return { ...repo, checks: existing };
    }
    return repo;
  });
}

export function readGit(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.stdout.trim();
}

function detectChecks(repoPath: string): RepoChecks | undefined {
  const packagePath = resolve(repoPath, "package.json");
  if (!existsSync(packagePath)) return undefined;
  let scripts: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    scripts = parsed.scripts ?? {};
  } catch {
    return undefined;
  }
  const checks: RepoChecks = {};
  if (typeof scripts.test === "string") checks.test = "npm test";
  if (typeof scripts.lint === "string") checks.lint = "npm run lint";
  if (typeof scripts.build === "string") checks.build = "npm run build";
  return Object.keys(checks).length > 0 ? checks : undefined;
}

function detectBaseBranch(repoPath: string): string {
  const candidates = ["main", "master"];
  for (const candidate of candidates) {
    const result = spawnSync("git", ["rev-parse", "--verify", candidate], {
      cwd: repoPath,
      encoding: "utf8",
    });
    if (result.status === 0) return candidate;
  }
  return readGit(repoPath, ["branch", "--show-current"]) || "main";
}

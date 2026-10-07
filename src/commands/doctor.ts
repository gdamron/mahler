import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { configPath, loadConfig } from "../config.js";
import { claudeTierVariants, modelConfigProblems } from "../models.js";
import {
  adapterRuntimes,
  installedPolicyNames,
  installedProfileNames,
  installedSkillNames,
} from "../scaffold.js";
import type { Finding, HarnessConfig } from "../types.js";
import { abs } from "../util.js";

export function doctor(workspaceInput: string): void {
  const workspace = resolve(workspaceInput);
  const results: Finding[] = [];
  const harness = resolve(workspace, ".harness");

  if (!existsSync(workspace)) {
    report([{ level: "error", message: `workspace not found: ${workspace}` }]);
    return;
  }

  if (!existsSync(configPath(workspace))) {
    report([
      {
        level: "error",
        message: `missing .harness/config.json — run \`mahler install ${workspace}\``,
      },
    ]);
    return;
  }

  let config: HarnessConfig;
  try {
    config = loadConfig(workspace);
    results.push({ level: "ok", message: ".harness/config.json parses" });
  } catch (error) {
    report([
      {
        level: "error",
        message: `.harness/config.json invalid: ${error instanceof Error ? error.message : String(error)}`,
      },
    ]);
    return;
  }

  if (config.repos.length === 0) {
    results.push({
      level: "error",
      message:
        "no repos configured — run install in a workspace containing git repos or edit .harness/config.json",
    });
  } else {
    for (const repo of config.repos) {
      const repoPath = abs(workspace, repo.path);
      if (!existsSync(resolve(repoPath, ".git"))) {
        results.push({
          level: "error",
          message: `repo \"${repo.name}\" missing .git at ${repoPath}`,
        });
      } else {
        results.push({
          level: "ok",
          message: `repo ${repo.name} present (${repo.baseBranch})`,
        });
      }
      if (Object.keys(repo.checks ?? {}).length === 0) {
        results.push({
          level: "warn",
          message: `repo ${repo.name} has no checks configured — mahler check has nothing to run; add checks in .harness/config.json`,
        });
      }
    }
  }

  if (existsSync(resolve(harness, "decisions"))) {
    results.push({ level: "ok", message: ".harness/decisions/ present" });
  } else {
    results.push({
      level: "info",
      message:
        ".harness/decisions/ missing — created on install; agents append Tier-1 deviation notes here",
    });
  }

  const installedSkills = new Set(installedSkillNames(workspace));
  checkFiles(
    results,
    harness,
    "policies",
    installedPolicyNames(workspace),
    ".md",
  );
  checkSkillOutputs(
    results,
    workspace,
    ".agents",
    "Codex",
    installedSkillNames(workspace),
  );
  checkSkillOutputs(
    results,
    workspace,
    ".claude",
    "Claude",
    installedSkillNames(workspace),
  );

  const modelProblems = modelConfigProblems(
    config.models,
    installedProfileNames(workspace),
  );
  results.push(
    ...(modelProblems.length === 0
      ? [{ level: "ok" as const, message: "models config is consistent" }]
      : modelProblems.map((message) => ({ level: "warn" as const, message }))),
  );

  for (const profile of installedProfileNames(workspace)) {
    const path = resolve(harness, "agents", "profiles", `${profile}.json`);
    if (!existsSync(path)) {
      results.push({
        level: "error",
        message: `missing profile: agents/profiles/${profile}.json`,
      });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
      results.push({ level: "ok", message: `profile ${profile} present` });
    } catch (error) {
      results.push({
        level: "error",
        message: `profile ${profile} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    const record =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    for (const list of ["allowedSkills", "deniedSkills"] as const) {
      const skills = Array.isArray(record[list])
        ? (record[list] as unknown[])
        : [];
      for (const skill of skills) {
        if (typeof skill === "string" && !installedSkills.has(skill)) {
          results.push({
            level: "warn",
            message: `profile ${profile} ${list} references uninstalled skill "${skill}"`,
          });
        }
      }
    }
  }

  for (const profile of installedProfileNames(workspace)) {
    const codexAgent = resolve(
      workspace,
      ".codex",
      "agents",
      `${profile}.toml`,
    );
    const claudeAgent = resolve(
      workspace,
      ".claude",
      "agents",
      `${profile}.md`,
    );
    if (!existsSync(codexAgent)) {
      results.push({
        level: "error",
        message: `missing Codex agent: .codex/agents/${profile}.toml`,
      });
    } else {
      results.push({ level: "ok", message: `Codex agent ${profile} present` });
    }
    if (!existsSync(claudeAgent)) {
      results.push({
        level: "error",
        message: `missing Claude agent: .claude/agents/${profile}.md`,
      });
    } else {
      results.push({ level: "ok", message: `Claude agent ${profile} present` });
    }
    for (const variant of claudeTierVariants(config.models, profile)) {
      if (!existsSync(resolve(workspace, ".claude", "agents", `${variant.name}.md`))) {
        results.push({
          level: "error",
          message: `missing Claude tier agent: .claude/agents/${variant.name}.md — rerun mahler install`,
        });
      }
    }
  }

  for (const runtime of adapterRuntimes()) {
    const path = resolve(harness, "agents", runtime, "HARNESS.md");
    if (!existsSync(path)) {
      results.push({
        level: "error",
        message: `missing adapter: agents/${runtime}/HARNESS.md`,
      });
      continue;
    }
    const body = readFileSync(path, "utf8");
    if (
      !body.includes("work on MAH-123") ||
      !body.includes(
        runtime === "codex" ? ".agents/skills" : ".claude/skills",
      ) ||
      !body.includes(".harness/policies") ||
      !body.includes(".harness/agents/profiles") ||
      !body.includes(".harness/tmp/linear") ||
      !body.includes(".harness/decisions") ||
      !body.includes("mahler linear-template issue|project")
    ) {
      results.push({
        level: "error",
        message: `adapter agents/${runtime}/HARNESS.md missing routing/profile/skill/policy references`,
      });
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
      results.push({
        level: "error",
        message: `${rootFile} missing <!-- HARNESS:START --> block`,
      });
    } else {
      results.push({
        level: "ok",
        message: `${rootFile} contains harness block`,
      });
    }
  }

  if (config.linear.acceptedAssignees.length === 0) {
    results.push({
      level: "warn",
      message:
        "no Linear assignee filter configured — add --linear-assignee on install or edit .harness/config.json",
    });
  }

  report(results);
}

function checkFiles(
  results: Finding[],
  harness: string,
  dir: string,
  names: string[],
  ext: string,
): void {
  for (const name of names) {
    const path = resolve(harness, dir, `${name}${ext}`);
    if (!existsSync(path)) {
      results.push({ level: "error", message: `missing ${dir}/${name}${ext}` });
    } else {
      results.push({ level: "ok", message: `${dir}/${name}${ext} present` });
    }
  }
}

function checkSkillOutputs(
  results: Finding[],
  workspace: string,
  root: ".agents" | ".claude",
  label: string,
  names: string[],
): void {
  for (const skill of names) {
    const path = resolve(workspace, root, "skills", skill, "SKILL.md");
    if (!existsSync(path)) {
      results.push({
        level: "error",
        message: `missing ${label} skill: ${root}/skills/${skill}/SKILL.md`,
      });
      continue;
    }
    const body = readFileSync(path, "utf8");
    if (
      !body.startsWith("---\n") ||
      !body.includes(`name: ${skill}`) ||
      !body.includes("description:")
    ) {
      results.push({
        level: "error",
        message: `${label} skill ${skill} missing required SKILL.md frontmatter`,
      });
    } else {
      results.push({ level: "ok", message: `${label} skill ${skill} present` });
    }
  }
}

function report(results: Finding[]): void {
  let errors = 0;
  let warnings = 0;
  for (const result of results) {
    const prefix =
      result.level === "ok"
        ? "ok  "
        : result.level === "info"
          ? "info"
          : result.level === "warn"
            ? "warn"
            : "err ";
    console.log(`${prefix} ${result.message}`);
    if (result.level === "error") errors += 1;
    if (result.level === "warn") warnings += 1;
  }
  console.log(
    `\n${results.length} checks, ${errors} error(s), ${warnings} warning(s)`,
  );
  if (errors > 0) process.exit(1);
}

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { installedSkillNames, sourceLabel, type Source } from "./scaffold.js";
import type { HarnessConfig, InstalledProfile } from "./types.js";

export interface ActiveProfile {
  agent: HarnessConfig["agents"][string];
  profile: InstalledProfile;
}

/** Load the agent's profile and warn (never block) when it doesn't include `skill` — a Tier 1 norm. */
export function requireSkill(
  workspace: string,
  agent: string,
  skill: string,
): ActiveProfile {
  const active = loadActiveProfile(workspace, agent);
  const result = checkSkill(workspace, active.profile, skill);
  if (!result.allowed) {
    console.error(
      advisoryMessage(agent, active.profile.name, skill, result.reason),
    );
  }
  return active;
}

export function loadActiveProfile(
  workspace: string,
  agent: string,
): ActiveProfile {
  const config = loadConfig(workspace);
  const agentConfig = config.agents[agent];
  if (!agentConfig) {
    throw new Error(
      `Unknown agent "${agent}". Configure it in .harness/config.json before using Mahler workflow gates.`,
    );
  }
  const profilePath = resolve(
    workspace,
    ".harness",
    "agents",
    "profiles",
    `${agentConfig.profile}.json`,
  );
  if (!existsSync(profilePath)) {
    throw new Error(`Missing profile for ${agent}: ${profilePath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(profilePath, "utf8"));
  } catch (error) {
    throw new Error(
      `Profile ${agentConfig.profile} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    agent: agentConfig,
    profile: normalizeProfile(parsed, agentConfig.profile),
  };
}

export function parseProfileSource(
  source: Source,
  name: string,
): InstalledProfile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source.content);
  } catch (error) {
    throw new Error(
      `Profile source ${sourceLabel(source, `agents/${name}.json`)} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return normalizeProfile(parsed, name);
}

export function checkSkill(
  workspace: string,
  profile: InstalledProfile,
  skill: string,
): { allowed: boolean; reason: string } {
  if (!installedSkillNames(workspace).includes(skill)) {
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

export function advisoryMessage(
  agent: string,
  profile: string,
  skill: string,
  reason: string,
): string {
  return `Advisory: agent "${agent}" uses profile "${profile}", which does not include skill "${skill}" (${reason}). This is a Tier 1 norm, not a block: you may proceed deliberately, but record the reason in HANDOFF.md under Workflow Deviations; only append a durable note with \`mahler decide --rule skill-outside-profile --reason "..."\` to .harness/decisions/ when the reason generalizes beyond this issue. Ask the human first if this changes scope, ownership, or an outward action (see .harness/policies/judgment.md).`;
}

function normalizeProfile(
  value: unknown,
  expectedName: string,
): InstalledProfile {
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
    throw new Error(
      `Profile ${expectedName} must define allowedSkills and deniedSkills arrays`,
    );
  }
  return {
    name: record.name,
    description:
      typeof record.description === "string" ? record.description : undefined,
    allowedSkills,
    deniedSkills,
    runtimeHints: undefined,
  };
}

function stringArray(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === "string")
  )
    return undefined;
  return value;
}

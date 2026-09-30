import { advisoryMessage, checkSkill, loadActiveProfile } from "../profiles.js";

export function printProfile(agent: string, workspace: string): void {
  const active = loadActiveProfile(workspace, agent);
  console.log(`Agent: ${agent}`);
  console.log(`Runtime: ${active.agent.runtime}`);
  console.log(`Profile: ${active.profile.name}`);
  if (active.profile.description)
    console.log(`Description: ${active.profile.description}`);
  console.log(
    `Allowed skills: ${active.profile.allowedSkills.join(", ") || "(none)"}`,
  );
  console.log(
    `Denied skills: ${active.profile.deniedSkills.join(", ") || "(none)"}`,
  );
}

export function canUseSkill(
  agent: string,
  skill: string,
  workspace: string,
): void {
  const active = loadActiveProfile(workspace, agent);
  const result = checkSkill(workspace, active.profile, skill);
  if (!result.allowed) {
    console.log(
      advisoryMessage(agent, active.profile.name, skill, result.reason),
    );
    return;
  }
  console.log(`${agent} can use ${skill} via profile ${active.profile.name}`);
}

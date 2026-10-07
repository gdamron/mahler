import type { TierChoice, ModelsConfig, Runtime } from "./types.js";

/** Reasoning-effort values each runtime accepts in agent definitions and spawn calls. */
export const effortValues: Record<Runtime, string[]> = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  codex: ["minimal", "low", "medium", "high", "xhigh"],
};

/**
 * The model and effort a profile's generated agent definition pins for
 * `runtime`. A default tier that routes to a skill or another agent pins
 * nothing: the Mahler agent then runs only when a parent picks another tier.
 */
export function defaultModelFor(
  models: ModelsConfig,
  profile: string,
  runtime: Runtime,
): TierChoice | undefined {
  const tier = models.profiles[profile]?.default;
  const choice = tier ? models.tiers[tier]?.[runtime] : undefined;
  if (!choice || choice.skill || choice.agent) return undefined;
  return { model: choice.model, effort: choice.effort };
}

/** A generated Claude agent definition that pins one of a profile's non-default tiers. */
export interface TierVariant {
  /** `<profile>-<tier>`, the agent name a parent launches. */
  name: string;
  tier: string;
  choice: TierChoice;
}

/**
 * Claude's agent tool can override a launch's model (aliases only) but not
 * its effort, so each allowed non-default tier gets its own definition. Codex
 * sets model and reasoning effort per spawn and needs none. Tiers that route
 * to a skill or agent, set nothing, or match the default get no variant.
 */
export function claudeTierVariants(
  models: ModelsConfig,
  profile: string,
): TierVariant[] {
  const tiers = models.profiles[profile];
  if (!tiers) return [];
  const base = defaultModelFor(models, profile, "claude");
  return (tiers.allowed ?? [])
    .filter((tier) => tier !== tiers.default)
    .flatMap((tier) => {
      const choice = models.tiers[tier]?.claude;
      if (!choice || choice.skill || choice.agent) return [];
      if (!choice.model && !choice.effort) return [];
      if (choice.model === base?.model && choice.effort === base?.effort) return [];
      return [{ name: `${profile}-${tier}`, tier, choice: { model: choice.model, effort: choice.effort } }];
    });
}

/** Human-readable problems with the models config; empty when it is consistent. */
export function modelConfigProblems(
  models: ModelsConfig,
  profiles: string[],
): string[] {
  const problems: string[] = [];
  for (const [tier, runtimes] of Object.entries(models.tiers)) {
    for (const [runtime, choice] of Object.entries(runtimes ?? {})) {
      const allowed = effortValues[runtime as Runtime];
      if (!allowed) {
        problems.push(`models.tiers.${tier} names unknown runtime "${runtime}"`);
        continue;
      }
      if (choice?.skill && choice.agent) {
        problems.push(
          `models.tiers.${tier}.${runtime} sets both skill and agent; pick one`,
        );
      }
      if (choice?.skill && (choice.model || choice.effort)) {
        problems.push(
          `models.tiers.${tier}.${runtime} routes to skill "${choice.skill}", which ignores model and effort`,
        );
      }
      if (choice?.effort && !allowed.includes(choice.effort)) {
        problems.push(
          `models.tiers.${tier}.${runtime}.effort "${choice.effort}" is not one of ${allowed.join(", ")}`,
        );
      }
    }
  }
  for (const [profile, tiers] of Object.entries(models.profiles)) {
    if (!profiles.includes(profile)) {
      problems.push(`models.profiles.${profile} names no installed profile`);
    }
    for (const tier of new Set([tiers.default, ...(tiers.allowed ?? [])])) {
      if (!models.tiers[tier]) {
        problems.push(`models.profiles.${profile} uses undefined tier "${tier}"`);
      }
    }
    if (!(tiers.allowed ?? []).includes(tiers.default)) {
      problems.push(
        `models.profiles.${profile} default tier "${tiers.default}" is not in its allowed list`,
      );
    }
  }
  return problems;
}

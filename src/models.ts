import type {
  ModelsConfig,
  ModelsOverrides,
  ProfileTiers,
  Runtime,
  TierChoice,
} from "./types.js";

/** Reasoning-effort values each runtime accepts in agent definitions and spawn calls. */
export const effortValues: Record<Runtime, string[]> = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  codex: ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"],
};

/**
 * Reserved tier: run on the launching session's model. Profiles a human may
 * talk to directly default to it, so a pinned model never overrides the
 * human's choice.
 */
export const INHERIT_TIER = "inherit";

/** The effective models config: Mahler's defaults with an install's overrides applied. */
export function resolveModels(
  defaults: ModelsConfig,
  overrides: ModelsOverrides = {},
): ModelsConfig {
  const tiers: ModelsConfig["tiers"] = {};
  for (const name of union(defaults.tiers, overrides.tiers)) {
    const override = overrides.tiers?.[name];
    if (override === null) continue;
    const entry: Partial<Record<Runtime, TierChoice>> = { ...defaults.tiers[name] };
    for (const [runtime, choice] of Object.entries(override ?? {})) {
      if (choice === null) delete entry[runtime as Runtime];
      else if (choice) entry[runtime as Runtime] = choice;
    }
    tiers[name] = entry;
  }
  const profiles: ModelsConfig["profiles"] = {};
  for (const name of union(defaults.profiles, overrides.profiles)) {
    const override = overrides.profiles?.[name];
    if (override === null) continue;
    const merged = { ...defaults.profiles[name], ...override };
    if (merged.default === undefined) continue;
    profiles[name] = { default: merged.default, allowed: merged.allowed ?? [merged.default] };
  }
  return { tiers, profiles };
}

/** The smallest overrides that turn `defaults` into `models`; what install writes to config.json. */
export function modelOverrides(
  defaults: ModelsConfig,
  models: ModelsConfig,
): ModelsOverrides {
  const tiers: NonNullable<ModelsOverrides["tiers"]> = {};
  for (const name of union(defaults.tiers, models.tiers)) {
    const want = models.tiers[name];
    const base = defaults.tiers[name];
    if (!want) {
      tiers[name] = null;
      continue;
    }
    if (!base) {
      // A tier the install added is kept whole, even with no runtime entries.
      tiers[name] = want;
      continue;
    }
    const diff: Partial<Record<Runtime, TierChoice | null>> = {};
    for (const runtime of union(base ?? {}, want) as Runtime[]) {
      if (!same(base?.[runtime], want[runtime])) diff[runtime] = want[runtime] ?? null;
    }
    if (Object.keys(diff).length > 0) tiers[name] = diff;
  }
  const profiles: NonNullable<ModelsOverrides["profiles"]> = {};
  for (const name of union(defaults.profiles, models.profiles)) {
    const want = models.profiles[name];
    const base = defaults.profiles[name];
    if (!want) {
      profiles[name] = null;
      continue;
    }
    const diff: Partial<ProfileTiers> = {};
    if (want.default !== base?.default) diff.default = want.default;
    if (!same(want.allowed, base?.allowed)) diff.allowed = want.allowed;
    if (Object.keys(diff).length > 0) profiles[name] = diff;
  }
  return { tiers, profiles };
}

function union(...records: Array<object | null | undefined>): string[] {
  return Array.from(new Set(records.flatMap((record) => Object.keys(record ?? {}))));
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A tier's entry for `runtime`, with `inherit` resolved to "pin nothing" (Claude: `model: inherit`). */
export function tierChoice(
  models: ModelsConfig,
  tier: string,
  runtime: Runtime,
): TierChoice | undefined {
  if (tier === INHERIT_TIER) {
    return runtime === "claude" ? { model: "inherit" } : {};
  }
  return models.tiers[tier]?.[runtime];
}

/**
 * What an agent definition pins for `tier` on `runtime`. An empty or absent
 * entry inherits the launching session's model (Claude: `model: inherit`;
 * Codex: nothing pinned). Undefined when the tier routes to a skill or agent.
 */
export function pinnedChoice(
  models: ModelsConfig,
  tier: string,
  runtime: Runtime,
): TierChoice | undefined {
  const choice = tierChoice(models, tier, runtime);
  if (choice?.skill || choice?.agent) return undefined;
  if (!choice?.model && !choice?.effort) {
    return runtime === "claude" ? { model: "inherit" } : {};
  }
  return {
    ...(choice.model ? { model: choice.model } : {}),
    ...(choice.effort ? { effort: choice.effort } : {}),
  };
}

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
  return tier ? pinnedChoice(models, tier, runtime) : undefined;
}

/** A generated agent definition that pins one of a profile's non-default tiers. */
export interface TierVariant {
  /** `<profile>-<tier>`, the agent name a parent launches. */
  name: string;
  tier: string;
  choice: TierChoice;
}

/**
 * One definition per allowed non-default tier, named `<profile>-<tier>`, so a
 * parent picks a tier by launching that agent. Neither runtime can be trusted
 * to honor a launch-time effort: Claude's agent tool takes only a model alias,
 * and Codex applies a custom agent's settings over spawn values. Tiers that
 * route to a skill or agent, or pin the same settings as the default, get no
 * variant.
 */
export function tierVariants(
  models: ModelsConfig,
  profile: string,
  runtime: Runtime,
): TierVariant[] {
  const tiers = models.profiles[profile];
  if (!tiers) return [];
  const base = defaultModelFor(models, profile, runtime);
  return (tiers.allowed ?? [])
    .filter((tier) => tier !== tiers.default)
    .flatMap((tier) => {
      const choice = pinnedChoice(models, tier, runtime);
      if (!choice || same(choice, base)) return [];
      return [{ name: `${profile}-${tier}`, tier, choice }];
    });
}

/**
 * Native agent names that more than one source would generate in a runtime —
 * a profile and a `<profile>-<tier>` agent, or two tier agents (profile
 * `reviewer-cross` at `deep` and `reviewer` at `cross-deep`). Installing them
 * would overwrite one definition with another.
 */
export function agentNameCollisions(
  models: ModelsConfig,
  profiles: string[],
): string[] {
  const problems = new Set<string>();
  for (const runtime of ["claude", "codex"] as const) {
    const sources = new Map<string, string[]>();
    const add = (name: string, source: string) =>
      sources.set(name, [...(sources.get(name) ?? []), source]);
    for (const profile of profiles) {
      add(profile, `profile ${profile}`);
      for (const variant of tierVariants(models, profile, runtime)) {
        add(variant.name, `${profile} at the ${variant.tier} tier`);
      }
    }
    for (const [name, from] of sources) {
      if (from.length > 1) {
        problems.add(
          `agent "${name}" would be generated by ${from.join(" and ")}; rename a profile or tier`,
        );
      }
    }
  }
  return [...problems];
}

/** Human-readable problems with the models config; empty when it is consistent. */
export function modelConfigProblems(
  models: ModelsConfig,
  profiles: string[],
): string[] {
  const problems: string[] = [];
  if (models.tiers[INHERIT_TIER]) {
    problems.push(`models.tiers.${INHERIT_TIER} is reserved: it means "use the launching session's model"`);
  }
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
      if (tier !== INHERIT_TIER && !models.tiers[tier]) {
        problems.push(`models.profiles.${profile} uses undefined tier "${tier}"`);
      }
    }
    if (!(tiers.allowed ?? []).includes(tiers.default)) {
      problems.push(
        `models.profiles.${profile} default tier "${tiers.default}" is not in its allowed list`,
      );
    }
  }
  problems.push(...agentNameCollisions(models, profiles));
  return problems;
}

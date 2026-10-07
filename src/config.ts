import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { INHERIT_TIER, modelOverrides, resolveModels } from "./models.js";
import type {
  ConcurrencyConfig,
  HarnessConfig,
  ListOverrides,
  ModelsConfig,
  ModelsOverrides,
} from "./types.js";

export function defaultConfig(_workspace: string): HarnessConfig {
  return {
    version: 1,
    mahlerCommand: "mahler",
    workspaceDir: "workspaces",
    repos: [],
    linear: {
      acceptedAssignees: [],
      requiredLabels: [],
    },
    guardrails: [
      "PRs larger than about 1000 lines should be split into smaller, stacked PRs.",
      "High-risk PRs (identified by agent judgment or by issue or project labels) must be approved and merged by a human reviewer (see `.harness/policies/merge.md`).",
      "Required CI checks must pass before merge (enforced by CI).",
      "Changes reach main only through a merged PR (enforced by the forge).",
      "Only a human reviewer may merge a PR whose required CI checks are failing.",
    ],
    definitionOfDone: [
      "`mahler check` passes for every touched repo.",
      "Self-review is complete.",
      "Sub-agent review is complete.",
      "Sub-agent review comments are addressed.",
      "A PR is open for every touched repo, with a description of the change and its context.",
      "`HANDOFF.md` is current with changed files, checks run, blockers, and next steps.",
      "The change stays within the Linear issue scope.",
    ],
    merge: {
      humanReviewLabels: ["high-risk"],
      agentMergeLabels: ["agent-merge"],
    },
    models: defaultModels(),
    concurrency: defaultConcurrency(),
    agents: {
      codex: {
        runtime: "codex",
        profile: "composer",
        role: "composer",
        skills: [
          "compose",
          "conduct",
          "delegate",
          "select-project-issue",
          "work-on-issue",
          "interview",
          "implement",
          "commit",
          "review",
          "pr",
          "merge",
          "handoff",
        ],
        policies: [
          "branching",
          "commit",
          "definition-of-done",
          "handoff",
          "implementation",
          "interview",
          "issue-selection",
          "judgment",
          "merge",
          "pr",
          "review",
          "sub-agent-delegation",
          "workspace-safety",
        ],
      },
      claude: {
        runtime: "claude",
        profile: "composer",
        role: "composer",
        skills: [
          "compose",
          "conduct",
          "delegate",
          "select-project-issue",
          "work-on-issue",
          "interview",
          "implement",
          "commit",
          "review",
          "pr",
          "merge",
          "handoff",
        ],
        policies: [
          "branching",
          "commit",
          "definition-of-done",
          "handoff",
          "implementation",
          "interview",
          "issue-selection",
          "judgment",
          "merge",
          "pr",
          "review",
          "sub-agent-delegation",
          "workspace-safety",
        ],
      },
    },
  };
}

/**
 * Claude tiers use model aliases so they track the latest release. Profiles a
 * human may talk to directly default to `inherit`, so the session keeps the
 * model the human chose.
 */
export function defaultModels(): ModelsConfig {
  return {
    tiers: {
      trivial: {
        claude: { model: "haiku", effort: "high" },
        codex: { model: "gpt-6-luna", effort: "high" },
      },
      light: {
        claude: { model: "sonnet", effort: "high" },
        codex: { model: "gpt-6.1-sol", effort: "medium" },
      },
      standard: {
        claude: { model: "opus", effort: "medium" },
        codex: { model: "gpt-6.1-sol", effort: "high" },
      },
      deep: {
        claude: { model: "opus", effort: "high" },
        codex: { model: "gpt-6-astra", effort: "high" },
      },
    },
    profiles: {
      composer: { default: INHERIT_TIER, allowed: [INHERIT_TIER] },
      conductor: {
        default: INHERIT_TIER,
        allowed: [INHERIT_TIER, "trivial", "light", "standard", "deep"],
      },
      reviewer: {
        default: "light",
        allowed: ["trivial", "light", "standard", "deep"],
      },
    },
  };
}

export function defaultConcurrency(): ConcurrencyConfig {
  return {
    maxIssueAgents: 3,
    maxSliceAgents: 2,
    maxHeavyCommands: 2,
    loadPerCore: 0.8,
  };
}

export function withInstallOptions(
  config: HarnessConfig,
  options: {
    repos?: HarnessConfig["repos"];
    mahlerCommand?: string;
    workspaceDir?: string;
    acceptedAssignees?: string[];
    requiredLabels?: string[];
    guardrails?: string[];
    definitionOfDone?: string[];
    merge?: HarnessConfig["merge"];
    models?: HarnessConfig["models"];
    concurrency?: HarnessConfig["concurrency"];
    agents?: HarnessConfig["agents"];
  },
): HarnessConfig {
  return {
    ...config,
    repos: options.repos ?? config.repos,
    mahlerCommand: options.mahlerCommand ?? config.mahlerCommand,
    workspaceDir: options.workspaceDir ?? config.workspaceDir,
    guardrails: options.guardrails ?? config.guardrails,
    definitionOfDone: options.definitionOfDone ?? config.definitionOfDone,
    merge: options.merge ?? config.merge,
    models: options.models ?? config.models,
    concurrency: options.concurrency ?? config.concurrency,
    agents: withPreservedAgents(config.agents, options.agents),
    linear: {
      acceptedAssignees:
        options.acceptedAssignees ?? config.linear.acceptedAssignees,
      requiredLabels: options.requiredLabels ?? config.linear.requiredLabels,
    },
  };
}

export function configPath(workspace: string): string {
  return resolve(workspace, ".harness", "config.json");
}

export function loadConfig(workspace: string): HarnessConfig {
  const path = configPath(workspace);
  if (!existsSync(path)) {
    return defaultConfig(workspace);
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Omit<
    HarnessConfig,
    "guardrails" | "definitionOfDone"
  > & {
    guardrails?: ListOverrides | string[];
    definitionOfDone?: ListOverrides | string[];
  };
  const defaults = defaultConfig(workspace);
  return {
    ...parsed,
    guardrails: resolveList(
      defaults.guardrails,
      parsed.guardrails,
      retiredDefaults.guardrails,
    ),
    definitionOfDone: resolveList(
      defaults.definitionOfDone,
      parsed.definitionOfDone,
      retiredDefaults.definitionOfDone,
    ),
    merge: {
      humanReviewLabels:
        parsed.merge?.humanReviewLabels ?? defaults.merge.humanReviewLabels,
      agentMergeLabels:
        parsed.merge?.agentMergeLabels ?? defaults.merge.agentMergeLabels,
    },
    models: resolveModels(defaults.models, parsed.models as ModelsOverrides | undefined),
    concurrency: { ...defaults.concurrency, ...parsed.concurrency },
  };
}

/**
 * The config as written to disk: `guardrails`, `definitionOfDone`, `models`,
 * and `concurrency` keep only the install's changes to Mahler's defaults, so
 * later default changes still reach this install. Entries equal to a default
 * are dropped.
 */
export function serializeConfig(config: HarnessConfig): string {
  const defaults = defaultConfig("");
  const concurrency = Object.fromEntries(
    Object.entries(config.concurrency).filter(
      ([key, value]) => defaults.concurrency[key as keyof ConcurrencyConfig] !== value,
    ),
  );
  return `${JSON.stringify(
    {
      ...config,
      guardrails: listOverrides(defaults.guardrails, config.guardrails),
      definitionOfDone: listOverrides(
        defaults.definitionOfDone,
        config.definitionOfDone,
      ),
      models: modelOverrides(defaults.models, config.models),
      concurrency,
    },
    null,
    2,
  )}\n`;
}

/**
 * Defaults Mahler no longer ships. A config written before these lists were
 * stored as overrides holds the whole list; its retired defaults are dropped
 * instead of being kept as the install's additions.
 */
const retiredDefaults = {
  guardrails: [
    "Merging to a repo's base branch requires a human-approved PR (enforced by the forge).",
  ],
  definitionOfDone: ["A PR is opened for human review before merge."],
};

/** The effective list: Mahler's defaults minus `remove`, then `add`. */
export function resolveList(
  defaults: string[],
  overrides: ListOverrides | string[] = {},
  retired: string[] = [],
): string[] {
  if (Array.isArray(overrides)) {
    // A whole list from an older install: keep its additions. A default it
    // lacks was added since, so it is not treated as removed.
    return resolveList(defaults, {
      add: overrides.filter((item) => !retired.includes(item)),
    });
  }
  const remove = overrides.remove ?? [];
  return Array.from(
    new Set([
      ...defaults.filter((item) => !remove.includes(item)),
      ...(overrides.add ?? []),
    ]),
  );
}

/** The smallest overrides that turn `defaults` into `list`; default order is not recorded. */
export function listOverrides(defaults: string[], list: string[]): ListOverrides {
  return {
    add: list.filter((item) => !defaults.includes(item)),
    remove: defaults.filter((item) => !list.includes(item)),
  };
}

/**
 * Mahler's agent entries with each runtime's `profile` and `role` kept from
 * `previous`; skill and policy lists track Mahler's. Runtimes Mahler has no
 * entry for are kept whole.
 */
export function withPreservedAgents(
  defaults: HarnessConfig["agents"],
  previous: HarnessConfig["agents"] = {},
): HarnessConfig["agents"] {
  const agents = { ...previous };
  for (const [name, agent] of Object.entries(defaults)) {
    const kept = previous[name];
    agents[name] = {
      ...agent,
      profile: kept?.profile ?? agent.profile,
      role: kept?.role ?? agent.role,
    };
  }
  return agents;
}

/** Where an issue's brief (`meta`) and its repo worktrees (`worktreeRoot`) live. */
export function issuePaths(
  workspace: string,
  config: HarnessConfig,
  identifier: string,
): { meta: string; worktreeRoot: string } {
  return {
    meta: resolve(workspace, ".harness", "issues", identifier),
    worktreeRoot: resolve(workspace, config.workspaceDir, "issues", identifier),
  };
}

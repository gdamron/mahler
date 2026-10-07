export type AgentName = "codex" | "claude" | string;

export interface RepoConfig {
  name: string;
  path: string;
  baseBranch: string;
  remote?: string;
  /** Semantic check names mapped to shell commands; the local mirror of what CI runs. */
  checks?: RepoChecks;
}

export interface RepoChecks {
  test?: string;
  lint?: string;
  build?: string;
}

export interface HarnessConfig {
  version: 1;
  mahlerCommand: string;
  workspaceDir: string;
  repos: RepoConfig[];
  linear: {
    acceptedAssignees: string[];
    requiredLabels: string[];
  };
  /** Tier 3 hard limits declared for agent anticipation; enforced by the forge/CI, never by Mahler. */
  guardrails: string[];
  /** Team baseline that every issue must satisfy before handoff/PR. */
  definitionOfDone: string[];
  /** Issue/project labels that route merge decisions; see policies/merge.md. */
  merge: MergeConfig;
  /** Named model tiers and each profile's default tier; see skills/delegate. */
  models: ModelsConfig;
  /** Caps on parallel agents and heavy commands; reported by `mahler capacity`. */
  concurrency: ConcurrencyConfig;
  /** Each runtime's profile; a reinstall keeps `profile` and `role` and refreshes the skill and policy lists. */
  agents: Record<string, AgentProfile>;
}

export type Runtime = "codex" | "claude";

/**
 * How one runtime executes a tier. `model`/`effort` tune a Mahler sub-agent;
 * unset fields inherit from the parent session. `skill`, `agent`, or `command`
 * hands the role to something else instead: invoke that runtime skill, launch
 * that runtime agent type in place of the Mahler profile's agent, or run that
 * shell command (e.g. a Codex review through the Codex plugin's companion
 * script) and treat its output as the role's result.
 */
export interface TierChoice {
  model?: string;
  effort?: string;
  skill?: string;
  agent?: string;
  /** Shell command; `<placeholders>` such as `<worktree>` and `<base>` are filled from the brief. */
  command?: string;
}

export interface ModelsConfig {
  /** Tier name mapped to the model and effort each runtime uses for it. */
  tiers: Record<string, Partial<Record<Runtime, TierChoice>>>;
  /** Profile name mapped to its default tier and the tiers a parent may pick for it. */
  profiles: Record<string, ProfileTiers>;
}

/**
 * What `.harness/config.json` stores under `models`: only the install's
 * changes to Mahler's defaults, so new defaults still reach the install. A
 * tier's runtime entry replaces the default's; a profile's fields replace the
 * default's fields; `null` removes a default tier, runtime entry, or profile.
 */
export interface ModelsOverrides {
  tiers?: Record<string, Partial<Record<Runtime, TierChoice | null>> | null>;
  profiles?: Record<string, Partial<ProfileTiers> | null>;
}

/**
 * What `.harness/config.json` stores for a list Mahler ships defaults for
 * (`guardrails`, `definitionOfDone`): only the install's changes, so new
 * defaults still reach the install. `add` entries follow the defaults;
 * `remove` drops a default by its exact text.
 */
export interface ListOverrides {
  add?: string[];
  remove?: string[];
}

export interface ProfileTiers {
  /** Baked into the generated agent definition. */
  default: string;
  /** Tiers a parent may choose per launch; picking another is a recorded Tier 1 deviation. */
  allowed: string[];
}

export interface ConcurrencyConfig {
  /** Conductors a composer runs at once. */
  maxIssueAgents: number;
  /** Slice conductors one conductor runs at once. */
  maxSliceAgents: number;
  /** Full test suites, builds, or `mahler check` runs at once across the workspace. */
  maxHeavyCommands: number;
  /** 1-minute load average per CPU core above which agents hold new launches and heavy commands. */
  loadPerCore: number;
}

export interface MergeConfig {
  /** Labels that require a human to review and merge. Always wins. */
  humanReviewLabels: string[];
  /** Labels that pre-approve a composer merge once readiness checks pass. */
  agentMergeLabels: string[];
}

export interface AgentProfile {
  runtime: string;
  profile: string;
  role: string;
  policies: string[];
  skills: string[];
}

export interface InstalledProfile {
  name: string;
  description?: string;
  allowedSkills: string[];
  deniedSkills: string[];
  runtimeHints?: Record<string, string>;
}

export interface LinearIssue {
  id?: string;
  identifier: string;
  title: string;
  description?: string;
  priority?: number | null;
  state?: string;
  stateType?: string;
  assignee?: string | null;
  assigneeName?: string | null;
  labels?: string[];
  /** Labels on the issue's Linear project; unset when unknown. Used for merge routing. */
  projectLabels?: string[];
  blocked?: boolean;
  acceptanceCriteria?: string[];
  nonGoals?: string[];
  protectedAreas?: string[];
  riskNotes?: string[];
  updatedAt?: string;
  createdAt?: string;
  url?: string;
}

export interface LinearProject {
  id?: string;
  name: string;
  description?: string;
  url?: string;
  labels?: string[];
  issues: LinearIssue[];
}

export interface IssueSelection {
  issue: LinearIssue;
  reason: string;
}

/** One line of `mahler doctor` / `mahler check` output. */
export interface Finding {
  level: "ok" | "info" | "warn" | "error";
  message: string;
}

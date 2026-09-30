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
  agents: Record<string, AgentProfile>;
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

export type AgentName = "codex" | "claude" | string;

export interface RepoConfig {
  name: string;
  path: string;
  baseBranch: string;
  remote?: string;
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
  agents: Record<string, AgentProfile>;
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
  blocked?: boolean;
  updatedAt?: string;
  createdAt?: string;
  url?: string;
}

export interface LinearProject {
  id?: string;
  name: string;
  description?: string;
  url?: string;
  issues: LinearIssue[];
}

export interface IssueSelection {
  issue: LinearIssue;
  reason: string;
}

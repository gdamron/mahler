import { readFileSync } from "node:fs";
import type { HarnessConfig, IssueSelection, LinearIssue, LinearProject } from "./types.js";

export function linearIssueTemplate(): LinearIssue {
  return {
    id: "optional Linear UUID or identifier",
    identifier: "ISSUE-123",
    title: "Issue title",
    description: "Issue description from Linear",
    priority: 1,
    state: "Todo",
    stateType: "unstarted",
    assignee: "agent username",
    assigneeName: "Agent display name",
    labels: ["agent"],
    blocked: false,
    acceptanceCriteria: [
      "User-facing behavior is covered by tests.",
      "Existing workflows continue to pass."
    ],
    nonGoals: ["Out-of-scope follow-up work from the Linear issue"],
    protectedAreas: ["Files or systems the Linear issue says not to change"],
    riskNotes: ["Known risks or rollout notes from the Linear issue"],
    updatedAt: "2026-05-22T00:00:00.000Z",
    createdAt: "2026-05-22T00:00:00.000Z",
    url: "https://linear.app/workspace/issue/ISSUE-123"
  };
}

export function linearProjectTemplate(): LinearProject {
  return {
    id: "optional Linear project UUID",
    name: "Project name",
    description: "Project description from Linear",
    url: "https://linear.app/workspace/project/project-slug",
    issues: [linearIssueTemplate()]
  };
}

export function readIssueFile(path?: string): LinearIssue | undefined {
  if (!path) return undefined;
  return normalizeIssue(JSON.parse(readFileSync(path, "utf8")));
}

export function readProjectFile(path?: string): LinearProject | undefined {
  if (!path) return undefined;
  const project = JSON.parse(readFileSync(path, "utf8")) as LinearProject;
  return {
    ...project,
    issues: (project.issues ?? []).map((issue) => normalizeIssue(issue as Partial<LinearIssue> & { [key: string]: unknown }))
  };
}

export function normalizeIssue(input: Partial<LinearIssue> & { [key: string]: unknown }): LinearIssue {
  const labels = Array.isArray(input.labels)
    ? input.labels.map(String)
    : Array.isArray(input["labelNames"])
      ? (input["labelNames"] as unknown[]).map(String)
      : [];
  const identifier = String(input.identifier ?? input.id ?? "");
  const title = String(input.title ?? "");
  if (!identifier || !title) {
    throw new Error("Linear issue metadata requires identifier and title");
  }
  return {
    id: input.id ? String(input.id) : undefined,
    identifier,
    title,
    description: input.description ? String(input.description) : undefined,
    priority: typeof input.priority === "number" ? input.priority : null,
    state: input.state ? String(input.state) : undefined,
    stateType: input.stateType ? String(input.stateType) : undefined,
    assignee: input.assignee ? String(input.assignee) : null,
    assigneeName: input.assigneeName ? String(input.assigneeName) : null,
    labels,
    blocked: Boolean(input.blocked),
    acceptanceCriteria: stringList(input.acceptanceCriteria),
    nonGoals: stringList(input.nonGoals),
    protectedAreas: stringList(input.protectedAreas),
    riskNotes: stringList(input.riskNotes),
    updatedAt: input.updatedAt ? String(input.updatedAt) : undefined,
    createdAt: input.createdAt ? String(input.createdAt) : undefined,
    url: input.url ? String(input.url) : undefined
  };
}

export function selectProjectIssue(project: LinearProject, config: HarnessConfig, activeIssues: Set<string>): IssueSelection {
  const eligible = project.issues.filter((issue) => isEligible(issue, config, activeIssues));
  if (eligible.length === 0) {
    throw new Error(
      [
        `No eligible issues found for project "${project.name}".`,
        `Required assignee: ${config.linear.acceptedAssignees.join(", ") || "(none configured)"}.`,
        `Required labels: ${config.linear.requiredLabels.join(", ") || "(none configured)"}.`
      ].join(" ")
    );
  }
  eligible.sort(compareIssues);
  return {
    issue: eligible[0],
    reason: "selected by priority, then oldest update/create timestamp"
  };
}

function isEligible(issue: LinearIssue, config: HarnessConfig, activeIssues: Set<string>): boolean {
  if (activeIssues.has(issue.identifier)) return false;
  if (issue.blocked) return false;
  const state = (issue.stateType ?? issue.state ?? "").toLowerCase();
  if (["completed", "canceled", "cancelled", "done"].includes(state)) return false;
  const assignees = new Set(config.linear.acceptedAssignees.map((name) => name.toLowerCase()));
  const issueAssignees = [issue.assignee, issue.assigneeName].filter(Boolean).map((name) => String(name).toLowerCase());
  if (assignees.size > 0 && !issueAssignees.some((name) => assignees.has(name))) return false;
  const labels = new Set((issue.labels ?? []).map((label) => label.toLowerCase()));
  for (const required of config.linear.requiredLabels) {
    if (!labels.has(required.toLowerCase())) return false;
  }
  return true;
}

function compareIssues(a: LinearIssue, b: LinearIssue): number {
  const priorityA = priorityRank(a.priority);
  const priorityB = priorityRank(b.priority);
  if (priorityA !== priorityB) return priorityA - priorityB;
  return timestamp(a.updatedAt ?? a.createdAt) - timestamp(b.updatedAt ?? b.createdAt);
}

function priorityRank(priority?: number | null): number {
  if (priority == null || priority === 0) return 99;
  return priority;
}

function timestamp(value?: string): number {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.map((entry) => String(entry).trim()).filter(Boolean);
  return entries.length === 0 ? undefined : entries;
}

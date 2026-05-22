export function policyNames(): string[] {
  return ["issue-selection", "workspace-safety", "implementation", "review", "commit", "pr", "handoff"];
}

export function skillNames(): string[] {
  return ["work-on-issue", "select-project-issue", "review", "commit", "pr", "handoff"];
}

export function profileNames(): string[] {
  return ["implementer", "reviewer", "committer", "full-stack"];
}

export function adapterRuntimes(): Array<"codex" | "claude"> {
  return ["codex", "claude"];
}

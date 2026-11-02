import type { LinearIssue, RiskConfig, RiskLevel } from "./types.js";

export const riskLevels: RiskLevel[] = ["low", "medium", "high"];

export function isRiskLevel(value: string): value is RiskLevel {
  return (riskLevels as string[]).includes(value);
}

/**
 * The issue's risk level: the highest of its `risk` field and any risk labels
 * on the issue or its project. Risk only goes up (see policies/risk.md), so a
 * lower signal never hides a higher one.
 */
export function issueRisk(
  issue: LinearIssue,
  risk: RiskConfig,
): { level: RiskLevel; from: string } | undefined {
  const found: Array<{ level: RiskLevel; from: string }> = [];
  if (issue.risk) found.push({ level: issue.risk, from: "the task brief" });
  const labels = [...(issue.labels ?? []), ...(issue.projectLabels ?? [])];
  for (const level of riskLevels) {
    const label = labels.find(
      (candidate) => candidate.toLowerCase() === risk.labels[level].toLowerCase(),
    );
    if (label) found.push({ level, from: `label \`${label}\`` });
  }
  return found.sort(
    (a, b) => riskLevels.indexOf(b.level) - riskLevels.indexOf(a.level),
  )[0];
}

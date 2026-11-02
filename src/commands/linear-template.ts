import { linearIssueTemplate, linearProjectTemplate, localTaskTemplate } from "../linear.js";

export function printLinearTemplate(kind: string): void {
  if (kind === "issue") {
    console.log(`${JSON.stringify(linearIssueTemplate(), null, 2)}\n`);
    return;
  }
  if (kind === "project") {
    console.log(`${JSON.stringify(linearProjectTemplate(), null, 2)}\n`);
    return;
  }
  if (kind === "task") {
    console.log(`${JSON.stringify(localTaskTemplate(), null, 2)}\n`);
    return;
  }
  throw new Error(
    `Unknown template "${kind}". Expected "issue", "project", or "task".`,
  );
}

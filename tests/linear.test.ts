import test from "node:test";
import assert from "node:assert/strict";
import { defaultConfig } from "../src/config.js";
import { selectProjectIssue } from "../src/linear.js";

test("selectProjectIssue filters by assignee and label", () => {
  const config = defaultConfig("/tmp/workspace");
  const selection = selectProjectIssue(
    {
      name: "Project",
      issues: [
        { identifier: "FUG-1", title: "No label", assignee: "gonzo", labels: [], priority: 1 },
        { identifier: "FUG-2", title: "Wrong assignee", assignee: "human", labels: ["agent"], priority: 1 },
        { identifier: "FUG-3", title: "Right issue", assignee: "gonzo", labels: ["agent"], priority: 2 }
      ]
    },
    config,
    new Set()
  );
  assert.equal(selection.issue.identifier, "FUG-3");
});

test("selectProjectIssue sorts by priority then oldest update", () => {
  const config = defaultConfig("/tmp/workspace");
  const selection = selectProjectIssue(
    {
      name: "Project",
      issues: [
        {
          identifier: "FUG-2",
          title: "Newer",
          assignee: "gonzo",
          labels: ["agent"],
          priority: 2,
          updatedAt: "2026-05-02T00:00:00Z"
        },
        {
          identifier: "FUG-1",
          title: "Older",
          assignee: "gonzo",
          labels: ["agent"],
          priority: 2,
          updatedAt: "2026-05-01T00:00:00Z"
        },
        {
          identifier: "FUG-3",
          title: "Lower priority",
          assignee: "gonzo",
          labels: ["agent"],
          priority: 4,
          updatedAt: "2026-04-01T00:00:00Z"
        }
      ]
    },
    config,
    new Set()
  );
  assert.equal(selection.issue.identifier, "FUG-1");
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { defaultConfig, withInstallOptions } from "../src/config.js";
import { linearIssueTemplate, linearProjectTemplate, normalizeIssue, readProjectFile, selectProjectIssue } from "../src/linear.js";

test("linearIssueTemplate has the parseable issue metadata shape", () => {
  const template = linearIssueTemplate();
  assert.equal(template.identifier, "ISSUE-123");
  assert.equal(template.title, "Issue title");
  assert.deepEqual(template.labels, ["agent"]);
  assert.equal(template.blocked, false);
  assert.deepEqual(template.acceptanceCriteria, [
    "User-facing behavior is covered by tests.",
    "Existing workflows continue to pass."
  ]);
  const normalized = normalizeIssue({
    ...template,
    acceptanceCriteria: [" Ship it ", ""],
    nonGoals: [" No redesign "]
  });
  assert.equal(normalized.identifier, "ISSUE-123");
  assert.deepEqual(normalized.acceptanceCriteria, ["Ship it"]);
  assert.deepEqual(normalized.nonGoals, ["No redesign"]);
});

test("linearProjectTemplate has the parseable project metadata shape", () => {
  const template = linearProjectTemplate();
  assert.equal(template.name, "Project name");
  assert.equal(template.issues.length, 1);
  assert.equal(normalizeIssue({ ...template.issues[0] }).title, "Issue title");
});

test("selectProjectIssue filters by assignee and label", () => {
  const config = withInstallOptions(defaultConfig("/tmp/workspace"), {
    acceptedAssignees: ["gonzo"],
    requiredLabels: ["agent"]
  });
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
  const config = withInstallOptions(defaultConfig("/tmp/workspace"), {
    acceptedAssignees: ["gonzo"],
    requiredLabels: ["agent"]
  });
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

test("readProjectFile copies project labels onto issues without their own", () => {
  const path = resolve(mkdtempSync(resolve(tmpdir(), "mahler-linear-")), "project.json");
  writeFileSync(path, JSON.stringify({
    name: "Project",
    labels: [" high-risk "],
    issues: [
      { identifier: "FUG-1", title: "Inherits" },
      { identifier: "FUG-2", title: "Own labels", projectLabels: [] }
    ]
  }));
  const project = readProjectFile(path);
  assert.deepEqual(project?.labels, ["high-risk"]);
  assert.deepEqual(project?.issues[0].projectLabels, ["high-risk"]);
  assert.deepEqual(project?.issues[1].projectLabels, []);
  assert.equal(normalizeIssue({ identifier: "FUG-3", title: "t" }).projectLabels, undefined);
});

test("project template issues inherit the project's labels", () => {
  const path = resolve(mkdtempSync(resolve(tmpdir(), "mahler-linear-")), "project.json");
  const template = linearProjectTemplate();
  writeFileSync(path, JSON.stringify({ ...template, labels: ["high-risk"] }));
  assert.deepEqual(readProjectFile(path)?.issues[0].projectLabels, ["high-risk"]);
});

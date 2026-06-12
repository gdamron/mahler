import test from "node:test";
import assert from "node:assert/strict";
import { defaultConfig, withInstallOptions } from "../src/config.js";

test("defaultConfig does not assume repos or Linear assignees", () => {
  const config = defaultConfig("/tmp/workspace");
  assert.deepEqual(config.repos, []);
  assert.deepEqual(config.linear.acceptedAssignees, []);
  assert.deepEqual(config.linear.requiredLabels, []);
});

test("defaultConfig declares Tier 3 guardrails", () => {
  const config = defaultConfig("/tmp/workspace");
  assert.ok(config.guardrails.length >= 2);
  assert.ok(config.guardrails.some((line) => line.includes("human-approved PR")));
  assert.ok(config.guardrails.some((line) => line.includes("CI")));
});

test("withInstallOptions applies discovered repos and Linear filters", () => {
  const config = withInstallOptions(defaultConfig("/tmp/workspace"), {
    repos: [{ name: "app", path: "app", baseBranch: "main", remote: "origin" }],
    acceptedAssignees: ["gonzo"],
    requiredLabels: ["agent"]
  });
  assert.equal(config.repos[0].name, "app");
  assert.deepEqual(config.linear.acceptedAssignees, ["gonzo"]);
  assert.deepEqual(config.linear.requiredLabels, ["agent"]);
});

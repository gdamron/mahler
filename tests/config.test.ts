import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { defaultConfig, loadConfig, withInstallOptions } from "../src/config.js";

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

test("defaultConfig includes a team Definition of Done baseline", () => {
  const config = defaultConfig("/tmp/workspace");
  assert.ok(config.definitionOfDone.length >= 4);
  assert.ok(config.definitionOfDone.some((line) => line.includes("mahler check")));
  assert.ok(config.definitionOfDone.some((line) => line.includes("HANDOFF.md")));
  assert.ok(config.definitionOfDone.some((line) => line.includes("PR")));
});

test("loadConfig backfills Definition of Done for older config files", () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-config-"));
  mkdirSync(resolve(workspace, ".harness"));
  const oldConfig = { ...defaultConfig(workspace) };
  delete (oldConfig as Partial<typeof oldConfig>).definitionOfDone;
  writeFileSync(resolve(workspace, ".harness", "config.json"), `${JSON.stringify(oldConfig)}\n`);

  const config = loadConfig(workspace);
  assert.ok(config.definitionOfDone.some((line) => line.includes("mahler check")));
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

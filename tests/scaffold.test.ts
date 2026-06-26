import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { policyNames, profileNames, skillNames } from "../src/scaffold.js";

function install(workspace: string): { status: number | null; stderr: string } {
  const result = spawnSync("node", ["dist/src/cli.js", "install", workspace], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  return { status: result.status, stderr: result.stderr };
}

test("discovery scans canonical source, including branching and interview", () => {
  assert.ok(policyNames().includes("branching"), "branching policy should be discovered");
  assert.ok(policyNames().includes("interview"), "interview policy should be discovered");
  assert.ok(policyNames().includes("sub-agent-delegation"), "sub-agent delegation policy should be discovered");
  assert.ok(skillNames().includes("interview"), "interview skill should be discovered");
  for (const profile of ["implementer", "reviewer", "committer", "full-stack"]) {
    assert.ok(profileNames().includes(profile), `missing profile ${profile}`);
  }
});

test("canonical skills are well-formed", () => {
  for (const skill of skillNames()) {
    const path = resolve("skills", skill, "SKILL.md");
    const body = readFileSync(path, "utf8");
    assert.match(body, /^---\n/);
    assert.match(body, new RegExp(`name: ${skill}`));
    assert.match(body, /description:/);
  }
});

test("install writes discovered policies, skills, and profiles", () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-install-"));
  assert.equal(install(workspace).status, 0);
  // Previously omitted by the hardcoded lists — now installed via discovery.
  assert.equal(existsSync(resolve(workspace, ".harness", "policies", "branching.md")), true);
  assert.equal(existsSync(resolve(workspace, ".harness", "policies", "interview.md")), true);
  assert.equal(existsSync(resolve(workspace, ".harness", "policies", "sub-agent-delegation.md")), true);
  assert.equal(existsSync(resolve(workspace, ".agents", "skills", "interview", "SKILL.md")), true);
  assert.equal(existsSync(resolve(workspace, ".claude", "skills", "interview", "SKILL.md")), true);
  // Baseline artifacts still present.
  assert.equal(existsSync(resolve(workspace, ".agents", "skills", "work-on-issue", "SKILL.md")), true);
  assert.equal(existsSync(resolve(workspace, ".harness", "agents", "profiles", "implementer.json")), true);
  assert.equal(existsSync(resolve(workspace, ".codex", "agents", "implementer.toml")), true);
  // Overlay scaffold is created.
  assert.equal(existsSync(resolve(workspace, ".harness", "custom", "policies")), true);
  assert.equal(existsSync(resolve(workspace, ".harness", "custom", "README.md")), true);
});

test("custom overlay overrides a default and adds custom-only files; reinstall preserves both", () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-overlay-"));
  assert.equal(install(workspace).status, 0);

  const customPolicies = resolve(workspace, ".harness", "custom", "policies");
  mkdirSync(customPolicies, { recursive: true });
  const sentinel = "# Custom Commit Policy\n\nWORKSPACE SENTINEL VALUE\n";
  writeFileSync(resolve(customPolicies, "commit.md"), sentinel);
  writeFileSync(resolve(customPolicies, "house-style.md"), "# House Style\n\nCustom-only policy.\n");

  assert.equal(install(workspace).status, 0);

  const installedCommit = readFileSync(resolve(workspace, ".harness", "policies", "commit.md"), "utf8");
  assert.match(installedCommit, /WORKSPACE SENTINEL VALUE/, "override content should be used");
  assert.match(installedCommit, /Mahler default was replaced by \.harness\/custom\/policies\/commit\.md/, "provenance header present");

  const customOnly = readFileSync(resolve(workspace, ".harness", "policies", "house-style.md"), "utf8");
  assert.match(customOnly, /Custom-only policy/);
  assert.match(customOnly, /Installed from \.harness\/custom\/policies\/house-style\.md \(no Mahler default\)/);

  // The custom source files are never overwritten by reinstall.
  assert.equal(readFileSync(resolve(customPolicies, "commit.md"), "utf8"), sentinel);
});

test("install fails hard on a malformed custom source", () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-bad-overlay-"));
  assert.equal(install(workspace).status, 0);
  const customSkill = resolve(workspace, ".harness", "custom", "skills", "broken");
  mkdirSync(customSkill, { recursive: true });
  writeFileSync(resolve(customSkill, "SKILL.md"), "no frontmatter here\n");
  const result = install(workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /malformed/);
});

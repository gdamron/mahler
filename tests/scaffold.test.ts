import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("canonical skills and agent profiles are present", () => {
  for (const skill of ["work-on-issue", "select-project-issue", "review", "commit", "pr", "handoff"]) {
    const path = resolve("skills", skill, "SKILL.md");
    assert.equal(existsSync(path), true, `missing skill ${skill}`);
    const body = readFileSync(path, "utf8");
    assert.match(body, /^---\n/);
    assert.match(body, new RegExp(`name: ${skill}`));
    assert.match(body, /description:/);
  }
  for (const profile of ["implementer", "reviewer", "committer", "full-stack"]) {
    assert.equal(existsSync(resolve("agents", `${profile}.json`)), true, `missing profile ${profile}`);
  }
});

test("install writes skills and agent profiles", () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-install-"));
  const result = spawnSync("node", ["dist/src/cli.js", "install", workspace], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(resolve(workspace, ".agents", "skills", "work-on-issue", "SKILL.md")), true);
  assert.equal(existsSync(resolve(workspace, ".claude", "skills", "work-on-issue", "SKILL.md")), true);
  assert.equal(existsSync(resolve(workspace, ".harness", "agents", "profiles", "implementer.json")), true);
  assert.equal(existsSync(resolve(workspace, ".codex", "agents", "implementer.toml")), true);
  assert.equal(existsSync(resolve(workspace, ".claude", "agents", "implementer.md")), true);
  const adapter = readFileSync(resolve(workspace, ".harness", "agents", "codex", "HARNESS.md"), "utf8");
  assert.match(adapter, /\.agents\/skills/);
  assert.match(adapter, /\.harness\/agents\/profiles/);
});

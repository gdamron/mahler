import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("canonical skills and agent profiles are present", () => {
  for (const skill of ["work-on-issue", "select-project-issue", "review", "commit", "pr", "handoff"]) {
    assert.equal(existsSync(resolve("skills", `${skill}.md`)), true, `missing skill ${skill}`);
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
  assert.equal(existsSync(resolve(workspace, ".harness", "skills", "work-on-issue.md")), true);
  assert.equal(existsSync(resolve(workspace, ".harness", "agents", "profiles", "implementer.json")), true);
  const adapter = readFileSync(resolve(workspace, ".harness", "agents", "codex", "HARNESS.md"), "utf8");
  assert.match(adapter, /\.harness\/skills/);
  assert.match(adapter, /\.harness\/agents\/profiles/);
});

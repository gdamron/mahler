import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const cli = ["node", "dist/src/cli.js"] as const;

test("linear-template issue prints parseable issue JSON", () => {
  const result = spawnSync(cli[0], [cli[1], "linear-template", "issue"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.identifier, "ISSUE-123");
  assert.equal(parsed.title, "Issue title");
  assert.deepEqual(parsed.labels, ["agent"]);
});

test("linear-template project prints parseable project JSON", () => {
  const result = spawnSync(cli[0], [cli[1], "linear-template", "project"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.name, "Project name");
  assert.equal(parsed.issues[0].identifier, "ISSUE-123");
});

test("linear-template rejects unknown template kind", () => {
  const result = spawnSync(cli[0], [cli[1], "linear-template", "workspace"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Expected "issue" or "project"/);
});

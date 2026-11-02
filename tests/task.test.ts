import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { defaultConfig } from "../src/config.js";
import { issueRisk } from "../src/risk.js";

const cli = ["node", "dist/src/cli.js"] as const;

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(cli[0], [cli[1], ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function workspaceWithRepo(): string {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-task-"));
  spawnSync("git", ["init", "-q", "-b", "main", resolve(workspace, "app")]);
  assert.equal(run(["install", workspace]).status, 0);
  return workspace;
}

test("task creates a local brief under local-<slug> with its risk and no Linear routing", () => {
  const workspace = workspaceWithRepo();
  const created = run([
    "task", "Curved Declick", "--workspace", workspace, "--agent", "claude",
    "--title", "Curve the declick", "--description", "Smoothstep instead of linear.", "--risk", "Medium",
  ]);
  assert.equal(created.status, 0, created.stderr);
  assert.match(created.stdout, /Task brief ready: .*local-curved-declick/);

  const brief = resolve(workspace, ".harness", "issues", "local-curved-declick");
  for (const file of ["TASK.md", "AGENT_SESSION.md", "HANDOFF.md", "task.json"]) {
    assert.equal(existsSync(resolve(brief, file)), true, `missing ${file}`);
  }
  assert.equal(existsSync(resolve(brief, "linear-issue.json")), false);
  const task = readFileSync(resolve(brief, "TASK.md"), "utf8");
  assert.match(task, /^# local-curved-declick: Curve the declick/);
  assert.match(task, /Source: local task \(written from a conversation\)/);
  assert.match(task, /Smoothstep instead of linear\./);
  const session = readFileSync(resolve(brief, "AGENT_SESSION.md"), "utf8");
  assert.match(session, /- Risk: medium \(from the task brief\)/);
  assert.match(session, /Project labels: \(local task; none\)/);
  assert.match(session, /Local task: its labels and risk live in this brief/);
  const json = JSON.parse(readFileSync(resolve(brief, "task.json"), "utf8"));
  assert.equal(json.source, "local");
  assert.equal(json.risk, "medium");
});

test("task reads a task file, and keeps an existing local- prefix", () => {
  const workspace = workspaceWithRepo();
  const file = resolve(workspace, "task.json");
  writeFileSync(file, JSON.stringify({
    title: "Repin core",
    risk: "high",
    acceptanceCriteria: ["The product builds against the new core pin."],
    nonGoals: ["No core changes."],
  }));
  const created = run(["task", "local-repin-core", "--workspace", workspace, "--agent", "codex", "--task-file", file]);
  assert.equal(created.status, 0, created.stderr);
  const brief = resolve(workspace, ".harness", "issues", "local-repin-core");
  const task = readFileSync(resolve(brief, "TASK.md"), "utf8");
  assert.match(task, /- \[ \] The product builds against the new core pin\./);
  assert.match(task, /## Non-Goals\n\n- No core changes\./);
  assert.match(readFileSync(resolve(brief, "AGENT_SESSION.md"), "utf8"), /- Risk: high/);
});

test("task without a title or with an unknown risk fails", () => {
  const workspace = workspaceWithRepo();
  const untitled = run(["task", "x", "--workspace", workspace, "--agent", "codex"]);
  assert.notEqual(untitled.status, 0);
  assert.match(untitled.stderr, /needs a title/);
  const badRisk = run(["task", "x", "--workspace", workspace, "--agent", "codex", "--title", "t", "--risk", "huge"]);
  assert.notEqual(badRisk.status, 0);
  assert.match(badRisk.stderr, /Unknown risk level "huge"/);
});

test("an issue without a risk label asks for one in its brief", () => {
  const workspace = workspaceWithRepo();
  const created = run(["issue", "MAH-9", "--workspace", workspace, "--agent", "codex", "--title", "t"]);
  assert.equal(created.status, 0, created.stderr);
  const session = readFileSync(resolve(workspace, ".harness", "issues", "MAH-9", "AGENT_SESSION.md"), "utf8");
  assert.match(session, /- Risk: not set\. Classify it with `\.harness\/policies\/risk\.md`/);
});

test("issue risk is the highest of its field, issue labels, and project labels", () => {
  const { risk } = defaultConfig("");
  const base = { identifier: "MAH-1", title: "t", blocked: false };
  assert.equal(issueRisk({ ...base, labels: [] }, risk), undefined);
  assert.deepEqual(issueRisk({ ...base, labels: ["Risk:Low"] }, risk), { level: "low", from: "label `Risk:Low`" });
  assert.equal(issueRisk({ ...base, labels: ["risk:low"], projectLabels: ["risk:high"] }, risk)?.level, "high");
  assert.equal(issueRisk({ ...base, risk: "medium", labels: ["risk:low"] }, risk)?.level, "medium");
});

test("linear-template task prints a local task template", () => {
  const result = run(["linear-template", "task"]);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.risk, "medium");
  assert.equal(parsed.identifier, undefined);
  assert.ok(Array.isArray(parsed.acceptanceCriteria));
});

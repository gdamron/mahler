import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const cli = ["node", "dist/src/cli.js"] as const;

function installWorkspace(): string {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-decisions-"));
  const result = spawnSync(cli[0], [cli[1], "install", workspace], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return workspace;
}

function runDecide(
  workspace: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    cli[0],
    [cli[1], "decide", ...args, "--workspace", workspace],
    { encoding: "utf8" },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function decisionFiles(workspace: string): string[] {
  const dir = resolve(workspace, ".harness", "decisions");
  return readdirSync(dir).filter(
    (name) => name !== "README.md" && name.endsWith(".md"),
  );
}

test("install creates the decisions ledger directory and README", () => {
  const workspace = installWorkspace();
  assert.equal(existsSync(resolve(workspace, ".harness", "decisions")), true);
  const readme = readFileSync(
    resolve(workspace, ".harness", "decisions", "README.md"),
    "utf8",
  );
  assert.match(readme, /append-only/i);
});

test("decide writes a structured, named ledger note", () => {
  const workspace = installWorkspace();
  const { status } = runDecide(workspace, [
    "--rule",
    "skill-outside-profile",
    "--reason",
    "needed to commit while in reviewer profile to unblock the human",
    "--issue",
    "MAH-5",
    "--agent",
    "claude",
  ]);
  assert.equal(status, 0);

  const files = decisionFiles(workspace);
  assert.equal(files.length, 1);
  assert.match(files[0], /^\d{4}-\d{2}-\d{2}-skill-outside-profile\.md$/);

  const body = readFileSync(
    resolve(workspace, ".harness", "decisions", files[0]),
    "utf8",
  );
  assert.match(body, /Decisions ledger/);
  assert.match(body, /^date: \d{4}-\d{2}-\d{2}$/m);
  assert.match(body, /^issue: MAH-5$/m);
  assert.match(body, /^agent: claude$/m);
  assert.match(body, /^rule: skill-outside-profile$/m);
  assert.match(body, /needed to commit while in reviewer profile/);
});

test("decide is append-only: a same-day same-rule note does not overwrite the first", () => {
  const workspace = installWorkspace();
  const args = [
    "--rule",
    "scope",
    "--reason",
    "first reason",
    "--issue",
    "MAH-5",
  ];
  assert.equal(runDecide(workspace, args).status, 0);
  assert.equal(
    runDecide(workspace, [
      "--rule",
      "scope",
      "--reason",
      "second reason",
      "--issue",
      "MAH-5",
    ]).status,
    0,
  );

  const files = decisionFiles(workspace).sort();
  assert.equal(files.length, 2, files.join(", "));
  const bodies = files.map((name) =>
    readFileSync(resolve(workspace, ".harness", "decisions", name), "utf8"),
  );
  assert.ok(bodies.some((b) => b.includes("first reason")));
  assert.ok(bodies.some((b) => b.includes("second reason")));
});

test("decide requires --rule and --reason", () => {
  const workspace = installWorkspace();
  assert.notEqual(
    runDecide(workspace, ["--reason", "no rule given"]).status,
    0,
  );
  assert.notEqual(runDecide(workspace, ["--rule", "scope"]).status, 0);
});

test("doctor reports decisions ok when present and info (not failing) when missing", () => {
  const workspace = installWorkspace();
  const present = spawnSync(cli[0], [cli[1], "doctor", workspace], {
    encoding: "utf8",
  });
  assert.match(present.stdout, /\.harness\/decisions\/ present/);

  rmSync(resolve(workspace, ".harness", "decisions"), {
    recursive: true,
    force: true,
  });
  const missing = spawnSync(cli[0], [cli[1], "doctor", workspace], {
    encoding: "utf8",
  });
  assert.match(missing.stdout, /info \.harness\/decisions\/ missing/);
  // The repos warning makes doctor non-zero, but the decisions check itself must
  // never contribute an error or warning — assert it is reported at info level.
  assert.doesNotMatch(missing.stdout, /err .*decisions/);
  assert.doesNotMatch(missing.stdout, /warn .*decisions/);
});

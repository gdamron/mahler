import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const run = (args: string[], cwd?: string) =>
  spawnSync("node", [resolve("dist/src/cli.js"), ...args], { encoding: "utf8", cwd });

const commands = [
  "install", "issue", "project", "status", "profile", "can", "handoff",
  "decide", "check", "capacity", "cleanup", "doctor", "linear-template",
];

for (const command of commands) {
  test(`${command} --help prints its usage and writes nothing`, () => {
    const dir = mkdtempSync(resolve(tmpdir(), "mahler-help-"));
    // A real-looking positional, so a command that ignored --help would act on it.
    const result = run([command, dir, "--help"], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`^Usage: mahler ${command}\\b`));
    assert.deepEqual(readdirSync(dir), []);
  });
}

test("install refuses an unknown option before writing anything", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mahler-strict-"));
  const result = run(["install", dir, "--linear-asignee", "me"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown option: --linear-asignee/);
  assert.equal(existsSync(resolve(dir, ".harness")), false);
});

test("mahler, mahler --help, and mahler help list every command", () => {
  for (const args of [[], ["--help"], ["-h"], ["help"]]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    for (const command of commands) assert.match(result.stdout, new RegExp(`mahler ${command}\\b`));
  }
});

test("mahler help <command> prints that command's usage", () => {
  const result = run(["help", "cleanup"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^Usage: mahler cleanup <ISSUE>/);
});

test("an unknown command exits non-zero", () => {
  const result = run(["clean-up", "MAH-1"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown command: clean-up/);
});

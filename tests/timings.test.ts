import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { HarnessConfig } from "../src/types.js";
import type { IssueEvent } from "../src/events.js";
import { addPullRequests, duration, summarize, summary } from "../src/commands/timings.js";

const run = (args: string[]) => spawnSync("node", ["dist/src/cli.js", ...args], { encoding: "utf8" });
const git = (cwd: string, ...args: string[]) =>
  assert.equal(spawnSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args]).status, 0);

/** A workspace with one repo `app`, a passing check, a brief for MAH-1, and its worktree. */
function setup(): { workspace: string; app: string; worktree: string; events: () => IssueEvent[] } {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-timings-"));
  const app = resolve(workspace, "app");
  spawnSync("git", ["init", "-q", "-b", "main", app]);
  writeFileSync(resolve(app, "README.md"), "app\n");
  git(app, "add", ".");
  git(app, "commit", "-qm", "init");
  assert.equal(run(["install", workspace]).status, 0);
  const configPath = resolve(workspace, ".harness", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as HarnessConfig;
  config.repos[0].checks = { test: "node -e \"process.exit(0)\"" };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const brief = run(["issue", "MAH-1", "--workspace", workspace, "--agent", "claude", "--title", "A change"]);
  assert.equal(brief.status, 0, brief.stderr);
  const worktree = resolve(workspace, "workspaces", "issues", "MAH-1", "repos", "app");
  git(app, "worktree", "add", "-q", "-b", "t/mah-1", worktree);
  const log = resolve(workspace, ".harness", "issues", "MAH-1", "events.jsonl");
  return {
    workspace,
    app,
    worktree,
    events: () =>
      existsSync(log)
        ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as IssueEvent)
        : [],
  };
}

test("commands record an issue's events as they run", () => {
  const { workspace, app, events } = setup();
  assert.deepEqual(events().map((event) => event.event), ["brief"]);
  assert.equal(events()[0].agent, "claude");

  assert.equal(run(["check", "--workspace", workspace, "--issue", "MAH-1"]).status, 0);
  assert.equal(run(["check", "--workspace", workspace, "--issue", "MAH-1"]).status, 0);
  const checks = events().filter((event) => event.event === "check");
  assert.equal(checks.length, 2);
  assert.equal(checks[0].passed, true);
  assert.deepEqual(checks[0].branches, [
    { repo: "app", worktree: "app", branch: "t/mah-1", head: (checks[0].branches as Array<{ head: string }>)[0].head },
  ]);
  const [ran] = checks[0].checks as Array<{ check: string; cached: boolean; ok: boolean }>;
  assert.deepEqual({ check: ran.check, cached: ran.cached, ok: ran.ok }, { check: "app/test", cached: false, ok: true });
  assert.equal((checks[1].checks as Array<{ cached: boolean }>)[0].cached, true);

  git(app, "checkout", "-q", "-b", "tests", "main");
  writeFileSync(resolve(app, "accept.txt"), "frozen\n");
  git(app, "add", ".");
  git(app, "commit", "-qm", "acceptance tests");
  git(app, "checkout", "-q", "main");
  assert.equal(run(["acceptance", "freeze", "--workspace", workspace, "--issue", "MAH-1", "--repo", "app", "--commit", "tests", "--worktree", "tests/app"]).status, 0);
  const freeze = events().find((event) => event.event === "freeze");
  assert.deepEqual({ repo: freeze?.repo, files: freeze?.files, refreeze: freeze?.refreeze }, { repo: "app", files: 1, refreeze: false });

  assert.equal(run(["cleanup", "MAH-1", "--workspace", workspace, "--dry-run"]).status, 0);
  assert.equal(events().some((event) => event.event === "cleanup"), false);
  assert.equal(run(["cleanup", "MAH-1", "--workspace", workspace]).status, 0);
  assert.equal(events().at(-1)?.event, "cleanup");
});

test("a check outside any issue, or a failing one, is recorded only where it belongs", () => {
  const { workspace, worktree, events } = setup();
  assert.equal(run(["check", "--workspace", workspace]).status, 0);
  assert.equal(events().filter((event) => event.event === "check").length, 0);

  writeFileSync(resolve(worktree, "dirty.txt"), "x\n");
  const configPath = resolve(workspace, ".harness", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as HarnessConfig;
  config.repos[0].checks = { test: "node -e \"process.exit(1)\"" };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  assert.notEqual(run(["check", "--workspace", workspace, "--path", worktree]).status, 0);
  const [failed] = events().filter((event) => event.event === "check");
  assert.equal(failed.passed, false);
});

test("timings reports an issue's spans and check time, and says so when nothing is recorded", () => {
  const { workspace } = setup();
  assert.equal(run(["check", "--workspace", workspace, "--issue", "MAH-1"]).status, 0);
  assert.equal(run(["check", "--workspace", workspace, "--issue", "MAH-1"]).status, 0);

  const report = run(["timings", "--workspace", workspace, "--no-prs"]);
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /MAH-1 {2}\(brief \d{4}-\d{2}-\d{2} \d{2}:\d{2}Z\)/);
  assert.match(report.stdout, /brief → first passing check/);
  assert.match(report.stdout, /checks: 2 run\(s\), 2 passed, .* running; 1 of 2 check\(s\) skipped as already passed/);
  assert.match(report.stdout, /include time waiting on a human or on CI/);

  const json = JSON.parse(run(["timings", "--workspace", workspace, "--no-prs", "--json"]).stdout);
  assert.equal(json.issues[0].issue, "MAH-1");
  assert.equal(json.issues[0].checks.cached, 1);

  assert.match(run(["timings", "--workspace", workspace, "--no-prs", "--issue", "MAH-2"]).stdout, /No events recorded for MAH-2/);
  assert.match(run(["timings", "--workspace", workspace, "--no-prs", "--since", "2999-01-01"]).stdout, /No events recorded yet/);
  assert.match(run(["timings", "--workspace", workspace, "--since", "soon"]).stderr, /is not a date/);
});

const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes)).toISOString();

test("summarize measures spans from the brief and counts checks, freezes, and suite runs", () => {
  const row = summarize("MAH-1", [
    { at: at(0), event: "brief" },
    { at: at(30), event: "check", passed: false, ms: 120000, checks: [{ cached: false }, { cached: false }] },
    { at: at(45), event: "freeze", refreeze: false },
    { at: at(50), event: "freeze", refreeze: true },
    { at: at(60), event: "check", passed: true, ms: 60000, checks: [{ cached: true }, { cached: false }] },
    { at: at(70), event: "acceptance-run", passed: true, ms: 30000 },
    { at: at(80), event: "mark", name: "promoted" },
    { at: at(200), event: "cleanup" },
  ]);
  assert.deepEqual(row.minutes, { firstCheck: 30, firstPassingCheck: 60, firstFreeze: 45, promoted: 80, cleanup: 200 });
  assert.equal(row.tester, undefined);
  assert.deepEqual(row.checks, { runs: 2, passed: 1, minutes: 3, total: 4, cached: 1 });
  assert.deepEqual(row.freezes, { total: 2, refreezes: 1 });
  assert.deepEqual(row.acceptanceRuns, { runs: 1, passed: 1, minutes: 0.5 });
});

test("PR times count an issue as merged only when every PR has merged", () => {
  const pr = (number: number, created: number, merged: number | null) => ({
    repo: "app", number, createdAt: at(created), mergedAt: merged === null ? null : at(merged), additions: 10, deletions: 2,
  });
  const open = summarize("MAH-1", [{ at: at(0), event: "brief" }]);
  addPullRequests(open, at(0), [pr(1, 90, 120), pr(2, 100, null)]);
  assert.equal(open.minutes.firstPr, 90);
  delete open.minutes.promoted;
  assert.equal(open.minutes.lastMerge, undefined);
  assert.deepEqual(open.prs, { count: 2, merged: 1, additions: 20, deletions: 4, numbers: ["app#1", "app#2"] });

  const done = summarize("MAH-2", [{ at: at(0), event: "brief" }]);
  addPullRequests(done, at(0), [pr(3, 90, 120), pr(4, 100, 150)]);
  assert.equal(done.minutes.lastMerge, 150);

  const medians = summary([open, done]).medianMinutes;
  assert.equal(medians.firstPr, 90);
  assert.equal(medians.lastMerge, 150);
});

test("duration reads as seconds, minutes, hours, or days", () => {
  assert.deepEqual([0.5, 12, 185, 3000].map(duration), ["30s", "12m", "3h 05m", "2d 2h"]);
});

test("mark records a known boundary for an issue that has a brief", () => {
  const { workspace, events } = setup();
  const marked = run(["mark", "MAH-1", "review-start", "--workspace", workspace, "--note", "round 1"]);
  assert.equal(marked.status, 0, marked.stderr);
  assert.match(marked.stdout, /Marked review-start for MAH-1/);
  const last = events().at(-1);
  assert.deepEqual({ event: last?.event, name: last?.name, note: last?.note }, { event: "mark", name: "review-start", note: "round 1" });

  const unknown = run(["mark", "MAH-1", "lunch", "--workspace", workspace]);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unknown mark "lunch"\. Expected one of: tester-start, tester-done, review-start, review-done, promoted/);
  const stranger = run(["mark", "MAH-9", "promoted", "--workspace", workspace]);
  assert.notEqual(stranger.status, 0);
  assert.match(stranger.stderr, /No brief for MAH-9/);
  assert.equal(existsSync(resolve(workspace, ".harness", "issues", "MAH-9")), false);
});

test("marks pair into tester time and review rounds, and a missing half doesn't break the count", () => {
  const m = (minutes: number, name: string): IssueEvent => ({ at: at(minutes), event: "mark", name });
  const row = summarize("MAH-1", [
    { at: at(0), event: "brief" },
    m(10, "tester-start"), m(40, "tester-done"),
    m(20, "review-start"), m(35, "review-done"),
    m(50, "review-start"), m(55, "review-done"),
    m(60, "review-start"),
    m(90, "promoted"),
  ]);
  assert.deepEqual(row.tester, { runs: 1, minutes: 30 });
  assert.deepEqual(row.review, { rounds: 3, minutes: 20 });
  assert.equal(row.minutes.promoted, 90);

  const doneOnly = summarize("MAH-2", [{ at: at(0), event: "brief" }, m(30, "tester-done")]);
  assert.deepEqual(doneOnly.tester, { runs: 1, minutes: 0 });

  const totals = summary([row, doneOnly, summarize("MAH-3", [{ at: at(0), event: "brief" }])]);
  assert.equal(totals.medianTesterMinutes, 15);
  assert.equal(totals.medianReviewRounds, 3);

  const { workspace } = setup();
  for (const name of ["tester-start", "tester-done", "review-start", "review-done"]) {
    assert.equal(run(["mark", "MAH-1", name, "--workspace", workspace]).status, 0);
  }
  const report = run(["timings", "--workspace", workspace, "--no-prs"]).stdout;
  assert.match(report, /tester: 1 run\(s\), /);
  assert.match(report, /review: 1 round\(s\), /);
});

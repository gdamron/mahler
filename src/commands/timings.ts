import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { type Flags, stringFlag, workspaceFlag } from "../args.js";
import { issuePaths, loadConfig } from "../config.js";
import { existsSync } from "node:fs";
import { type IssueEvent, type MarkName, markNames, readEvents, recordEvent } from "../events.js";
import type { HarnessConfig } from "../types.js";
import { abs, listDirectories } from "../util.js";

interface PullRequest {
  repo: string;
  number: number;
  createdAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
}

/** What one issue's event log, and its PRs when the forge was asked, add up to. */
export interface IssueTimings {
  issue: string;
  /** When the brief was first created: the start every span is measured from. */
  briefAt?: string;
  cleanupAt?: string;
  /** Minutes from the brief to each milestone that was reached. */
  minutes: {
    firstCheck?: number;
    firstPassingCheck?: number;
    firstFreeze?: number;
    promoted?: number;
    firstPr?: number;
    lastMerge?: number;
    cleanup?: number;
  };
  checks: {
    runs: number;
    passed: number;
    /** Minutes spent inside `mahler check`. */
    minutes: number;
    /** Individual checks across all runs, and how many the pass cache skipped. */
    total: number;
    cached: number;
  };
  freezes: { total: number; refreezes: number };
  /** From `mahler mark`: absent when the issue has no such marks. */
  tester?: { runs: number; minutes: number };
  review?: { rounds: number; minutes: number };
  acceptanceRuns: { runs: number; passed: number; minutes: number };
  prs?: { count: number; merged: number; additions: number; deletions: number; numbers: string[] };
}

/**
 * Reports where an issue's time went, from the events Mahler's own commands
 * recorded (`.harness/issues/<ISSUE>/events.jsonl`) and, unless `--no-prs`,
 * the PRs opened from the branches `mahler check` saw. Wall-clock spans
 * include time spent waiting on a human or on CI.
 */
export function timings(flags: Flags): void {
  const workspace = workspaceFlag(flags);
  const config = loadConfig(workspace);
  const only = stringFlag(flags, "issue");
  const since = stringFlag(flags, "since");
  if (since && Number.isNaN(Date.parse(since))) {
    throw new Error(`--since ${since} is not a date. Use YYYY-MM-DD.`);
  }
  const briefRoot = resolve(workspace, ".harness", "issues");
  const issues = only ? [only] : listDirectories(briefRoot);
  const rows: IssueTimings[] = [];
  let forgeNote = "";
  for (const issue of issues) {
    const events = readEvents(resolve(briefRoot, issue));
    if (events.length === 0) continue;
    const row = summarize(issue, events);
    const start = row.briefAt ?? events[0].at;
    if (since && Date.parse(start) < Date.parse(since)) continue;
    if (flags["no-prs"] !== true) {
      const found = pullRequests(workspace, config, events);
      if (found.error) forgeNote = found.error;
      else addPullRequests(row, start, found.prs);
    }
    rows.push(row);
  }
  if (flags.json === true) {
    console.log(JSON.stringify({ issues: rows, summary: summary(rows) }, null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log(
      only
        ? `No events recorded for ${only}. Events start when a brief is created with this version of Mahler.`
        : "No events recorded yet. Events start when a brief is created with this version of Mahler.",
    );
    return;
  }
  for (const row of rows) printIssue(row);
  if (rows.length > 1) printSummary(summary(rows), rows.length);
  if (forgeNote) console.log(`\nnote: PR times were left out (${forgeNote}).`);
  console.log("\nSpans are wall-clock from the brief, so they include time waiting on a human or on CI.");
}

/**
 * Records a boundary no command sees (`mahler mark <ISSUE> <name>`): a tester
 * or reviewer starting or reporting back, or promotion.
 */
export function mark(issue: string, name: string, flags: Flags): void {
  const workspace = workspaceFlag(flags);
  const config = loadConfig(workspace);
  if (!(markNames as readonly string[]).includes(name)) {
    throw new Error(`Unknown mark "${name}". Expected one of: ${markNames.join(", ")}.`);
  }
  if (!existsSync(issuePaths(workspace, config, issue).meta)) {
    throw new Error(`No brief for ${issue} under .harness/issues/. Marks belong to an issue that has one.`);
  }
  const note = stringFlag(flags, "note");
  recordEvent(workspace, config, issue, "mark", { name, ...(note ? { note } : {}) });
  console.log(`Marked ${name} for ${issue}.`);
}

/**
 * Pairs each `<kind>-start` mark with the next `<kind>-done`. A start with no
 * done (still running, or the agent forgot) counts as a run with no time.
 */
function paired(events: IssueEvent[], kind: "tester" | "review"): { runs: number; minutes: number } | undefined {
  const marks = events.filter((event) => event.event === "mark");
  const is = (event: IssueEvent, name: MarkName) => event.name === name;
  let runs = 0;
  let ms = 0;
  let open: string | undefined;
  for (const event of marks) {
    if (is(event, `${kind}-start`)) {
      runs += 1;
      open = event.at;
    } else if (is(event, `${kind}-done`)) {
      // A done with no start still shows the step happened.
      if (open) ms += Date.parse(event.at) - Date.parse(open);
      else runs += 1;
      open = undefined;
    }
  }
  return runs === 0 ? undefined : { runs, minutes: round(ms / 60000) };
}

/** Pure: an issue's events reduced to spans and counts. */
export function summarize(issue: string, events: IssueEvent[]): IssueTimings {
  const first = (name: IssueEvent["event"], test: (event: IssueEvent) => boolean = () => true) =>
    events.find((event) => event.event === name && test(event))?.at;
  const briefAt = first("brief");
  const start = briefAt ?? events[0]?.at;
  const span = (at: string | undefined) => (at && start ? minutesBetween(start, at) : undefined);
  const checks = events.filter((event) => event.event === "check");
  const each = checks.flatMap((event) => (Array.isArray(event.checks) ? (event.checks as Array<{ cached?: boolean }>) : []));
  const freezes = events.filter((event) => event.event === "freeze");
  const runs = events.filter((event) => event.event === "acceptance-run");
  const cleanupAt = [...events].reverse().find((event) => event.event === "cleanup")?.at;
  const tester = paired(events, "tester");
  const review = paired(events, "review");
  const ms = (list: IssueEvent[]) => list.reduce((sum, event) => sum + (typeof event.ms === "number" ? event.ms : 0), 0);
  return {
    issue,
    briefAt,
    cleanupAt,
    minutes: {
      firstCheck: span(first("check")),
      firstPassingCheck: span(first("check", (event) => event.passed === true)),
      firstFreeze: span(first("freeze")),
      promoted: span(first("mark", (event) => event.name === "promoted")),
      cleanup: span(cleanupAt),
    },
    checks: {
      runs: checks.length,
      passed: checks.filter((event) => event.passed === true).length,
      minutes: round(ms(checks) / 60000),
      total: each.length,
      cached: each.filter((check) => check.cached === true).length,
    },
    freezes: { total: freezes.length, refreezes: freezes.filter((event) => event.refreeze === true).length },
    ...(tester ? { tester } : {}),
    ...(review ? { review: { rounds: review.runs, minutes: review.minutes } } : {}),
    acceptanceRuns: {
      runs: runs.length,
      passed: runs.filter((event) => event.passed === true).length,
      minutes: round(ms(runs) / 60000),
    },
  };
}

/** Pure: folds an issue's PRs into its timings. */
export function addPullRequests(row: IssueTimings, start: string, prs: PullRequest[]): void {
  if (prs.length === 0) return;
  const created = prs.map((pr) => pr.createdAt).sort();
  const merged = prs.flatMap((pr) => (pr.mergedAt ? [pr.mergedAt] : [])).sort();
  row.minutes.firstPr = minutesBetween(start, created[0]);
  // "Merged" means the whole issue: every PR it opened has merged.
  if (merged.length === prs.length) row.minutes.lastMerge = minutesBetween(start, merged[merged.length - 1]);
  row.prs = {
    count: prs.length,
    merged: merged.length,
    additions: prs.reduce((sum, pr) => sum + pr.additions, 0),
    deletions: prs.reduce((sum, pr) => sum + pr.deletions, 0),
    numbers: prs.map((pr) => `${pr.repo}#${pr.number}`),
  };
}

/**
 * The PRs opened from the branches `mahler check` recorded for the issue,
 * asked of the forge with `gh`. Base branches are left out: a check run on a
 * repo's own checkout is not the issue's branch.
 */
function pullRequests(
  workspace: string,
  config: HarnessConfig,
  events: IssueEvent[],
): { prs: PullRequest[]; error?: string } {
  const seen = new Map<string, { repo: string; branch: string }>();
  for (const event of events) {
    if (event.event !== "check" || !Array.isArray(event.branches)) continue;
    for (const entry of event.branches as Array<{ repo?: string; branch?: string }>) {
      const repo = config.repos.find((candidate) => candidate.name === entry.repo);
      if (!repo || !entry.branch || entry.branch === repo.baseBranch) continue;
      seen.set(`${repo.name}\0${entry.branch}`, { repo: repo.name, branch: entry.branch });
    }
  }
  const prs: PullRequest[] = [];
  for (const { repo, branch } of seen.values()) {
    const cwd = abs(workspace, config.repos.find((candidate) => candidate.name === repo)?.path ?? repo);
    const result = spawnSync(
      "gh",
      ["pr", "list", "--head", branch, "--state", "all", "--json", "number,createdAt,mergedAt,additions,deletions"],
      { cwd, encoding: "utf8" },
    );
    if (result.error) return { prs: [], error: "gh is not installed" };
    if (result.status !== 0) return { prs: [], error: `gh failed in ${repo}: ${result.stderr.trim().split("\n")[0]}` };
    try {
      for (const pr of JSON.parse(result.stdout) as Array<Omit<PullRequest, "repo">>) prs.push({ repo, ...pr });
    } catch {
      return { prs: [], error: `gh returned unreadable output in ${repo}` };
    }
  }
  return { prs };
}

interface Summary {
  medianMinutes: Partial<Record<keyof IssueTimings["minutes"], number>>;
  /** Medians over the issues that have the marks. */
  medianTesterMinutes?: number;
  medianReviewMinutes?: number;
  medianReviewRounds?: number;
  checkMinutes: number;
  checksTotal: number;
  checksCached: number;
  refreezes: number;
}

export function summary(rows: IssueTimings[]): Summary {
  const keys: Array<keyof IssueTimings["minutes"]> = [
    "firstCheck", "firstPassingCheck", "firstFreeze", "promoted", "firstPr", "lastMerge", "cleanup",
  ];
  const medianMinutes: Summary["medianMinutes"] = {};
  for (const key of keys) {
    const values = rows.flatMap((row) => (row.minutes[key] === undefined ? [] : [row.minutes[key] as number]));
    if (values.length > 0) medianMinutes[key] = median(values);
  }
  const of = (values: number[]) => (values.length > 0 ? median(values) : undefined);
  const testers = rows.flatMap((row) => (row.tester ? [row.tester] : []));
  const reviews = rows.flatMap((row) => (row.review ? [row.review] : []));
  return {
    medianMinutes,
    ...(testers.length > 0 ? { medianTesterMinutes: of(testers.map((entry) => entry.minutes)) } : {}),
    ...(reviews.length > 0
      ? {
          medianReviewMinutes: of(reviews.map((entry) => entry.minutes)),
          medianReviewRounds: of(reviews.map((entry) => entry.rounds)),
        }
      : {}),
    checkMinutes: round(rows.reduce((sum, row) => sum + row.checks.minutes, 0)),
    checksTotal: rows.reduce((sum, row) => sum + row.checks.total, 0),
    checksCached: rows.reduce((sum, row) => sum + row.checks.cached, 0),
    refreezes: rows.reduce((sum, row) => sum + row.freezes.refreezes, 0),
  };
}

const labels: Record<keyof IssueTimings["minutes"], string> = {
  firstCheck: "first check",
  firstPassingCheck: "first passing check",
  firstFreeze: "tester suite frozen",
  promoted: "tests promoted",
  firstPr: "first PR opened",
  lastMerge: "all PRs merged",
  cleanup: "cleanup",
};

function printIssue(row: IssueTimings): void {
  console.log(`\n${row.issue}${row.briefAt ? `  (brief ${row.briefAt.slice(0, 16).replace("T", " ")}Z)` : "  (no brief event: spans start at the first event)"}`);
  for (const key of Object.keys(labels) as Array<keyof IssueTimings["minutes"]>) {
    const value = row.minutes[key];
    if (value !== undefined) console.log(`  brief → ${labels[key].padEnd(20)} ${duration(value)}`);
  }
  const { checks, freezes, acceptanceRuns, prs, tester, review } = row;
  if (tester) console.log(`  tester: ${tester.runs} run(s), ${duration(tester.minutes)}`);
  if (review) console.log(`  review: ${review.rounds} round(s), ${duration(review.minutes)}`);
  if (checks.runs > 0) {
    console.log(
      `  checks: ${checks.runs} run(s), ${checks.passed} passed, ${duration(checks.minutes)} running; ${checks.cached} of ${checks.total} check(s) skipped as already passed`,
    );
  }
  if (freezes.total > 0) console.log(`  freezes: ${freezes.total} (${freezes.refreezes} re-freeze(s))`);
  if (acceptanceRuns.runs > 0) {
    console.log(`  project suite: ${acceptanceRuns.runs} run(s), ${acceptanceRuns.passed} passed, ${duration(acceptanceRuns.minutes)} running`);
  }
  if (prs) {
    console.log(`  PRs: ${prs.count} (${prs.merged} merged), +${prs.additions} −${prs.deletions}: ${prs.numbers.join(", ")}`);
  }
}

function printSummary(total: Summary, count: number): void {
  console.log(`\nAcross ${count} issues (medians):`);
  for (const key of Object.keys(labels) as Array<keyof IssueTimings["minutes"]>) {
    const value = total.medianMinutes[key];
    if (value !== undefined) console.log(`  brief → ${labels[key].padEnd(20)} ${duration(value)}`);
  }
  console.log(
    `  checks: ${duration(total.checkMinutes)} running in all; ${total.checksCached} of ${total.checksTotal} skipped as already passed`,
  );
  console.log(`  re-freezes: ${total.refreezes}`);
  if (total.medianTesterMinutes !== undefined) console.log(`  tester: ${duration(total.medianTesterMinutes)} per issue that marked it`);
  if (total.medianReviewMinutes !== undefined) {
    console.log(`  review: ${duration(total.medianReviewMinutes)} over ${total.medianReviewRounds} round(s) per issue that marked it`);
  }
}

function minutesBetween(from: string, to: string): number {
  return round((Date.parse(to) - Date.parse(from)) / 60000);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return round(sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
}

/** Minutes as `45s`, `12m`, `3h 05m`, or `2d 4h`. */
export function duration(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(Math.round(minutes - hours * 60)).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

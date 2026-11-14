import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { issuePaths } from "./config.js";
import type { HarnessConfig } from "./types.js";

/**
 * One line of an issue's `events.jsonl`: something a Mahler command did for
 * the issue, and when. Commands record these as a side effect, so agents log
 * nothing themselves; `mahler timings` reads them back.
 */
export interface IssueEvent {
  /** ISO time the event was recorded (for a timed event, when it ended). */
  at: string;
  event: "brief" | "check" | "freeze" | "acceptance-run" | "cleanup" | "mark";
  [key: string]: unknown;
}

export const eventsFile = "events.jsonl";

/**
 * Boundaries no Mahler command sees, which an agent records with
 * `mahler mark`. A fixed list, so `mahler timings` can pair and count them.
 */
export const markNames = ["tester-start", "tester-done", "review-start", "review-done", "promoted"] as const;
export type MarkName = (typeof markNames)[number];

/**
 * Appends an event to the issue's log. One log per issue, so parallel agents
 * on different issues never share a file. Recording is best effort: a log
 * that can't be written never fails the command that tried.
 */
export function recordEvent(
  workspace: string,
  config: HarnessConfig,
  issue: string,
  event: IssueEvent["event"],
  data: Record<string, unknown> = {},
): void {
  try {
    const dir = issuePaths(workspace, config, issue).meta;
    mkdirSync(dir, { recursive: true });
    appendFileSync(resolve(dir, eventsFile), `${JSON.stringify({ at: new Date().toISOString(), event, ...data })}\n`);
  } catch {
    // Timing is a record, not a control.
  }
}

/** An issue's events, oldest first. Lines that don't parse are skipped. */
export function readEvents(dir: string): IssueEvent[] {
  const path = resolve(dir, eventsFile);
  if (!existsSync(path)) return [];
  const events: IssueEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as IssueEvent;
      if (typeof parsed.at === "string" && typeof parsed.event === "string") events.push(parsed);
    } catch {
      // A torn or hand-edited line.
    }
  }
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

import { availableParallelism, loadavg } from "node:os";
import { loadConfig } from "../config.js";
import type { ConcurrencyConfig } from "../types.js";

export interface CapacityReading {
  cores: number;
  /** 1-, 5-, and 15-minute load averages; undefined where the OS has none (Windows). */
  load?: [number, number, number];
}

/**
 * Advisory capacity report for agents deciding whether to launch more
 * sub-agents or run heavy commands. Never blocks: the caps are Tier 1 norms.
 */
export function capacity(workspace: string): void {
  console.log(
    capacityReport(loadConfig(workspace).concurrency, readCapacity()),
  );
}

export function readCapacity(): CapacityReading {
  const load = loadavg() as [number, number, number];
  return {
    cores: availableParallelism(),
    load: load.every((value) => value === 0) ? undefined : load,
  };
}

export function capacityReport(
  caps: ConcurrencyConfig,
  reading: CapacityReading,
): string {
  const lines = [
    `cores: ${reading.cores}`,
    `caps: ${caps.maxIssueAgents} issue agents per composer, ${caps.maxSliceAgents} slice agents per conductor, ${caps.maxHeavyCommands} heavy commands at once`,
  ];
  if (!reading.load) {
    lines.push(
      "load: unavailable on this platform",
      "verdict: unknown — stay within the caps and serialize heavy commands",
    );
    return lines.join("\n");
  }
  const [one, five, fifteen] = reading.load;
  const perCore = one / reading.cores;
  lines.push(
    `load: ${fmt(one)} / ${fmt(five)} / ${fmt(fifteen)} (1m ${fmt(perCore)} per core; threshold ${fmt(caps.loadPerCore)})`,
  );
  if (perCore >= caps.loadPerCore) {
    lines.push(
      "verdict: busy — start no new agents or heavy commands; finish or wait for running work, and prefer focused tests over full suites",
    );
  } else {
    const spare = Math.floor(caps.loadPerCore * reading.cores - one);
    lines.push(
      `verdict: ok — about ${spare} core(s) of headroom; stay within the caps`,
    );
  }
  return lines.join("\n");
}

function fmt(value: number): string {
  return value.toFixed(2);
}

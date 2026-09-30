import { resolve } from "node:path";

export type Flags = Record<string, string | boolean>;

export interface Args {
  command?: string;
  rest: string[];
  flags: Flags;
}

export function parseArgs(argv: string[]): Args {
  const [command, ...tail] = argv;
  const rest: string[] = [];
  const flags: Flags = {};
  for (let index = 0; index < tail.length; index += 1) {
    const part = tail[index];
    if (part.startsWith("--")) {
      const key = part.slice(2);
      const next = tail[index + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }
    } else {
      rest.push(part);
    }
  }
  return { command, rest, flags };
}

export function workspaceFlag(flags: Flags): string {
  return resolve(String(flags.workspace ?? process.cwd()));
}

export function stringFlag(flags: Flags, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

export function listFlag(flags: Flags, key: string): string[] {
  const value = stringFlag(flags, key);
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function required(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

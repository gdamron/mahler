import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type Flags = Record<string, string | boolean>;

/** How a flag takes its value: `string` reads the next argument, `boolean` never does. */
export type FlagKind = "string" | "boolean";

export interface ArgSpec {
  /** Most positional arguments the command accepts. */
  positionals: number;
  flags: Record<string, FlagKind>;
}

/** A mistake in how the command was called; the CLI prints usage with it. */
export class UsageError extends Error {}

export interface Args {
  rest: string[];
  flags: Flags;
}

/** `--help` or `-h` anywhere asks for usage, never for the command to run. */
export function wantsHelp(argv: string[]): boolean {
  return argv.some((part) => part === "--help" || part === "-h");
}

/**
 * Parse a command's arguments against its spec. Unknown flags, extra
 * positionals, and string flags without a value are errors, not ignored:
 * several commands write or delete files, so a mistyped invocation must stop
 * before doing anything.
 */
export function parseArgs(argv: string[], spec: ArgSpec): Args {
  const rest: string[] = [];
  const flags: Flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (part.startsWith("-") && part !== "-") {
      const key = part.startsWith("--") ? part.slice(2) : part;
      const kind = part.startsWith("--") ? spec.flags[key] : undefined;
      if (!kind) throw new UsageError(`unknown option: ${part}`);
      if (key in flags) throw new UsageError(`option given twice: ${part}`);
      if (kind === "boolean") {
        flags[key] = true;
        continue;
      }
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError(`option needs a value: ${part}`);
      }
      flags[key] = next;
      index += 1;
    } else {
      rest.push(part);
    }
  }
  if (rest.length > spec.positionals) {
    throw new UsageError(`unexpected argument: ${rest[spec.positionals]}`);
  }
  return { rest, flags };
}

/**
 * The product workspace: `--workspace`, else the nearest directory at or above
 * the current one that holds `.harness/config.json` (agents usually run from a
 * worktree inside the workspace), else the current directory.
 */
export function workspaceFlag(flags: Flags): string {
  if (typeof flags.workspace === "string") return resolve(flags.workspace);
  return findWorkspace(process.cwd()) ?? resolve(process.cwd());
}

function findWorkspace(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(resolve(dir, ".harness", "config.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
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
  if (!value) throw new UsageError(message);
  return value;
}

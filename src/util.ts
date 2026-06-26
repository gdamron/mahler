import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

/** Absolute path to the canonical Mahler source root (two levels up from compiled dist/src/). */
export function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function writeFileEnsured(path: string, content: string): void {
  ensureDir(dirname(path));
  writeFileSync(path, content);
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

export function listDirectories(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

/** Base names (without extension) of files in `path` ending with `ext`; `[]` if the dir is absent. */
export function listFilesWithExtension(path: string, ext: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(ext))
    .map((entry) => entry.name.slice(0, -ext.length));
}

export function abs(workspace: string, path: string): string {
  return resolve(workspace, path);
}

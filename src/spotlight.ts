import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import type { Finding } from "./types.js";

// Spotlight indexes every file in every worktree, and a dependency install is
// often 100k+ files, so issue worktrees can keep `mds_stores` busy for hours.
// Folder markers (`.metadata_never_index`, a `.noindex` suffix) are not
// honored for ordinary folders on recent macOS; the reliable exclusion is
// System Settings → Spotlight → Search Privacy, which only the human can set.
// Mahler detects the problem and says how to fix it.

/** Matches every indexed item; `kMDItemFSName == "*"` silently returns 0. */
const everyItem = 'kMDItemContentTypeTree == "public.item"';

/** Items Spotlight has indexed under `dir`, or undefined when it can't tell (not macOS, query failed). */
export function spotlightIndexedCount(dir: string): number | undefined {
  if (process.platform !== "darwin" || !existsSync(dir)) return undefined;
  const result = spawnSync("mdfind", ["-count", "-onlyin", dir, everyItem], {
    encoding: "utf8",
    timeout: 10_000,
  });
  // mdfind may be missing from PATH; spawnSync then reports an error and no stdout.
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") {
    return undefined;
  }
  const count = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(count) ? count : undefined;
}

/** Doctor finding for Spotlight indexing of the worktree root; undefined off macOS. */
export function spotlightFinding(
  dir: string,
  label: string,
  count = spotlightIndexedCount(dir),
): Finding | undefined {
  if (count === undefined) return undefined;
  if (count === 0) {
    return { level: "ok", message: `Spotlight is not indexing ${label}/` };
  }
  return {
    level: "warn",
    message: `Spotlight has indexed ${count} items under ${label}/ — every worktree's files (including dependency installs) cost CPU to index. Ask the human to add ${dir} in System Settings → Spotlight → Search Privacy; folder markers like .metadata_never_index are not honored there.`,
  };
}

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { listDirectories, listFilesWithExtension, repoRoot } from "./util.js";

// ---------------------------------------------------------------------------
// Canonical discovery
//
// The install set is derived by scanning the canonical source directories, not
// a hardcoded list. New files (policies, skills, profiles) install automatically
// and `doctor` follows. `adapterRuntimes` stays hardcoded — adapters are
// code-generated (see render.ts::nativeAdapter), not read from disk.
// ---------------------------------------------------------------------------

export function policyNames(): string[] {
  return listFilesWithExtension(resolve(repoRoot(), "policies"), ".md").sort();
}

export function skillNames(): string[] {
  const root = resolve(repoRoot(), "skills");
  return listDirectories(root)
    .filter((name) => existsSync(resolve(root, name, "SKILL.md")))
    .sort();
}

export function profileNames(): string[] {
  return listFilesWithExtension(resolve(repoRoot(), "agents"), ".json").sort();
}

export function adapterRuntimes(): Array<"codex" | "claude"> {
  return ["codex", "claude"];
}

// ---------------------------------------------------------------------------
// Customization overlay
//
// `.harness/custom/{policies,skills,agents}/` lets a workspace adapt content
// without forking. On install, custom files override same-named defaults and
// custom-only files are included. Reinstall never overwrites the overlay.
// ---------------------------------------------------------------------------

export type OverlayKind = "policies" | "skills" | "agents";

function customDir(workspace: string, kind: OverlayKind): string {
  return resolve(workspace, ".harness", "custom", kind);
}

function union(canonical: string[], custom: string[]): string[] {
  return Array.from(new Set([...canonical, ...custom])).sort();
}

function customPolicyNames(workspace: string): string[] {
  return listFilesWithExtension(customDir(workspace, "policies"), ".md");
}

function customSkillNames(workspace: string): string[] {
  const root = customDir(workspace, "skills");
  return listDirectories(root).filter((name) => existsSync(resolve(root, name, "SKILL.md")));
}

function customProfileNames(workspace: string): string[] {
  return listFilesWithExtension(customDir(workspace, "agents"), ".json");
}

/** Union of canonical and custom policy names. */
export function installedPolicyNames(workspace: string): string[] {
  return union(policyNames(), customPolicyNames(workspace));
}

/** Union of canonical and custom skill names. */
export function installedSkillNames(workspace: string): string[] {
  return union(skillNames(), customSkillNames(workspace));
}

/** Union of canonical and custom profile names. */
export function installedProfileNames(workspace: string): string[] {
  return union(profileNames(), customProfileNames(workspace));
}

/** A resolved source file: where its content came from and how to attribute it. */
export interface Source {
  content: string;
  /** True when the content came from the `.harness/custom` overlay. */
  custom: boolean;
  /** Workspace-relative path to the custom file, when `custom` is true. */
  customRelPath?: string;
  /** True when there is no canonical default — the overlay added this file. */
  customOnly: boolean;
}

function readSource(workspace: string, kind: OverlayKind, canonicalPath: string, customPath: string, customRelPath: string): Source {
  if (existsSync(customPath)) {
    return {
      content: readFileSync(customPath, "utf8"),
      custom: true,
      customRelPath,
      customOnly: !existsSync(canonicalPath)
    };
  }
  return { content: readFileSync(canonicalPath, "utf8"), custom: false, customOnly: false };
}

export function readPolicySource(workspace: string, name: string): Source {
  return readSource(
    workspace,
    "policies",
    resolve(repoRoot(), "policies", `${name}.md`),
    resolve(customDir(workspace, "policies"), `${name}.md`),
    `.harness/custom/policies/${name}.md`
  );
}

export function readSkillSource(workspace: string, name: string): Source {
  return readSource(
    workspace,
    "skills",
    resolve(repoRoot(), "skills", name, "SKILL.md"),
    resolve(customDir(workspace, "skills"), name, "SKILL.md"),
    `.harness/custom/skills/${name}/SKILL.md`
  );
}

export function readProfileSource(workspace: string, name: string): Source {
  return readSource(
    workspace,
    "agents",
    resolve(repoRoot(), "agents", `${name}.json`),
    resolve(customDir(workspace, "agents"), `${name}.json`),
    `.harness/custom/agents/${name}.json`
  );
}

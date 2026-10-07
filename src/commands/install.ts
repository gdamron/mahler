import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { type Flags, listFlag } from "../args.js";
import {
  configPath,
  defaultConfig,
  loadConfig,
  serializeConfig,
  withInstallOptions,
} from "../config.js";
import { agentNameCollisions, defaultModelFor, tierVariants } from "../models.js";
import { parseProfileSource } from "../profiles.js";
import {
  claudeAgentDefinition,
  codexAgentDefinition,
  modelsMarkdown,
  nativeAdapter,
  rootAgentBlock,
  workflowMarkdown,
} from "../render.js";
import { discoverRepos, withPreservedChecks } from "../repos.js";
import {
  adapterRuntimes,
  installedPolicyNames,
  installedProfileNames,
  installedSkillNames,
  readPolicySource,
  readProfileSource,
  readSkillSource,
  sourceLabel,
  type Source,
} from "../scaffold.js";
import { renderTemplate } from "../templates.js";
import { ensureDir, writeFileEnsured } from "../util.js";

export function install(workspaceInput: string, flags: Flags): void {
  const workspace = resolve(workspaceInput);
  ensureDir(workspace);
  // Merge labels, model tiers, and concurrency caps are human-tuned; a
  // reinstall must not reset them.
  const previous = existsSync(configPath(workspace))
    ? loadConfig(workspace)
    : undefined;
  const config = withInstallOptions(defaultConfig(workspace), {
    repos: withPreservedChecks(workspace, discoverRepos(workspace)),
    acceptedAssignees: listFlag(flags, "linear-assignee"),
    requiredLabels: listFlag(flags, "linear-label"),
    merge: previous?.merge,
    models: previous?.models,
    concurrency: previous?.concurrency,
  });
  // Fail before writing anything: a tier agent and a profile sharing a name
  // would overwrite each other.
  const collisions = agentNameCollisions(
    config.models,
    installedProfileNames(workspace),
  );
  if (collisions.length > 0) {
    throw new Error(`Cannot install: ${collisions.join("; ")}.`);
  }
  ensureDir(resolve(workspace, ".harness", "policies"));
  ensureDir(resolve(workspace, ".harness", "agents", "profiles"));
  ensureDir(resolve(workspace, ".harness", "decisions"));
  ensureDir(resolve(workspace, ".agents", "skills"));
  ensureDir(resolve(workspace, ".codex", "agents"));
  ensureDir(resolve(workspace, ".claude", "skills"));
  ensureDir(resolve(workspace, ".claude", "agents"));
  for (const kind of ["policies", "skills", "agents"] as const) {
    ensureDir(resolve(workspace, ".harness", "custom", kind));
  }
  // Human-owned files: written once, never overwritten by reinstall.
  writeIfMissing(
    resolve(workspace, ".harness", "custom", "README.md"),
    renderTemplate("custom-readme"),
  );
  writeIfMissing(
    resolve(workspace, ".harness", "decisions", "README.md"),
    renderTemplate("decisions-readme"),
  );
  writeFileEnsured(
    resolve(workspace, ".harness", "config.json"),
    serializeConfig(config),
  );
  writeFileEnsured(
    resolve(workspace, ".harness", "README.md"),
    renderTemplate("harness-readme"),
  );
  writeFileEnsured(resolve(workspace, "WORKFLOW.md"), workflowMarkdown());
  for (const policy of installedPolicyNames(workspace)) {
    const source = readPolicySource(workspace, policy);
    if (!source.content.trim()) {
      throw new Error(
        `Policy source ${sourceLabel(source, `policies/${policy}.md`)} is empty — fix the workflow source before installing.`,
      );
    }
    writeFileEnsured(
      resolve(workspace, ".harness", "policies", `${policy}.md`),
      withProvenance(source, source.content),
    );
  }
  pruneStaleSkills(workspace, installedSkillNames(workspace));
  for (const skill of installedSkillNames(workspace)) {
    const source = readSkillSource(workspace, skill);
    assertSkillWellFormed(source, skill);
    const body = generatedFile(
      source.content,
      sourceLabel(source, `skills/${skill}/SKILL.md`),
    );
    writeFileEnsured(
      resolve(workspace, ".agents", "skills", skill, "SKILL.md"),
      body,
    );
    writeFileEnsured(
      resolve(workspace, ".claude", "skills", skill, "SKILL.md"),
      body,
    );
  }
  const profiles = installedProfileNames(workspace);
  const variantsFor = (runtime: "codex" | "claude", profile: string) =>
    tierVariants(config.models, profile, runtime);
  const agentNames = (runtime: "codex" | "claude") => [
    ...profiles,
    ...profiles.flatMap((profile) =>
      variantsFor(runtime, profile).map((variant) => variant.name),
    ),
  ];
  pruneStaleProfiles(workspace, profiles, agentNames("codex"), agentNames("claude"));
  for (const profile of profiles) {
    const source = readProfileSource(workspace, profile);
    const parsed = parseProfileSource(source, profile);
    writeFileEnsured(
      resolve(workspace, ".harness", "agents", "profiles", `${profile}.json`),
      source.content,
    );
    writeFileEnsured(
      resolve(workspace, ".codex", "agents", `${profile}.toml`),
      codexAgentDefinition(
        parsed,
        defaultModelFor(config.models, profile, "codex"),
      ),
    );
    writeFileEnsured(
      resolve(workspace, ".claude", "agents", `${profile}.md`),
      claudeAgentDefinition(
        parsed,
        defaultModelFor(config.models, profile, "claude"),
      ),
    );
    for (const variant of variantsFor("codex", profile)) {
      writeFileEnsured(
        resolve(workspace, ".codex", "agents", `${variant.name}.toml`),
        codexAgentDefinition(parsed, undefined, variant),
      );
    }
    for (const variant of variantsFor("claude", profile)) {
      writeFileEnsured(
        resolve(workspace, ".claude", "agents", `${variant.name}.md`),
        claudeAgentDefinition(parsed, undefined, variant),
      );
    }
  }
  writeFileEnsured(
    resolve(workspace, ".harness", "MODELS.md"),
    modelsMarkdown(config.models, profiles),
  );
  for (const runtime of adapterRuntimes()) {
    ensureDir(resolve(workspace, ".harness", "agents", runtime));
    writeFileEnsured(
      resolve(workspace, ".harness", "agents", runtime, "HARNESS.md"),
      nativeAdapter(runtime),
    );
  }
  mergeRootInstruction(resolve(workspace, "AGENTS.md"), rootAgentBlock(config));
  mergeRootInstruction(resolve(workspace, "CLAUDE.md"), rootAgentBlock(config));
  console.log(`Installed Mahler workflow into ${workspace}`);
  console.log(
    `Configured ${config.repos.length} repo(s): ${config.repos.map((repo) => repo.name).join(", ") || "(none)"}`,
  );
  if (config.linear.acceptedAssignees.length === 0) {
    console.log(
      "No Linear assignee filter configured. Add one with --linear-assignee <username> or edit .harness/config.json.",
    );
  }
}

/**
 * Remove artifacts for profiles and Claude tier variants that no longer exist
 * (e.g. after a rename or a tier change), so stale agent definitions don't
 * linger in every parent's agent list. Native agent files are removed only
 * when Mahler generated them.
 */
function pruneStaleProfiles(
  workspace: string,
  profiles: string[],
  codexAgents: string[],
  claudeAgents: string[],
): void {
  const stale = (dir: string, ext: string, generatedOnly: boolean, keep = profiles) => {
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(ext) || keep.includes(file.slice(0, -ext.length)))
        continue;
      const path = resolve(dir, file);
      if (generatedOnly && !readFileSync(path, "utf8").includes("Generated by Mahler"))
        continue;
      rmSync(path);
    }
  };
  stale(resolve(workspace, ".harness", "agents", "profiles"), ".json", false);
  stale(resolve(workspace, ".codex", "agents"), ".toml", true, codexAgents);
  stale(resolve(workspace, ".claude", "agents"), ".md", true, claudeAgents);
}

/**
 * Remove generated skills that are no longer installed (e.g. `orchestrate`
 * after it became `conduct`), so neither runtime can still discover them.
 * Hand-written skills, which lack Mahler's generated marker, are left alone.
 */
function pruneStaleSkills(workspace: string, skills: string[]): void {
  for (const root of [".agents", ".claude"]) {
    const dir = resolve(workspace, root, "skills");
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || skills.includes(entry.name)) continue;
      const skillFile = resolve(dir, entry.name, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      if (!readFileSync(skillFile, "utf8").includes("Generated by Mahler")) continue;
      rmSync(skillFile);
      if (readdirSync(resolve(dir, entry.name)).length === 0) {
        rmSync(resolve(dir, entry.name), { recursive: true });
      }
    }
  }
}

function writeIfMissing(path: string, content: string): void {
  if (!existsSync(path)) writeFileEnsured(path, content);
}

function mergeRootInstruction(path: string, block: string): void {
  const start = "<!-- HARNESS:START -->";
  const end = "<!-- HARNESS:END -->";
  const nextBlock = `${start}\n${block.trim()}\n${end}\n`;
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const pattern = new RegExp(
    `${escapeRegex(start)}[\\s\\S]*?${escapeRegex(end)}\\n?`,
  );
  const next = pattern.test(current)
    ? current.replace(pattern, nextBlock)
    : `${current.trimEnd()}\n\n${nextBlock}`;
  writeFileEnsured(path, next.trimStart());
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A provenance blockquote prepended to overlaid markdown so agents don't chase multiple files. */
function withProvenance(source: Source, content: string): string {
  if (!source.custom) return content;
  const note = source.customOnly
    ? `> Installed from ${source.customRelPath} (no Mahler default).`
    : `> Mahler default was replaced by ${source.customRelPath}.`;
  return `${note}\n\n${content}`;
}

function assertSkillWellFormed(source: Source, name: string): void {
  const body = source.content;
  if (
    !body.startsWith("---\n") ||
    !body.includes(`name: ${name}`) ||
    !body.includes("description:")
  ) {
    throw new Error(
      `Skill source ${sourceLabel(source, `skills/${name}/SKILL.md`)} is malformed — needs frontmatter starting with \`---\` and containing \`name: ${name}\` and \`description:\`.`,
    );
  }
}

/** Insert a "generated, do not edit" marker after the frontmatter (or at the top when there is none). */
function generatedFile(content: string, source: string): string {
  const marker = "\n---\n";
  if (content.startsWith("---\n")) {
    const end = content.indexOf(marker, marker.length);
    if (end !== -1) {
      return `${content.slice(0, end + marker.length)}<!-- Generated by Mahler from ${source}. Do not edit directly. -->\n${content.slice(end + marker.length)}`;
    }
  }
  return `<!-- Generated by Mahler from ${source}. Do not edit directly. -->\n${content}`;
}

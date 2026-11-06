import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { configPath, loadConfig } from "../config.js";
import { decisionsDir, knowledgeDir, knowledgeIndex, readLedger, readNotes } from "../knowledge.js";
import { knowledgeStore, ledgerStore, prPublish, prScope, type RepoStore, storeRepoProblem, storeState } from "../knowledge-repo.js";
import { frontmatterField, pendingNotes, proposalStatus } from "../knowledge-pr.js";
import { modelConfigProblems, tierVariants } from "../models.js";
import { spotlightFinding } from "../spotlight.js";
import {
  adapterRuntimes,
  installedPolicyNames,
  installedProfileNames,
  installedSkillNames,
} from "../scaffold.js";
import type { Finding, HarnessConfig } from "../types.js";
import { abs, mahlerVersion } from "../util.js";

export function doctor(workspaceInput: string): void {
  const workspace = resolve(workspaceInput);
  const results: Finding[] = [];
  const harness = resolve(workspace, ".harness");

  if (!existsSync(workspace)) {
    report([{ level: "error", message: `workspace not found: ${workspace}` }]);
    return;
  }

  if (!existsSync(configPath(workspace))) {
    report([
      {
        level: "error",
        message: `missing .harness/config.json — run \`mahler install ${workspace}\``,
      },
    ]);
    return;
  }

  let config: HarnessConfig;
  try {
    config = loadConfig(workspace);
    results.push({ level: "ok", message: ".harness/config.json parses" });
  } catch (error) {
    report([
      {
        level: "error",
        message: `.harness/config.json invalid: ${error instanceof Error ? error.message : String(error)}`,
      },
    ]);
    return;
  }

  results.push(installVersionFinding(harness));

  if (config.repos.length === 0) {
    results.push({
      level: "error",
      message:
        "no repos configured — run install in a workspace containing git repos or edit .harness/config.json",
    });
  } else {
    for (const repo of config.repos) {
      const repoPath = abs(workspace, repo.path);
      if (!existsSync(resolve(repoPath, ".git"))) {
        results.push({
          level: "error",
          message: `repo \"${repo.name}\" missing .git at ${repoPath}`,
        });
      } else {
        results.push({
          level: "ok",
          message: `repo ${repo.name} present (${repo.baseBranch})`,
        });
      }
      if (Object.keys(repo.checks ?? {}).length === 0) {
        results.push({
          level: "warn",
          message: `repo ${repo.name} has no checks configured — mahler check has nothing to run; add checks in .harness/config.json`,
        });
      }
    }
  }

  if (existsSync(resolve(harness, "decisions"))) {
    results.push(ledgerFinding(readLedger(decisionsDir(workspace)).length));
  } else {
    results.push({
      level: "info",
      message:
        ".harness/decisions/ missing — created on install; agents append Tier-1 deviation notes here",
    });
  }
  results.push(...ledgerRepoFindings(workspace, config));
  results.push(...knowledgeFindings(workspace, config));

  const installedSkills = new Set(installedSkillNames(workspace));
  checkFiles(
    results,
    harness,
    "policies",
    installedPolicyNames(workspace),
    ".md",
  );
  checkSkillOutputs(
    results,
    workspace,
    ".agents",
    "Codex",
    installedSkillNames(workspace),
  );
  checkSkillOutputs(
    results,
    workspace,
    ".claude",
    "Claude",
    installedSkillNames(workspace),
  );

  const spotlight = spotlightFinding(
    resolve(workspace, config.workspaceDir),
    config.workspaceDir,
  );
  if (spotlight) results.push(spotlight);
  results.push(...acceptanceFindings(config));
  results.push(...ghFindings(ghOutput(["--version"]), ghOutput(["stack", "--version"])));

  if (!existsSync(resolve(harness, "MODELS.md"))) {
    results.push({
      level: "error",
      message: "missing .harness/MODELS.md — rerun mahler install",
    });
  }
  const modelProblems = modelConfigProblems(
    config.models,
    installedProfileNames(workspace),
  );
  results.push(
    ...(modelProblems.length === 0
      ? [{ level: "ok" as const, message: "models config is consistent" }]
      : modelProblems.map((message) => ({ level: "warn" as const, message }))),
  );

  for (const profile of installedProfileNames(workspace)) {
    const path = resolve(harness, "agents", "profiles", `${profile}.json`);
    if (!existsSync(path)) {
      results.push({
        level: "error",
        message: `missing profile: agents/profiles/${profile}.json`,
      });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
      results.push({ level: "ok", message: `profile ${profile} present` });
    } catch (error) {
      results.push({
        level: "error",
        message: `profile ${profile} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    const record =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    for (const list of ["allowedSkills", "deniedSkills"] as const) {
      const skills = Array.isArray(record[list])
        ? (record[list] as unknown[])
        : [];
      for (const skill of skills) {
        if (typeof skill === "string" && !installedSkills.has(skill)) {
          results.push({
            level: "warn",
            message: `profile ${profile} ${list} references uninstalled skill "${skill}"`,
          });
        }
      }
    }
  }

  for (const profile of installedProfileNames(workspace)) {
    const codexAgent = resolve(
      workspace,
      ".codex",
      "agents",
      `${profile}.toml`,
    );
    const claudeAgent = resolve(
      workspace,
      ".claude",
      "agents",
      `${profile}.md`,
    );
    if (!existsSync(codexAgent)) {
      results.push({
        level: "error",
        message: `missing Codex agent: .codex/agents/${profile}.toml`,
      });
    } else {
      results.push({ level: "ok", message: `Codex agent ${profile} present` });
    }
    if (!existsSync(claudeAgent)) {
      results.push({
        level: "error",
        message: `missing Claude agent: .claude/agents/${profile}.md`,
      });
    } else {
      results.push({ level: "ok", message: `Claude agent ${profile} present` });
    }
    for (const [runtime, dir, ext] of [
      ["codex", ".codex", ".toml"],
      ["claude", ".claude", ".md"],
    ] as const) {
      for (const variant of tierVariants(config.models, profile, runtime)) {
        const file = `${dir}/agents/${variant.name}${ext}`;
        if (!existsSync(resolve(workspace, file))) {
          results.push({
            level: "error",
            message: `missing tier agent: ${file} — rerun mahler install`,
          });
        }
      }
    }
  }

  for (const runtime of adapterRuntimes()) {
    const path = resolve(harness, "agents", runtime, "HARNESS.md");
    if (!existsSync(path)) {
      results.push({
        level: "error",
        message: `missing adapter: agents/${runtime}/HARNESS.md`,
      });
      continue;
    }
    const body = readFileSync(path, "utf8");
    if (
      !body.includes("work on MAH-123") ||
      !body.includes(
        runtime === "codex" ? ".agents/skills" : ".claude/skills",
      ) ||
      !body.includes(".harness/policies") ||
      !body.includes(".harness/agents/profiles") ||
      !body.includes(".harness/tmp/linear") ||
      !body.includes(".harness/decisions") ||
      !body.includes("mahler linear-template issue|project")
    ) {
      results.push({
        level: "error",
        message: `adapter agents/${runtime}/HARNESS.md missing routing/profile/skill/policy references`,
      });
    } else {
      results.push({ level: "ok", message: `adapter ${runtime} wired` });
    }
  }

  const workflow = resolve(workspace, "WORKFLOW.md");
  if (!existsSync(workflow)) {
    results.push({ level: "error", message: "missing WORKFLOW.md" });
  } else {
    results.push({ level: "ok", message: "WORKFLOW.md present" });
  }

  for (const rootFile of ["AGENTS.md", "CLAUDE.md"]) {
    const path = resolve(workspace, rootFile);
    if (!existsSync(path)) {
      results.push({ level: "error", message: `missing ${rootFile}` });
      continue;
    }
    if (!readFileSync(path, "utf8").includes("<!-- HARNESS:START -->")) {
      results.push({
        level: "error",
        message: `${rootFile} missing <!-- HARNESS:START --> block`,
      });
    } else {
      results.push({
        level: "ok",
        message: `${rootFile} contains harness block`,
      });
    }
  }

  if (config.linear.acceptedAssignees.length === 0) {
    results.push({
      level: "warn",
      message:
        "no Linear assignee filter configured — add --linear-assignee on install or edit .harness/config.json",
    });
  }

  report(results);
}

function checkFiles(
  results: Finding[],
  harness: string,
  dir: string,
  names: string[],
  ext: string,
): void {
  for (const name of names) {
    const path = resolve(harness, dir, `${name}${ext}`);
    if (!existsSync(path)) {
      results.push({ level: "error", message: `missing ${dir}/${name}${ext}` });
    } else {
      results.push({ level: "ok", message: `${dir}/${name}${ext} present` });
    }
  }
}

function checkSkillOutputs(
  results: Finding[],
  workspace: string,
  root: ".agents" | ".claude",
  label: string,
  names: string[],
): void {
  for (const skill of names) {
    const path = resolve(workspace, root, "skills", skill, "SKILL.md");
    if (!existsSync(path)) {
      results.push({
        level: "error",
        message: `missing ${label} skill: ${root}/skills/${skill}/SKILL.md`,
      });
      continue;
    }
    const body = readFileSync(path, "utf8");
    if (
      !body.startsWith("---\n") ||
      !body.includes(`name: ${skill}`) ||
      !body.includes("description:")
    ) {
      results.push({
        level: "error",
        message: `${label} skill ${skill} missing required SKILL.md frontmatter`,
      });
    } else {
      results.push({ level: "ok", message: `${label} skill ${skill} present` });
    }
  }
}

function report(results: Finding[]): void {
  let errors = 0;
  let warnings = 0;
  for (const result of results) {
    const prefix =
      result.level === "ok"
        ? "ok  "
        : result.level === "info"
          ? "info"
          : result.level === "warn"
            ? "warn"
            : "err ";
    console.log(`${prefix} ${result.message}`);
    if (result.level === "error") errors += 1;
    if (result.level === "warn") warnings += 1;
  }
  console.log(
    `\n${results.length} checks, ${errors} error(s), ${warnings} warning(s)`,
  );
  if (errors > 0) process.exit(1);
}

/** The knowledge store's mode, its clone's state in repo mode, and whether its index is current. */
export function knowledgeFindings(workspace: string, config: HarnessConfig): Finding[] {
  const dir = knowledgeDir(workspace, config);
  const { repo, publish } = config.knowledge;
  const findings: Finding[] = [];
  if (!repo) {
    findings.push({ level: "ok", message: `knowledge store: local folder ${dir}` });
  } else {
    const store = knowledgeStore(workspace, config);
    const state = storeState(workspace, store);
    if (state.problem) {
      findings.push({ level: "error", message: `knowledge store: ${state.problem}` });
      return findings;
    }
    findings.push({
      level: "ok",
      message: `knowledge store: clone of ${repo} on ${state.branch}${sharedNote(store)}${prPublish(config) ? ", publishing through PRs" : ""}`,
    });
    if (publish !== undefined && publish !== "direct" && publish !== "pr") {
      findings.push({ level: "error", message: `knowledge.publish must be "direct" or "pr", not ${JSON.stringify(publish)}` });
    }
    if (prPublish(config)) {
      findings.push(...pendingFindings(store));
      if ((state.behind ?? 0) > 0) {
        findings.push({ level: "info", message: `knowledge store is ${state.behind} ${state.behind === 1 ? "commit" : "commits"} behind the remote, as of the last fetch; run \`mahler knowledge sync\`` });
      }
      if ((state.ahead ?? 0) > 0) {
        findings.push({ level: "warn", message: `knowledge store has ${state.ahead} local ${state.ahead === 1 ? "commit" : "commits"} that PR publish never pushes; sync explains how to publish them` });
      }
    } else {
      if ((state.ahead ?? 0) > 0) {
        findings.push({ level: "warn", message: `knowledge store has ${state.ahead} unpublished ${state.ahead === 1 ? "commit" : "commits"}; run \`mahler knowledge sync\`` });
      }
      if (state.dirty) {
        findings.push({ level: "info", message: "knowledge store has uncommitted changes; the next sync commits and publishes them" });
      }
    }
  }
  const index = resolve(dir, "INDEX.md");
  if (existsSync(dir) && (!existsSync(index) || readFileSync(index, "utf8") !== knowledgeIndex(dir, readNotes(dir)))) {
    findings.push({ level: "info", message: "knowledge INDEX.md is out of date; run `mahler knowledge index`" });
  }
  return findings;
}

/**
 * With `decisions.repo`: whether the ledger's clone is sound and backed up.
 * Also reports how the two stores' repos are set, when that's wrong.
 */
export function ledgerRepoFindings(workspace: string, config: HarnessConfig): Finding[] {
  const store = ledgerStore(workspace, config);
  const clash = storeRepoProblem(workspace, config);
  if (clash) return [{ level: "error", message: `${store.repo ? "decisions ledger" : "knowledge store"}: ${clash}` }];
  if (!store.repo) return [];
  const state = storeState(workspace, store);
  if (state.problem) return [{ level: "error", message: `decisions ledger: ${state.problem}` }];
  if (store.pr) {
    // Shared with a knowledge store that publishes through PRs: a decision is backed up once its PR merges.
    const status = proposalStatus(prScope(store));
    const findings: Finding[] = [
      { level: "ok", message: `decisions ledger: backed up to ${store.repo} on ${state.branch}${sharedNote(store)}, through PRs` },
    ];
    if (status.batch) {
      findings.push({
        level: "info",
        message: `decisions ledger PR awaiting review: ${status.batch.files} ${status.batch.files === 1 ? "change" : "changes"}, not backed up until it merges${status.batch.url ? ` (${status.batch.url})` : ""}`,
      });
    }
    if (status.unproposed > 0) {
      findings.push({
        level: "warn",
        message: `${status.unproposed} decisions ledger ${status.unproposed === 1 ? "change isn't" : "changes aren't"} proposed in a PR yet; run \`mahler knowledge sync\``,
      });
    }
    return findings;
  }
  const findings: Finding[] = [
    { level: "ok", message: `decisions ledger: backed up to ${store.repo} on ${state.branch}${sharedNote(store)}` },
  ];
  if ((state.ahead ?? 0) > 0) {
    findings.push({ level: "warn", message: `decisions ledger has ${state.ahead} ${state.ahead === 1 ? "commit" : "commits"} not backed up; run \`mahler knowledge sync\`` });
  }
  if (state.dirty) {
    findings.push({ level: "info", message: "decisions ledger has uncommitted changes; the next sync backs them up" });
  }
  return findings;
}

/** A pending note older than this has waited too long for review. */
const PENDING_REVIEW_DAYS = 7;

/** In a shared clone: which folder of the repo the store is. */
function sharedNote(store: RepoStore): string {
  return store.shared ? `, in ${store.prefix} (shared with the ${store.name === "knowledge" ? "decisions ledger" : "knowledge store"})` : "";
}

/** PR publish: what waits for review, and what hasn't been proposed yet. */
function pendingFindings(store: RepoStore): Finding[] {
  const { dir } = store;
  const findings: Finding[] = [];
  const status = proposalStatus(prScope(store));
  if (status.notes > 0 || status.batch) {
    const edits = status.batch?.files ?? 0;
    const parts = [
      ...(status.notes > 0 ? [`${status.notes} pending ${status.notes === 1 ? "note" : "notes"}`] : []),
      ...(status.batch ? [`a batch of ${edits} ${edits === 1 ? "edit" : "edits"}`] : []),
    ];
    findings.push({ level: "info", message: `knowledge PRs awaiting review: ${parts.join(" and ")}` });
  }
  if (status.unproposed > 0) {
    findings.push({
      level: "warn",
      message: `${status.unproposed} knowledge ${status.unproposed === 1 ? "change isn't" : "changes aren't"} proposed in a PR yet; run \`mahler knowledge sync\``,
    });
  }
  for (const slug of status.conflicted) {
    findings.push({
      level: "warn",
      message: `pending/${slug}.md changed after its PR merged; fold your changes into notes/${slug}.md by hand and delete it`,
    });
  }
  const cutoff = new Date(Date.now() - PENDING_REVIEW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const stale = pendingNotes(dir).filter((file) => (frontmatterField(readFileSync(file, "utf8"), "created") ?? cutoff) < cutoff).length;
  if (stale > 0) {
    findings.push({
      level: "warn",
      message: `${stale} pending knowledge ${stale === 1 ? "note has" : "notes have"} waited more than ${PENDING_REVIEW_DAYS} days for review; merge or close ${stale === 1 ? "its PR" : "their PRs"}`,
    });
  }
  return findings;
}

/** Sessions read the ledger's index at start, so a long ledger costs every session. */
export const LEDGER_AUDIT_THRESHOLD = 20;

export function ledgerFinding(active: number): Finding {
  if (active > LEDGER_AUDIT_THRESHOLD) {
    return {
      level: "warn",
      message: `.harness/decisions/ has ${active} active notes — sessions read its index at start; run the audit skill to sort them (most facts about the code belong in the knowledge store: \`mahler knowledge import\`)`,
    };
  }
  return { level: "ok", message: `.harness/decisions/ present (${active} active ${active === 1 ? "note" : "notes"})` };
}

/** Compare the Mahler version that generated the workspace with the running CLI. */
export function installVersionFinding(harness: string, running = mahlerVersion()): Finding {
  const path = resolve(harness, "install.json");
  let installed: string | undefined;
  try {
    installed = (JSON.parse(readFileSync(path, "utf8")) as { mahlerVersion?: string }).mahlerVersion;
  } catch {
    installed = undefined;
  }
  if (!installed) {
    return {
      level: "warn",
      message: `no record of which Mahler generated this workspace — rerun \`mahler install\` with Mahler ${running}`,
    };
  }
  if (installed !== running) {
    return {
      level: "warn",
      message: `workspace was generated by Mahler ${installed}, but this CLI is ${running} — rerun \`mahler install\` to update skills, policies, and agents`,
    };
  }
  return { level: "ok", message: `generated by Mahler ${running} (this CLI)` };
}

/** Checks that a configured acceptance suite names a repo Mahler knows and can run. */
function acceptanceFindings(config: HarnessConfig): Finding[] {
  const { repo, run } = config.acceptance;
  if (!repo && !run) return [];
  if (!repo) {
    return [{ level: "warn", message: "acceptance.run is set but acceptance.repo is not — `mahler acceptance run` needs both" }];
  }
  if (!config.repos.some((candidate) => candidate.name === repo)) {
    return [{ level: "warn", message: `acceptance.repo "${repo}" is not a configured repo` }];
  }
  if (!run) {
    return [{ level: "warn", message: `acceptance.repo is "${repo}" but acceptance.run is not set — \`mahler acceptance run\` needs it` }];
  }
  return [{ level: "ok", message: `acceptance suite: ${repo} (${config.acceptance.path})` }];
}

function ghOutput(args: string[]): string | undefined {
  const result = spawnSync("gh", args, { encoding: "utf8", timeout: 10_000 });
  return result.status === 0 ? result.stdout : undefined;
}

/**
 * GitHub CLI support for the pr policy: `--attach` (gh 2.99+) for proof of
 * work, and the gh-stack extension for stacks that merge in one step.
 * `gh stack --version` works logged out, unlike `gh extension list`.
 */
export function ghFindings(version: string | undefined, stackVersion: string | undefined): Finding[] {
  if (version === undefined) {
    return [{ level: "info", message: "gh (GitHub CLI) not found or not responding — on GitHub, PRs need gh 2.99 or later to attach proof" }];
  }
  const match = /gh version (\d+)\.(\d+)\.(\d+)/.exec(version);
  const findings: Finding[] = [];
  if (!match) {
    findings.push({ level: "warn", message: `cannot read the gh version from "${version.trim().split("\n")[0]}"` });
  } else {
    const [major, minor] = [Number(match[1]), Number(match[2])];
    const current = `${match[1]}.${match[2]}.${match[3]}`;
    findings.push(
      major > 2 || (major === 2 && minor >= 99)
        ? { level: "ok", message: `gh ${current} supports --attach for proof of work` }
        : { level: "warn", message: `gh ${current} predates --attach (2.99); upgrade gh so agents can attach proof to PRs` },
    );
  }
  findings.push(
    stackVersion?.startsWith("gh stack version")
      ? { level: "ok", message: "gh stack extension installed: stacked PRs merge in one step" }
      : { level: "info", message: "gh stack extension not installed — stacked PRs merge one at a time (gh extension install github/gh-stack)" },
  );
  return findings;
}

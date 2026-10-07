import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { policyNames, profileNames, skillNames } from "../src/scaffold.js";

function install(workspace: string): { status: number | null; stderr: string } {
  const result = spawnSync("node", ["dist/src/cli.js", "install", workspace], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  return { status: result.status, stderr: result.stderr };
}

test("discovery scans canonical source, including branching and interview", () => {
  assert.ok(policyNames().includes("branching"), "branching policy should be discovered");
  assert.ok(policyNames().includes("interview"), "interview policy should be discovered");
  assert.ok(policyNames().includes("sub-agent-delegation"), "sub-agent delegation policy should be discovered");
  assert.ok(skillNames().includes("interview"), "interview skill should be discovered");
  for (const skill of ["compose", "conduct", "delegate", "implement"]) {
    assert.ok(skillNames().includes(skill), `missing skill ${skill}`);
  }
  for (const profile of ["composer", "conductor", "reviewer"]) {
    assert.ok(profileNames().includes(profile), `missing profile ${profile}`);
  }
});

test("canonical skills are well-formed", () => {
  for (const skill of skillNames()) {
    const path = resolve("skills", skill, "SKILL.md");
    const body = readFileSync(path, "utf8");
    assert.match(body, /^---\n/);
    assert.match(body, new RegExp(`name: ${skill}`));
    assert.match(body, /description:/);
  }
});

test("install writes discovered policies, skills, and profiles", () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-install-"));
  assert.equal(install(workspace).status, 0);
  // Previously omitted by the hardcoded lists — now installed via discovery.
  assert.equal(existsSync(resolve(workspace, ".harness", "policies", "branching.md")), true);
  assert.equal(existsSync(resolve(workspace, ".harness", "policies", "interview.md")), true);
  assert.equal(existsSync(resolve(workspace, ".harness", "policies", "sub-agent-delegation.md")), true);
  assert.equal(existsSync(resolve(workspace, ".agents", "skills", "interview", "SKILL.md")), true);
  assert.equal(existsSync(resolve(workspace, ".claude", "skills", "interview", "SKILL.md")), true);
  // Baseline artifacts still present.
  assert.equal(existsSync(resolve(workspace, ".agents", "skills", "work-on-issue", "SKILL.md")), true);
  assert.equal(existsSync(resolve(workspace, ".harness", "agents", "profiles", "conductor.json")), true);
  assert.equal(existsSync(resolve(workspace, ".codex", "agents", "conductor.toml")), true);
  // Overlay scaffold is created.
  assert.equal(existsSync(resolve(workspace, ".harness", "custom", "policies")), true);
  assert.equal(existsSync(resolve(workspace, ".harness", "custom", "README.md")), true);
});

test("reinstall preserves human-set per-repo checks that detection cannot infer", () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-checks-"));
  // A child repo with no package.json — detectChecks infers nothing for it.
  mkdirSync(resolve(workspace, "rustrepo", ".git"), { recursive: true });
  assert.equal(install(workspace).status, 0);

  const configFile = resolve(workspace, ".harness", "config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  const repo = config.repos.find((r: { name: string }) => r.name === "rustrepo");
  assert.ok(repo, "rustrepo should be discovered");
  assert.equal(repo.checks, undefined, "no checks inferred without package.json");

  // Human adds cargo checks by hand.
  repo.checks = { test: "cargo test --lib --tests", build: "cargo build --lib" };
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);

  assert.equal(install(workspace).status, 0);
  const after = JSON.parse(readFileSync(configFile, "utf8"));
  const repoAfter = after.repos.find((r: { name: string }) => r.name === "rustrepo");
  assert.deepEqual(
    repoAfter.checks,
    { test: "cargo test --lib --tests", build: "cargo build --lib" },
    "reinstall must not wipe human-set checks"
  );
});

test("reinstall preserves human-set merge labels", () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-merge-"));
  assert.equal(install(workspace).status, 0);

  const configFile = resolve(workspace, ".harness", "config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  config.merge = { humanReviewLabels: ["security"], agentMergeLabels: [] };
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);

  assert.equal(install(workspace).status, 0);
  const after = JSON.parse(readFileSync(configFile, "utf8"));
  assert.deepEqual(after.merge, { humanReviewLabels: ["security"], agentMergeLabels: [] });
});

test("install pins default tiers, and reinstall preserves human-set models and concurrency", () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-models-"));
  assert.equal(install(workspace).status, 0);
  const reviewer = readFileSync(resolve(workspace, ".claude", "agents", "reviewer.md"), "utf8");
  assert.match(reviewer, /^model: sonnet\neffort: high$/m);
  const codexReviewer = readFileSync(resolve(workspace, ".codex", "agents", "reviewer.toml"), "utf8");
  assert.match(codexReviewer, /^model = "gpt-6\.1-sol"\nmodel_reasoning_effort = "medium"$/m);
  // Agents a human talks to keep the session's model.
  for (const profile of ["composer", "conductor"]) {
    const claude = readFileSync(resolve(workspace, ".claude", "agents", `${profile}.md`), "utf8");
    assert.match(claude, /^model: inherit\n---$/m);
    assert.doesNotMatch(claude, /^effort:/m);
    const codex = readFileSync(resolve(workspace, ".codex", "agents", `${profile}.toml`), "utf8");
    assert.doesNotMatch(codex, /^model/m);
  }
  // Claude can't set effort at launch, so other allowed tiers get their own agent.
  const deep = readFileSync(resolve(workspace, ".claude", "agents", "conductor-deep.md"), "utf8");
  assert.match(deep, /^---\nname: conductor-deep\ndescription: "conductor at the deep tier \(opus, high effort\)/);
  // Descriptions are quoted YAML scalars, so `: ` inside one can't break the frontmatter.
  for (const profile of ["composer", "conductor", "reviewer"]) {
    const body = readFileSync(resolve(workspace, ".claude", "agents", `${profile}.md`), "utf8");
    const line = body.split("\n").find((l) => l.startsWith("description: ")) ?? "";
    const description = JSON.parse(line.slice("description: ".length));
    assert.equal(description, JSON.parse(readFileSync(resolve("agents", `${profile}.json`), "utf8")).description);
  }
  assert.match(deep, /^model: opus\neffort: high$/m);
  for (const tier of ["trivial", "light", "standard"]) {
    assert.equal(existsSync(resolve(workspace, ".claude", "agents", `conductor-${tier}.md`)), true);
  }
  assert.equal(existsSync(resolve(workspace, ".claude", "agents", "conductor-inherit.md")), false);
  assert.match(deep, /# Mahler conductor Profile/);
  assert.match(deep, /Mahler conductor profile/);
  // The default tier is the base agent, so it gets no variant of its own.
  assert.equal(existsSync(resolve(workspace, ".claude", "agents", "reviewer-light.md")), false);
  assert.equal(existsSync(resolve(workspace, ".claude", "agents", "reviewer-trivial.md")), true);
  // Codex applies an agent's settings over spawn values, so it gets tier agents too.
  const codexDeep = readFileSync(resolve(workspace, ".codex", "agents", "conductor-deep.toml"), "utf8");
  assert.match(codexDeep, /^name = "conductor-deep"$/m);
  assert.match(codexDeep, /^model = "gpt-6-astra"\nmodel_reasoning_effort = "high"$/m);

  const configFile = resolve(workspace, ".harness", "config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  // config.json holds only changes to Mahler's defaults; MODELS.md shows the result.
  assert.deepEqual(config.models, { tiers: {}, profiles: {} });
  assert.deepEqual(config.concurrency, {});
  const modelsDoc = readFileSync(resolve(workspace, ".harness", "MODELS.md"), "utf8");
  assert.match(modelsDoc, /\| `deep` \| opus, high effort \| gpt-6-astra, high effort \|/);
  assert.match(modelsDoc, /deep: `conductor-deep`/);
  // Route Claude reviews to a cross-model skill; Codex reviews stay native.
  config.models.tiers["cross-check"] = {
    claude: { skill: "codex:review" },
    codex: { effort: "high" },
  };
  config.models.profiles.reviewer = { default: "cross-check", allowed: ["light", "cross-check"] };
  config.concurrency.maxIssueAgents = 1;
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);

  assert.equal(install(workspace).status, 0);
  const after = JSON.parse(readFileSync(configFile, "utf8"));
  assert.deepEqual(after.models, config.models);
  assert.deepEqual(after.concurrency, { maxIssueAgents: 1 });
  const modelsAfter = readFileSync(resolve(workspace, ".harness", "MODELS.md"), "utf8");
  assert.match(modelsAfter, /\| `cross-check` \| skill: `codex:review` \| high effort \|/);
  assert.match(modelsAfter, /cross-check: skill `codex:review`/);
  // A skill-routed default pins nothing in Claude; Codex gets the tier's effort.
  const rerendered = readFileSync(resolve(workspace, ".claude", "agents", "reviewer.md"), "utf8");
  assert.doesNotMatch(rerendered, /^(model|effort):/m);
  const codexAfter = readFileSync(resolve(workspace, ".codex", "agents", "reviewer.toml"), "utf8");
  assert.match(codexAfter, /^model_reasoning_effort = "high"$/m);
  // Tiers dropped from reviewer's allowed list lose their variants; light remains.
  assert.equal(existsSync(resolve(workspace, ".claude", "agents", "reviewer-deep.md")), false);
  assert.equal(existsSync(resolve(workspace, ".claude", "agents", "reviewer-light.md")), true);
  assert.equal(existsSync(resolve(workspace, ".claude", "agents", "reviewer-cross-check.md")), false);
});

test("reinstall removes generated artifacts for profiles that no longer exist", () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-prune-"));
  assert.equal(install(workspace).status, 0);
  const stale = {
    profile: resolve(workspace, ".harness", "agents", "profiles", "orchestrator.json"),
    codex: resolve(workspace, ".codex", "agents", "orchestrator.toml"),
    claude: resolve(workspace, ".claude", "agents", "orchestrator.md"),
  };
  writeFileSync(stale.profile, "{}\n");
  writeFileSync(stale.codex, "# Generated by Mahler. Edit agents/orchestrator.json\n");
  writeFileSync(stale.claude, "Generated by Mahler.\n");
  const handWritten = resolve(workspace, ".claude", "agents", "my-agent.md");
  writeFileSync(handWritten, "---\nname: my-agent\n---\n");

  assert.equal(install(workspace).status, 0);
  for (const path of Object.values(stale)) {
    assert.equal(existsSync(path), false, `${path} should be pruned`);
  }
  assert.equal(existsSync(handWritten), true, "hand-written agents are left alone");
});

test("reinstall removes generated skills that are no longer installed, keeping hand-written ones", () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-skill-prune-"));
  assert.equal(install(workspace).status, 0);
  for (const root of [".agents", ".claude"]) {
    const retired = resolve(workspace, root, "skills", "orchestrate");
    mkdirSync(retired, { recursive: true });
    writeFileSync(resolve(retired, "SKILL.md"), "---\nname: orchestrate\n---\n<!-- Generated by Mahler from skills/orchestrate/SKILL.md. Do not edit directly. -->\n");
    const mine = resolve(workspace, root, "skills", "my-skill");
    mkdirSync(mine, { recursive: true });
    writeFileSync(resolve(mine, "SKILL.md"), "---\nname: my-skill\n---\n");
  }
  assert.equal(install(workspace).status, 0);
  for (const root of [".agents", ".claude"]) {
    assert.equal(existsSync(resolve(workspace, root, "skills", "orchestrate")), false, `${root} orchestrate pruned`);
    assert.equal(existsSync(resolve(workspace, root, "skills", "my-skill", "SKILL.md")), true, `${root} my-skill kept`);
    assert.equal(existsSync(resolve(workspace, root, "skills", "conduct", "SKILL.md")), true);
  }
});

test("install refuses a custom profile whose name collides with a tier agent", () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-collide-"));
  assert.equal(install(workspace).status, 0);
  const custom = resolve(workspace, ".harness", "custom", "agents");
  mkdirSync(custom, { recursive: true });
  writeFileSync(
    resolve(custom, "reviewer-deep.json"),
    JSON.stringify({ name: "reviewer-deep", allowedSkills: ["review"], deniedSkills: [] }),
  );
  const result = install(workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /agent "reviewer-deep" would be generated by reviewer at the deep tier and profile reviewer-deep/);
});

test("commands find the workspace from a nested directory when --workspace is omitted", () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-findws-"));
  assert.equal(install(workspace).status, 0);
  const configFile = resolve(workspace, ".harness", "config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  config.concurrency = { maxIssueAgents: 7 };
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  const worktree = resolve(workspace, "workspaces", "issues", "MAH-1", "repos", "app");
  mkdirSync(worktree, { recursive: true });
  const result = spawnSync("node", [resolve("dist/src/cli.js"), "capacity"], { cwd: worktree, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /caps: 7 issue agents per composer/);
});

test("reinstall keeps the Mahler command, worktree root, and Linear filters unless flags reset them", () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-keep-"));
  const cli = (args: string[]) => spawnSync("node", ["dist/src/cli.js", "install", workspace, ...args], { encoding: "utf8" });
  assert.equal(cli(["--linear-assignee", "gonzo", "--linear-label", "agent"]).status, 0);
  const configFile = resolve(workspace, ".harness", "config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  config.mahlerCommand = "node /opt/mahler/cli.js";
  config.workspaceDir = "worktrees";
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);

  assert.equal(cli([]).status, 0);
  let after = JSON.parse(readFileSync(configFile, "utf8"));
  assert.equal(after.mahlerCommand, "node /opt/mahler/cli.js");
  assert.equal(after.workspaceDir, "worktrees");
  assert.deepEqual(after.linear, { acceptedAssignees: ["gonzo"], requiredLabels: ["agent"] });
  assert.match(readFileSync(resolve(workspace, "CLAUDE.md"), "utf8"), /node \/opt\/mahler\/cli\.js issue/);

  assert.equal(cli(["--linear-assignee", "kermit"]).status, 0);
  after = JSON.parse(readFileSync(configFile, "utf8"));
  assert.deepEqual(after.linear, { acceptedAssignees: ["kermit"], requiredLabels: ["agent"] });
});

test("reinstall keeps guardrail and Definition of Done changes as overrides on Mahler's defaults", () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-keep-lists-"));
  assert.equal(install(workspace).status, 0);
  const configFile = resolve(workspace, ".harness", "config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  assert.deepEqual(config.guardrails, { add: [], remove: [] });
  const sizeRule = "PRs larger than about 1000 lines should be split into smaller, stacked PRs.";
  config.guardrails = { add: ["Deploys need on-call sign-off (enforced by the deploy tool)."], remove: [sizeRule] };
  config.definitionOfDone = { add: ["Release notes are drafted."] };
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);

  assert.equal(install(workspace).status, 0);
  const after = JSON.parse(readFileSync(configFile, "utf8"));
  assert.deepEqual(after.guardrails, { add: ["Deploys need on-call sign-off (enforced by the deploy tool)."], remove: [sizeRule] });
  assert.deepEqual(after.definitionOfDone, { add: ["Release notes are drafted."], remove: [] });
  const block = readFileSync(resolve(workspace, "CLAUDE.md"), "utf8");
  assert.match(block, /- Deploys need on-call sign-off/);
  assert.match(block, /- Required CI checks must pass before merge/);
  assert.doesNotMatch(block, /1000 lines/);
});

test("reinstall turns an older whole-list config into additions so new defaults still arrive", () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-keep-legacy-"));
  assert.equal(install(workspace).status, 0);
  const configFile = resolve(workspace, ".harness", "config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  // As written by an older Mahler: the whole list, including a retired default.
  config.guardrails = [
    "Merging to a repo's base branch requires a human-approved PR (enforced by the forge).",
    "Required CI checks must pass before merge (enforced by CI).",
    "Deploys need on-call sign-off (enforced by the deploy tool).",
  ];
  config.definitionOfDone = ["`mahler check` passes for every touched repo.", "A PR is opened for human review before merge."];
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);

  assert.equal(install(workspace).status, 0);
  const after = JSON.parse(readFileSync(configFile, "utf8"));
  assert.deepEqual(after.guardrails, { add: ["Deploys need on-call sign-off (enforced by the deploy tool)."], remove: [] });
  assert.deepEqual(after.definitionOfDone, { add: [], remove: [] });
  const block = readFileSync(resolve(workspace, "CLAUDE.md"), "utf8");
  assert.match(block, /- Only a human reviewer may merge a PR whose required CI checks are failing\./);
  assert.doesNotMatch(block, /requires a human-approved PR/);
});

test("reinstall keeps each runtime's profile and refreshes its skill and policy lists", () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-keep-agents-"));
  assert.equal(install(workspace).status, 0);
  const configFile = resolve(workspace, ".harness", "config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  const defaultSkills = config.agents.claude.skills;
  config.agents.claude = { ...config.agents.claude, profile: "conductor", role: "conductor", skills: ["retired-skill"], policies: [] };
  config.agents.cursor = { runtime: "cursor", profile: "reviewer", role: "reviewer", skills: ["review"], policies: ["review"] };
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);

  assert.equal(install(workspace).status, 0);
  const after = JSON.parse(readFileSync(configFile, "utf8"));
  assert.equal(after.agents.claude.profile, "conductor");
  assert.equal(after.agents.claude.role, "conductor");
  assert.deepEqual(after.agents.claude.skills, defaultSkills);
  assert.ok(after.agents.claude.policies.includes("merge"));
  assert.equal(after.agents.codex.profile, "composer");
  assert.deepEqual(after.agents.cursor, config.agents.cursor);
  assert.match(readFileSync(resolve(workspace, "CLAUDE.md"), "utf8"), /claude: conductor/);
});

test("custom overlay overrides a default and adds custom-only files; reinstall preserves both", () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-overlay-"));
  assert.equal(install(workspace).status, 0);

  const customPolicies = resolve(workspace, ".harness", "custom", "policies");
  mkdirSync(customPolicies, { recursive: true });
  const sentinel = "# Custom Commit Policy\n\nWORKSPACE SENTINEL VALUE\n";
  writeFileSync(resolve(customPolicies, "commit.md"), sentinel);
  writeFileSync(resolve(customPolicies, "house-style.md"), "# House Style\n\nCustom-only policy.\n");

  assert.equal(install(workspace).status, 0);

  const installedCommit = readFileSync(resolve(workspace, ".harness", "policies", "commit.md"), "utf8");
  assert.match(installedCommit, /WORKSPACE SENTINEL VALUE/, "override content should be used");
  assert.match(installedCommit, /Mahler default was replaced by \.harness\/custom\/policies\/commit\.md/, "provenance header present");

  const customOnly = readFileSync(resolve(workspace, ".harness", "policies", "house-style.md"), "utf8");
  assert.match(customOnly, /Custom-only policy/);
  assert.match(customOnly, /Installed from \.harness\/custom\/policies\/house-style\.md \(no Mahler default\)/);

  // The custom source files are never overwritten by reinstall.
  assert.equal(readFileSync(resolve(customPolicies, "commit.md"), "utf8"), sentinel);
});

test("install fails hard on a malformed custom source", () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "mahler-bad-overlay-"));
  assert.equal(install(workspace).status, 0);
  const customSkill = resolve(workspace, ".harness", "custom", "skills", "broken");
  mkdirSync(customSkill, { recursive: true });
  writeFileSync(resolve(customSkill, "SKILL.md"), "no frontmatter here\n");
  const result = install(workspace);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /malformed/);
});

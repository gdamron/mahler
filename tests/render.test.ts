import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { defaultConfig } from "../src/config.js";
import {
  claudeAgentDefinition,
  codexAgentDefinition,
  handoffMarkdown,
  launchCommand,
  nativeAdapter,
  rootAgentBlock,
  sessionMarkdown,
  mergeRouting,
  taskMarkdown,
  workflowMarkdown,
} from "../src/render.js";

test("workflow names issue prompts and project prompts", () => {
  const workflow = workflowMarkdown();
  assert.match(workflow, /work on FUG-123/);
  assert.match(workflow, /work on project X in Linear/);
});

test("workflow distinguishes the agent hierarchy from the human authority", () => {
  const workflow = workflowMarkdown();
  // Composer coordinates orchestrators; each orchestrator owns one issue and
  // delegates to implementers and reviewers. None of them is the human.
  assert.match(workflow, /[Cc]omposer agent/);
  assert.match(workflow, /dispatches one orchestrator per issue/i);
  assert.match(workflow, /[Oo]rchestrator agent/);
  assert.match(workflow, /delegates each slice to an implementer/i);
  assert.match(workflow, /synthesizes results/i);
  assert.match(workflow, /[Ff]ull-stack agent/);
  // The composer is the primary interface to the human; agents may act directly.
  assert.match(workflow, /primary interface to the human/i);
  assert.match(workflow, /empowered to take any action/i);
  // Human stays the final accountable authority for review and merge.
  assert.match(workflow, /final accountable authority/i);
  assert.match(workflow, /final review and merge/i);
  // The human is not modeled as an agent.
  assert.match(workflow, /not modeled as an agent/i);
});

test("workflow documents sub-agent delegation policy defaults", () => {
  const workflow = workflowMarkdown();
  assert.match(workflow, /sub-agent-delegation\.md/);
  assert.match(workflow, /default sub-agent authority is read-only/i);
  assert.match(workflow, /native\/runtime agent capabilities/i);
  assert.match(workflow, /not Mahler CLI commands/i);
});

test("native adapter tells agent to create briefs and choose worktrees", () => {
  const adapter = nativeAdapter("codex");
  assert.match(adapter, /create the issue brief/);
  assert.match(adapter, /Decide which configured repos need worktrees/);
  assert.match(adapter, /Record deliberate workflow deviations/);
});

test("native adapters reference routing, profiles, skills, and policies", () => {
  for (const runtime of ["codex", "claude"] as const) {
    const adapter = nativeAdapter(runtime);
    assert.match(adapter, /work on MAH-123/);
    assert.match(adapter, /\.harness\/config\.json/);
    assert.match(adapter, /\.harness\/agents\/profiles/);
    if (runtime === "codex") {
      assert.match(adapter, /\.agents\/skills\/work-on-issue\/SKILL\.md/);
      assert.match(
        adapter,
        /\.agents\/skills\/select-project-issue\/SKILL\.md/,
      );
    } else {
      assert.match(adapter, /\.claude\/skills\/work-on-issue\/SKILL\.md/);
      assert.match(
        adapter,
        /\.claude\/skills\/select-project-issue\/SKILL\.md/,
      );
    }
    assert.match(adapter, /\.harness\/policies/);
    assert.match(adapter, /\.harness\/tmp\/linear/);
    assert.match(adapter, /mahler linear-template issue\|project/);
  }
});

test("claude adapter points project instructions at canonical installed content", () => {
  const adapter = nativeAdapter("claude");
  assert.match(adapter, /CLAUDE\.md/);
  assert.match(adapter, /canonical installed skills and policies/);
});

test("native adapters keep profile mismatches advisory and reserve confirmation for outward actions", () => {
  for (const runtime of ["codex", "claude"] as const) {
    const adapter = nativeAdapter(runtime);
    assert.match(
      adapter,
      /outside the active profile, treat it as a Tier 1 deviation/,
    );
    assert.match(adapter, /Merging a PR is a Tier 2 action/);
    assert.doesNotMatch(
      adapter,
      /using a skill outside the active profile are Tier 2/,
    );
  }
});

test("root agent block gives bare prompt path to mahler issue", () => {
  const block = rootAgentBlock(defaultConfig("/tmp/workspace"));
  assert.match(block, /work on MAH-123/);
  assert.match(
    block,
    /mahler issue <ISSUE> --agent <codex\|claude> --linear-file <issue\.json>/,
  );
  assert.match(block, /Recommended routing/);
  assert.match(block, /Active profile check/);
  assert.match(block, /Create git worktrees only for repos needed/);
  assert.match(block, /Mahler does not choose branch names/);
  assert.match(block, /Sub-agent delegation/);
  assert.match(block, /default to read-only authority/);
  assert.match(block, /mahler subagent \.\.\./);
  assert.match(block, /\.harness\/agents\/profiles/);
  assert.match(block, /\.agents\/skills/);
  assert.match(block, /\.claude\/skills/);
  assert.match(block, /\.harness\/policies/);
});

test("root agent block and session brief declare Tier 3 guardrails", () => {
  const config = defaultConfig("/tmp/workspace");
  const block = rootAgentBlock(config);
  assert.match(block, /Guardrails \(Tier 3/);
  assert.match(block, /enforced by the forge\/CI, not Mahler/);
  assert.match(block, /human reviewer/);

  const session = sessionMarkdown(
    { identifier: "MAH-1", title: "t", labels: [], blocked: false },
    "codex",
    "/tmp/workspace/workspaces/issues/MAH-1",
    config.repos,
    undefined,
    config.guardrails,
  );
  assert.match(session, /## Guardrails \(enforced outside Mahler/);
  assert.match(session, /human reviewer/);
});

test("session brief points orchestrators to sub-agent delegation policy", () => {
  const config = defaultConfig("/tmp/workspace");
  const session = sessionMarkdown(
    { identifier: "MAH-15", title: "t", labels: [], blocked: false },
    "codex",
    "/tmp/workspace/workspaces/issues/MAH-15",
    config.repos,
    undefined,
    config.guardrails,
  );
  assert.match(session, /sub-agent-delegation\.md/);
  assert.match(session, /prefer configured roles/i);
  assert.match(session, /read-only unless edit scope is explicit/i);
});

test("task and session briefs render layered Definition of Done", () => {
  const config = defaultConfig("/tmp/workspace");
  const issue = {
    identifier: "MAH-11",
    title: "Layered Definition of Done",
    labels: ["agent"],
    blocked: false,
    acceptanceCriteria: [
      "Acceptance criteria from Linear is satisfied.",
      config.definitionOfDone[0],
    ],
  };

  const task = taskMarkdown(issue, "linear-file", config.definitionOfDone);
  const session = sessionMarkdown(
    issue,
    "codex",
    "/tmp/workspace/workspaces/issues/MAH-11",
    config.repos,
    undefined,
    config.guardrails,
    config.definitionOfDone,
  );

  for (const brief of [task, session]) {
    assert.match(brief, /## Definition of Done/);
    assert.match(
      brief,
      /- \[ \] `mahler check` passes for every touched repo\./,
    );
    assert.match(
      brief,
      /- \[ \] Acceptance criteria from Linear is satisfied\./,
    );
    assert.equal(
      brief.match(/`mahler check` passes for every touched repo\./g)?.length,
      1,
    );
  }
});

test("task brief renders baseline-only Definition of Done and optional issue notes", () => {
  const config = defaultConfig("/tmp/workspace");
  const task = taskMarkdown(
    {
      identifier: "MAH-12",
      title: "Baseline only",
      labels: ["agent"],
      blocked: false,
      nonGoals: ["Do not redesign the workflow."],
      protectedAreas: ["Generated install outputs."],
      riskNotes: ["Existing configs may not have the new key."],
    },
    "linear-file",
    config.definitionOfDone,
  );

  assert.match(task, /## Definition of Done/);
  assert.match(task, /- \[ \] Self-review is complete\./);
  assert.match(task, /## Non-Goals\n\n- Do not redesign the workflow\./);
  assert.match(task, /## Protected Areas\n\n- Generated install outputs\./);
  assert.match(
    task,
    /## Risk Notes\n\n- Existing configs may not have the new key\./,
  );
});

test("handoff markdown includes structured status review quality and deviations", () => {
  const handoff = handoffMarkdown({
    identifier: "MAH-10",
    title: "t",
    labels: [],
    blocked: false,
  });
  assert.match(handoff, /## Status/);
  assert.match(handoff, /- Phase: brief-created/);
  assert.match(handoff, /- State: not started/);
  assert.match(handoff, /## Reviews/);
  assert.match(handoff, /- Self-review: not started/);
  assert.match(handoff, /- Agent review: not requested/);
  assert.match(handoff, /- Human review: pending/);
  assert.match(handoff, /## Quality/);
  assert.match(handoff, /- Relevant tests\/checks:/);
  assert.match(handoff, /- Full test suite:/);
  assert.match(handoff, /- Known risks:/);
  assert.match(handoff, /- Skipped checks and reasons:/);
  assert.match(handoff, /## Workflow Deviations/);
  assert.match(handoff, /\| Decision \| Reason \| Risk \| Follow-up \|/);
  assert.match(handoff, /\|---\|---\|---\|---\|/);
});

test("native agent definitions include profile permissions", () => {
  const profile = {
    name: "implementer",
    description: "Implements issue-scoped changes and leaves a handoff.",
    allowedSkills: ["work-on-issue", "handoff"],
    deniedSkills: ["commit", "pr"],
  };
  assert.match(
    codexAgentDefinition(profile),
    /\.agents\/skills\/<skill>\/SKILL\.md/,
  );
  assert.match(
    codexAgentDefinition(profile),
    /Allowed skills: work-on-issue, handoff/,
  );
  assert.match(codexAgentDefinition(profile), /Tier 1 role-fit deviation/);
  assert.match(
    claudeAgentDefinition(profile),
    /\.claude\/skills\/<skill>\/SKILL\.md/,
  );
  assert.match(claudeAgentDefinition(profile), /Denied skills: commit, pr/);
  assert.match(claudeAgentDefinition(profile), /Tier 1 role-fit deviation/);
});

test("skill stop conditions do not hard-stop on profile mismatch", () => {
  const skillsDir = resolve(process.cwd(), "skills");
  for (const skill of readdirSync(skillsDir)) {
    const body = readFileSync(resolve(skillsDir, skill, "SKILL.md"), "utf8");
    assert.doesNotMatch(body, /active profile does not/);
    assert.doesNotMatch(body, /outside the active profile.*confirm/i);
  }
});

test("launch commands are agent specific", () => {
  assert.match(launchCommand("codex", "/tmp/repo", "/tmp/meta"), /^codex --cd/);
  assert.match(
    launchCommand("claude", "/tmp/repo", "/tmp/meta"),
    /^claude --add-dir/,
  );
});

test("merge routing reflects issue labels, human review first", () => {
  const merge = { humanReviewLabels: ["high-risk"], agentMergeLabels: ["agent-merge"] };
  const issue = (labels: string[]) => ({ identifier: "MAH-2", title: "t", labels, blocked: false });

  const human = mergeRouting(issue(["Agent-Merge", "HIGH-RISK"]), merge);
  assert.match(human, /Human review required/);
  assert.match(human, /`HIGH-RISK`/);

  assert.match(mergeRouting(issue(["agent-merge"]), merge), /Agent merge pre-approved/);
  assert.match(mergeRouting(issue([]), merge), /Issue labels: \(none\)/);
  assert.match(mergeRouting(issue(["bug"]), merge), /risk rubric/);
  assert.match(mergeRouting(issue([]), merge), /merge\.md/);
});

test("session brief and root block declare merge routing", () => {
  const config = defaultConfig("/tmp/workspace");
  const session = sessionMarkdown(
    { identifier: "MAH-3", title: "t", labels: ["high-risk"], blocked: false },
    "codex",
    "/tmp/workspace/workspaces/issues/MAH-3",
    config.repos,
    undefined,
    config.guardrails,
    config.definitionOfDone,
    config.merge,
  );
  assert.match(session, /## Merge/);
  assert.match(session, /Human review required/);

  const block = rootAgentBlock(config);
  assert.match(block, /only a composer may take/);
  assert.match(block, /`high-risk` require human review/);
  assert.match(block, /`agent-merge` pre-approve/);
});

test("merge routing includes project labels", () => {
  const merge = { humanReviewLabels: ["high-risk"], agentMergeLabels: ["agent-merge"] };
  const base = { identifier: "MAH-6", title: "t", blocked: false };

  const unknown = mergeRouting({ ...base, labels: ["agent-merge"] }, merge);
  assert.match(unknown, /Project labels: \(unknown/);
  assert.match(unknown, /Agent merge pre-approved/);

  const projectHuman = mergeRouting(
    { ...base, labels: ["agent-merge"], projectLabels: ["High-Risk"] },
    merge,
  );
  assert.match(projectHuman, /Project labels: `High-Risk`/);
  assert.match(projectHuman, /Human review required: label `High-Risk`/);

  const projectAgent = mergeRouting({ ...base, labels: [], projectLabels: ["agent-merge"] }, merge);
  assert.match(projectAgent, /Agent merge pre-approved/);
  assert.match(mergeRouting({ ...base, labels: [], projectLabels: [] }, merge), /Project labels: \(none\)/);
});

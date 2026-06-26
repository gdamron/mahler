import test from "node:test";
import assert from "node:assert/strict";
import { defaultConfig } from "../src/config.js";
import { claudeAgentDefinition, codexAgentDefinition, handoffMarkdown, launchCommand, nativeAdapter, rootAgentBlock, sessionMarkdown, taskMarkdown, workflowMarkdown } from "../src/render.js";

test("workflow names issue prompts and project prompts", () => {
  const workflow = workflowMarkdown();
  assert.match(workflow, /work on FUG-123/);
  assert.match(workflow, /work on project X in Linear/);
});

test("workflow distinguishes the orchestrator agent from the human authority", () => {
  const workflow = workflowMarkdown();
  // Orchestrator is an agent role that coordinates sub-agents, not the human.
  assert.match(workflow, /[Oo]rchestrator agent/);
  assert.match(workflow, /coordinates sub-agents/i);
  assert.match(workflow, /synthesizes their outputs/i);
  assert.match(workflow, /surfaces risks to the human/i);
  // It is the primary interface to the human and empowered to act directly.
  assert.match(workflow, /primary interface to the human/i);
  assert.match(workflow, /empowered to take any action/i);
  // Human stays the final accountable authority for review and merge.
  assert.match(workflow, /final accountable authority/i);
  assert.match(workflow, /final review and merge/i);
  // The human is not modeled as an agent.
  assert.match(workflow, /not modeled as an agent/i);
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
      assert.match(adapter, /\.agents\/skills\/select-project-issue\/SKILL\.md/);
    } else {
      assert.match(adapter, /\.claude\/skills\/work-on-issue\/SKILL\.md/);
      assert.match(adapter, /\.claude\/skills\/select-project-issue\/SKILL\.md/);
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

test("root agent block gives bare prompt path to mahler issue", () => {
  const block = rootAgentBlock(defaultConfig("/tmp/workspace"));
  assert.match(block, /work on MAH-123/);
  assert.match(block, /mahler issue <ISSUE> --agent <codex\|claude> --linear-file <issue\.json>/);
  assert.match(block, /Recommended routing/);
  assert.match(block, /Active profile check/);
  assert.match(block, /Create git worktrees only for repos needed/);
  assert.match(block, /Mahler does not choose branch names/);
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
  assert.match(block, /human-approved PR/);

  const session = sessionMarkdown(
    { identifier: "MAH-1", title: "t", labels: [], blocked: false },
    "codex",
    "/tmp/workspace/workspaces/issues/MAH-1",
    config.repos,
    undefined,
    config.guardrails
  );
  assert.match(session, /## Guardrails \(enforced outside Mahler/);
  assert.match(session, /human-approved PR/);
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
      config.definitionOfDone[0]
    ]
  };

  const task = taskMarkdown(issue, "linear-file", config.definitionOfDone);
  const session = sessionMarkdown(
    issue,
    "codex",
    "/tmp/workspace/workspaces/issues/MAH-11",
    config.repos,
    undefined,
    config.guardrails,
    config.definitionOfDone
  );

  for (const brief of [task, session]) {
    assert.match(brief, /## Definition of Done/);
    assert.match(brief, /- \[ \] `mahler check` passes for every touched repo\./);
    assert.match(brief, /- \[ \] Acceptance criteria from Linear is satisfied\./);
    assert.equal(brief.match(/`mahler check` passes for every touched repo\./g)?.length, 1);
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
      riskNotes: ["Existing configs may not have the new key."]
    },
    "linear-file",
    config.definitionOfDone
  );

  assert.match(task, /## Definition of Done/);
  assert.match(task, /- \[ \] Self-review is complete\./);
  assert.match(task, /## Non-Goals\n\n- Do not redesign the workflow\./);
  assert.match(task, /## Protected Areas\n\n- Generated install outputs\./);
  assert.match(task, /## Risk Notes\n\n- Existing configs may not have the new key\./);
});

test("handoff markdown includes structured status review quality and deviations", () => {
  const handoff = handoffMarkdown({ identifier: "MAH-10", title: "t", labels: [], blocked: false });
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
    deniedSkills: ["commit", "pr"]
  };
  assert.match(codexAgentDefinition(profile), /\.agents\/skills\/<skill>\/SKILL\.md/);
  assert.match(codexAgentDefinition(profile), /Allowed skills: work-on-issue, handoff/);
  assert.match(claudeAgentDefinition(profile), /\.claude\/skills\/<skill>\/SKILL\.md/);
  assert.match(claudeAgentDefinition(profile), /Denied skills: commit, pr/);
});

test("launch commands are agent specific", () => {
  assert.match(launchCommand("codex", "/tmp/repo", "/tmp/meta"), /^codex --cd/);
  assert.match(launchCommand("claude", "/tmp/repo", "/tmp/meta"), /^claude --add-dir/);
});

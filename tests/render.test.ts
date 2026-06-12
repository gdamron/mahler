import test from "node:test";
import assert from "node:assert/strict";
import { defaultConfig } from "../src/config.js";
import { claudeAgentDefinition, codexAgentDefinition, launchCommand, nativeAdapter, rootAgentBlock, workflowMarkdown } from "../src/render.js";

test("workflow names issue prompts and project prompts", () => {
  const workflow = workflowMarkdown();
  assert.match(workflow, /work on FUG-123/);
  assert.match(workflow, /work on project X in Linear/);
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

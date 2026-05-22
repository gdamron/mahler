import test from "node:test";
import assert from "node:assert/strict";
import { defaultConfig } from "../src/config.js";
import { launchCommand, nativeAdapter, rootAgentBlock, workflowMarkdown } from "../src/render.js";

test("workflow names issue prompts and project prompts", () => {
  const workflow = workflowMarkdown();
  assert.match(workflow, /work on FUG-123/);
  assert.match(workflow, /work on project X in Linear/);
});

test("native adapter tells agent not to bypass Mahler", () => {
  assert.match(nativeAdapter("codex"), /Do not bypass the Mahler workspace setup/);
});

test("native adapters reference routing, profiles, skills, and policies", () => {
  for (const runtime of ["codex", "claude"] as const) {
    const adapter = nativeAdapter(runtime);
    assert.match(adapter, /work on MAH-123/);
    assert.match(adapter, /\.harness\/config\.json/);
    assert.match(adapter, /\.harness\/agents\/profiles/);
    assert.match(adapter, /\.harness\/skills\/work-on-issue\.md/);
    assert.match(adapter, /\.harness\/skills\/select-project-issue\.md/);
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
  assert.match(block, /Active profile check/);
  assert.match(block, /\.harness\/agents\/profiles/);
  assert.match(block, /\.harness\/skills/);
  assert.match(block, /\.harness\/policies/);
});

test("launch commands are agent specific", () => {
  assert.match(launchCommand("codex", "/tmp/repo", "/tmp/meta"), /^codex --cd/);
  assert.match(launchCommand("claude", "/tmp/repo", "/tmp/meta"), /^claude --add-dir/);
});

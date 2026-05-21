import test from "node:test";
import assert from "node:assert/strict";
import { launchCommand, nativeAdapter, workflowMarkdown } from "../src/render.js";

test("workflow names issue prompts and project prompts", () => {
  const workflow = workflowMarkdown();
  assert.match(workflow, /work on FUG-123/);
  assert.match(workflow, /work on project X in Linear/);
});

test("native adapter tells agent not to bypass Mahler", () => {
  assert.match(nativeAdapter("codex"), /Do not bypass the Mahler workspace setup/);
});

test("launch commands are agent specific", () => {
  assert.match(launchCommand("codex", "/tmp/repo", "/tmp/meta"), /^codex --cd/);
  assert.match(launchCommand("claude", "/tmp/repo", "/tmp/meta"), /^claude --add-dir/);
});

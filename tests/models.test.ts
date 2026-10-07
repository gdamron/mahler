import test from "node:test";
import assert from "node:assert/strict";
import { capacityReport } from "../src/commands/capacity.js";
import { defaultConcurrency, defaultModels } from "../src/config.js";
import { claudeTierVariants, defaultModelFor, modelConfigProblems } from "../src/models.js";
import { profileNames } from "../src/scaffold.js";

test("default models config is consistent with the canonical profiles", () => {
  assert.deepEqual(modelConfigProblems(defaultModels(), profileNames()), []);
});

test("defaultModelFor pins model and effort, but not skill or agent routes", () => {
  const models = defaultModels();
  assert.deepEqual(defaultModelFor(models, "reviewer", "claude"), {
    model: "sonnet",
    effort: "high",
  });
  assert.deepEqual(defaultModelFor(models, "reviewer", "codex"), {
    model: "gpt-6.1-sol",
    effort: "medium",
  });
  // Profiles a human talks to inherit the session's model.
  assert.equal(defaultModelFor(models, "conductor", "claude")?.model, "inherit");
  assert.equal(defaultModelFor(models, "composer", "codex")?.model, undefined);
  models.tiers.cross = { claude: { skill: "codex:review" } };
  models.profiles.reviewer = { default: "cross", allowed: ["cross"] };
  assert.equal(defaultModelFor(models, "reviewer", "claude"), undefined);
  assert.equal(defaultModelFor(models, "unknown", "claude"), undefined);
});

test("claudeTierVariants covers each other allowed tier that pins a model or effort", () => {
  const models = defaultModels();
  assert.deepEqual(
    claudeTierVariants(models, "conductor").map((v) => [v.name, v.choice]),
    [
      ["conductor-trivial", { model: "haiku", effort: "high" }],
      ["conductor-light", { model: "sonnet", effort: "high" }],
      ["conductor-standard", { model: "opus", effort: "medium" }],
      ["conductor-deep", { model: "opus", effort: "high" }],
    ],
  );
  // Composer allows only its default tier.
  assert.deepEqual(claudeTierVariants(models, "composer"), []);
  // Skill routes and tiers identical to the default get no definition.
  models.tiers.cross = { claude: { skill: "codex:review" } };
  models.tiers.same = { claude: { model: "sonnet", effort: "high" } };
  models.profiles.reviewer.allowed = ["light", "cross", "same", "deep", "inherit"];
  assert.deepEqual(
    claudeTierVariants(models, "reviewer").map((v) => [v.name, v.choice.model]),
    [["reviewer-deep", "opus"], ["reviewer-inherit", "inherit"]],
  );
});

test("modelConfigProblems flags bad efforts, undefined tiers, and mixed routes", () => {
  const models = defaultModels();
  models.tiers.light.codex = { effort: "turbo" };
  models.tiers.inherit = { claude: { model: "opus" } };
  models.tiers.odd = { claude: { skill: "codex:review", model: "opus" } };
  models.profiles.reviewer = { default: "missing", allowed: ["light"] };
  const problems = modelConfigProblems(models, profileNames()).join("\n");
  assert.match(problems, /light\.codex\.effort "turbo"/);
  assert.match(problems, /models\.tiers\.inherit is reserved/);
  assert.match(problems, /ignores model and effort/);
  assert.match(problems, /undefined tier "missing"/);
  assert.match(problems, /not in its allowed list/);
});

test("capacityReport says busy above the per-core threshold and ok below it", () => {
  const caps = defaultConcurrency();
  const busy = capacityReport(caps, { cores: 4, load: [4, 3, 2] });
  assert.match(busy, /verdict: busy/);
  const ok = capacityReport(caps, { cores: 10, load: [2, 2, 2] });
  assert.match(ok, /verdict: ok — about 6 core\(s\) of headroom/);
  const unknown = capacityReport(caps, { cores: 8 });
  assert.match(unknown, /load: unavailable/);
});

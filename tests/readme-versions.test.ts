import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { EARLIER_README_HASHES, sha256 } from "../src/readme-versions.js";
import { run, workspace } from "./knowledge-fixtures.js";

// The template texts this version installs. Changing a template changes its
// hash: add the old hash to EARLIER_README_HASHES, so reinstall can update
// workspaces that never edited it, then update this one.
const CURRENT = {
  "decisions-readme": "335064145e764b0747564e1c982bd1b64acf019dd87ce4a4d8a5fb6a2923d7dc",
  "knowledge-readme": "8c368f02a788df3cde78fc416f3d1f71cf240860af73f75b1cc8b564033dca9d",
  "custom-readme": "43135aa619b15a362ff2c7ec9c230f632a209ec39a6d9fbee57caa966f4ddf26",
};

test("each changed README template keeps its earlier text's hash", () => {
  for (const [template, hash] of Object.entries(CURRENT)) {
    const text = readFileSync(resolve("templates", `${template}.md`), "utf8");
    assert.equal(
      sha256(text),
      hash,
      `templates/${template}.md changed: add ${hash} to EARLIER_README_HASHES["${template}"] in src/readme-versions.ts, then set this test's hash to ${sha256(text)}`,
    );
    assert.ok(!EARLIER_README_HASHES[template].includes(hash));
  }
});

test("reinstall updates a README left as an earlier version wrote it, and keeps an edited one", () => {
  const old = readFileSync(resolve("tests/fixtures/decisions-readme-2026.10.2.md"), "utf8");
  const dir = workspace();
  const readme = resolve(dir, ".harness/decisions/README.md");
  writeFileSync(readme, old);
  const installed = run(["install", dir]);
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /Updated .*decisions\/README\.md: it was unedited since an earlier Mahler version\./);
  assert.equal(readFileSync(readme, "utf8"), readFileSync(resolve("templates/decisions-readme.md"), "utf8"));

  writeFileSync(readme, `${old}\nOur own note.\n`);
  const again = run(["install", dir]);
  assert.doesNotMatch(again.stdout, /Updated /);
  assert.match(readFileSync(readme, "utf8"), /Our own note\./);
});

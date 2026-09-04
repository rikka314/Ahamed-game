import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildE3ReuseSourceBinding } from "../src/evaluation/e3-reuse-policy.js";

test("E3 reuse binding covers the full source tree and required benchmark test", () => {
  const root = mkdtempSync(join(tmpdir(), "ahamed-e3-reuse-"));
  try {
    mkdirSync(join(root, "src", "nested"), { recursive: true });
    mkdirSync(join(root, "tests"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
    writeFileSync(join(root, "src", "nested", "b.ts"), "export const b = 2;\n");
    writeFileSync(join(root, "src", "nested", "ignored.js"), "export const c = 3;\n");
    writeFileSync(join(root, "tests", "e3-persona-benchmark.test.ts"), "test('e3');\n");

    const first = buildE3ReuseSourceBinding(root);
    assert.equal(first.sourceFileCount, 3);
    assert.match(first.sourceTreeSha256, /^[a-f0-9]{64}$/u);

    writeFileSync(join(root, "src", "nested", "b.ts"), "export const b = 4;\n");
    const second = buildE3ReuseSourceBinding(root);
    assert.notEqual(second.sourceTreeSha256, first.sourceTreeSha256);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

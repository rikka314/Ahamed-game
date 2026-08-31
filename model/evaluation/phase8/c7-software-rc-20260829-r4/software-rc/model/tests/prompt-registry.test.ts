import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  FilePromptRegistry,
  PromptRegistryError,
} from "../src/prompts/prompt-registry.js";

test("loads the frozen Phase 4 role prompts with stable hashes", () => {
  const registry = new FilePromptRegistry(resolve("prompts"));

  const controller = registry.load("controller", "v0.1.0");
  const patient = registry.load("patient", "v0.1.0");
  const review = registry.load("review", "v0.1.0");

  assert.equal(controller.role, "controller");
  assert.equal(patient.role, "patient");
  assert.equal(review.role, "review");
  assert.match(controller.sha256, /^[a-f0-9]{64}$/u);
  assert.notEqual(controller.sha256, patient.sha256);
  assert.deepEqual(registry.load("controller", "v0.1.0"), controller);
});

test("loads the C2 single Patient Agent prompt set", () => {
  const registry = new FilePromptRegistry(resolve("prompts"));
  const controller = registry.load("controller", "v0.2.0");
  const patient = registry.load("patient", "v0.2.0");
  const review = registry.load("review", "v0.2.0");

  assert.match(patient.content, /唯一在线 Patient Agent/u);
  assert.match(patient.content, /safeCaseView/u);
  assert.match(patient.content, /requestedTestId/u);
  assert.match(controller.content, /不得调用 Controller/u);
  assert.notEqual(patient.sha256, review.sha256);
});

test("prompt loading fails closed for traversal, missing, and empty versions", () => {
  const root = mkdtempSync(join(tmpdir(), "ahamed-prompts-"));
  try {
    mkdirSync(join(root, "controller"), { recursive: true });
    writeFileSync(join(root, "controller", "v0.1.0.md"), "   \n", "utf8");
    const registry = new FilePromptRegistry(root);

    assert.throws(
      () => registry.load("controller", "../secret"),
      PromptRegistryError,
    );
    assert.throws(
      () => registry.load("patient", "v0.1.0"),
      PromptRegistryError,
    );
    assert.throws(
      () => registry.load("controller", "v0.1.0"),
      PromptRegistryError,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

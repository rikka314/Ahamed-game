import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  buildPromptSetVersion,
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

test("loads the immersive AI-led Patient Agent prompt", () => {
  const registry = new FilePromptRegistry(resolve("prompts"));
  const controller = registry.load("controller", "v0.3.0");
  const patient = registry.load("patient", "v0.3.0");
  const review = registry.load("review", "v0.3.0");

  assert.match(patient.content, /AI 主导/u);
  assert.match(patient.content, /自主、自然地补全/u);
  assert.match(patient.content, /完整 `recentTurns`/u);
  assert.match(patient.content, /病例里没写/u);
  assert.match(controller.content, /不得调用 Controller/u);
  assert.match(review.content, /沟通量表/u);
});

test("loads the AI diagnosis-intent Patient Agent prompt", () => {
  const registry = new FilePromptRegistry(resolve("prompts"));
  const patient = registry.load("patient", "v0.4.0");

  assert.match(patient.content, /diagnosisIntent/u);
  assert.match(patient.content, /submit_diagnosis/u);
  assert.match(patient.content, /主诊断/u);
  assert.match(patient.content, /多个疾病/u);
  assert.match(patient.content, /不得判断诊断是否正确/u);
});

test("loads the Persona v2 Patient Agent prompt", () => {
  const registry = new FilePromptRegistry(resolve("prompts"));
  const controller = registry.load("controller", "v0.5.0");
  const patient = registry.load("patient", "v0.5.0");
  const review = registry.load("review", "v0.5.0");

  assert.match(patient.content, /patientIdentity/u);
  assert.match(patient.content, /patient-persona-templates-v2/u);
  assert.match(patient.content, /healthLiteracy/u);
  assert.match(patient.content, /recallReliability/u);
  assert.match(patient.content, /emotionalIntensity/u);
  assert.match(patient.content, /不得改变.*医学事实/u);
  assert.match(controller.content, /不得调用 Controller/u);
  assert.match(review.content, /不得改变医学评分/u);
  assert.equal(
    buildPromptSetVersion("v0.5.0", { controller, patient, review }),
    "v0.5.0+set.0aac708b202d7b18",
  );
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

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  projectClientCaseV1,
  SCORING_CONTRACT_V1,
  type ClientCaseProjectionV1,
} from "@ahamed/doctor-game-share";
import {
  validateJsonSchemaDocument,
  type JsonSchemaSubset,
} from "@ahamed/doctor-game-share/schema-validation";
import { scoreWithPolicyV1 } from "../../src/evaluation/scoring-policy-v1.js";
import { createCaseFixture } from "../fixtures/case-fixture.js";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

test("private CasePackage v1-rc1 fixtures pass and fail the frozen JSON Schema", () => {
  const caseSchema = readJson(
    "cases/schemas/case-package-v1-rc1.schema.json",
  ) as JsonSchemaSubset;
  const rubricSchema = readJson(
    "cases/schemas/rubric-v1.schema.json",
  ) as JsonSchemaSubset;
  const reviewSchema = readJson(
    "cases/schemas/review-record-v1.schema.json",
  ) as JsonSchemaSubset;
  const provenanceSchema = readJson(
    "cases/schemas/provenance-record-v1.schema.json",
  ) as JsonSchemaSubset;
  const redFlagSchema = readJson(
    "cases/schemas/red-flag-exclusion-matrix-v1.schema.json",
  ) as JsonSchemaSubset;
  const positive = readJson("cases/fixtures/case-fixture-001.json");
  const negative = readJson("tests/fixtures/case-package-invalid.json");
  const documents = {
    "rubric-v1.schema.json": rubricSchema,
    "review-record-v1.schema.json": reviewSchema,
    "provenance-record-v1.schema.json": provenanceSchema,
    "red-flag-exclusion-matrix-v1.schema.json": redFlagSchema,
  };

  const accepted = validateJsonSchemaDocument(
    caseSchema,
    positive,
    documents,
  );
  assert.equal(accepted.valid, true, accepted.errors.join("\n"));

  const rejected = validateJsonSchemaDocument(
    caseSchema,
    negative,
    documents,
  );
  assert.equal(rejected.valid, false);
  assert.ok(rejected.errors.length >= 3);
});

test("approved review schema rejects a rejected release decision", () => {
  const reviewSchema = readJson(
    "cases/schemas/review-record-v1.schema.json",
  ) as JsonSchemaSubset;
  const approved = {
    status: "approved",
    author: "review-board",
    releaseApproval: {
      reviewerId: "reviewer.001",
      caseId: "case_fixture_001",
      caseVersion: "1.0.0",
      contentHash: `sha256:${"a".repeat(64)}`,
      checklistVersion: "checklist.v1",
      decision: "approved",
      signedAt: "2026-08-26T00:00:00Z",
      signatureMethod: "fixture-signature",
    },
  };
  assert.equal(
    validateJsonSchemaDocument(reviewSchema, approved).valid,
    true,
  );
  assert.equal(
    validateJsonSchemaDocument(reviewSchema, {
      ...approved,
      releaseApproval: {
        ...approved.releaseApproval,
        decision: "rejected",
      },
    }).valid,
    false,
  );
});

test("model scoring uses the shared version and weights", () => {
  const casePackage = createCaseFixture();
  const result = scoreWithPolicyV1({
    casePackage,
    primaryDiagnosis: casePackage.answerKey.targetDiagnosis,
    differentials: ["Example Condition", "Second Example Condition"],
    disclosedFactIds: [...casePackage.rubric.mustAskFactIds],
    completedTestIds: ["test.basic_panel"],
    medicalTurnCount: 1,
    repeatTurnCount: 0,
    otherTurnCount: 0,
    sessionTurnIds: ["turn.contract-001"],
    communication: {
      status: "available",
      score: 50,
      supportingTurnIds: ["turn.contract-001"],
      rubricCriterionIds: ["communication.respectful_clear"],
    },
  });
  const weighted = Object.entries(SCORING_CONTRACT_V1.weights).reduce(
    (sum, [component, weight]) =>
      sum + Number(result.components[component as keyof typeof result.components]) * weight,
    0,
  );

  assert.equal(result.evaluationVersion, SCORING_CONTRACT_V1.evaluationVersion);
  assert.equal(result.total, Math.round(weighted));
});

test("model-side client projection uses the shared allowlist", () => {
  const internal = {
    contractVersion: "1",
    sessionId: "session.contract-001",
    caseVersion: "case-v1",
    initialPresentation: "虚构患者咳嗽两天。",
    disclosedFacts: [],
    completedTests: [],
    turnCount: 0,
    turnLimit: 20,
    sessionPhase: "active",
    answerKey: { targetDiagnosis: "不得公开" },
    rubric: { hidden: true },
    prompt: "不得公开",
  } as unknown as ClientCaseProjectionV1;

  const serialized = JSON.stringify(projectClientCaseV1(internal));
  assert.doesNotMatch(serialized, /answerKey|rubric|prompt|不得公开/);
});

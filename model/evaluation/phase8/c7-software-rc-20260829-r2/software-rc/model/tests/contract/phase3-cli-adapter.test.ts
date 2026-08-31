import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  validateJsonSchemaSubset,
  type JsonSchemaSubset,
} from "@ahamed/doctor-game-share/schema-validation";

import {
  toCancelSessionResponseV1,
  toCreateSessionResponseV1,
  toEvaluationResultV1,
  toSharedErrorV1,
  toTestResultV1,
  toTurnCompletedV1,
} from "../../src/adapters/share-v1-adapter.js";
import type { EvaluationCompleted } from "../../src/application/model-service.js";
import { ModelServiceError } from "../../src/domain/errors.js";

const publicSchema = JSON.parse(
  readFileSync("../share/schemas/v1/public-contracts.schema.json", "utf8"),
) as JsonSchemaSubset;

function assertContract(name: string, value: unknown): void {
  const result = validateJsonSchemaSubset(publicSchema, name, value);
  assert.equal(result.valid, true, result.errors.join("\n"));
}

test("Phase 3 adapters emit share v1-rc1 schema-valid DTOs", () => {
  const created = toCreateSessionResponseV1({
    session: {
      contractVersion: "1",
      sessionId: "session.adapter-001",
      caseId: "case.adapter-001",
      caseVersion: "0.1.0",
      patientNpcId: "npc.adapter-001",
      chiefComplaint: "虚构主诉",
      patientDisplay: { displayName: "虚构患者" },
      allowedActions: ["ask_patient", "order_test", "submit_diagnosis"],
      sessionPhase: "active",
    },
    projection: {
      sessionId: "session.adapter-001",
      caseVersion: "0.1.0",
      initialPresentation: "虚构主诉",
      disclosedFacts: [],
      completedTests: [],
      turnCount: 0,
      turnLimit: 8,
      sessionPhase: "active",
    },
  });
  assertContract("CreateSessionResponseV1", created);

  const turn = toTurnCompletedV1({
    sessionId: "session.adapter-001",
    turnId: "turn.adapter-001",
    reply: "两天前开始。",
    disclosedFactIds: ["fact.onset"],
    effects: [{
      type: "test_completed",
      result: {
        testId: "test.vital_signs",
        status: "completed",
        report: "合成检查结果。",
      },
    }],
    turnNumber: 1,
    sessionPhase: "active",
  });
  assertContract("TurnCompletedV1", turn);

  const testResult = toTestResultV1({
    testId: "test.vital_signs",
    status: "completed",
    report: "合成检查结果。",
  });
  assertContract("TestResultV1", testResult);

  const evaluation: EvaluationCompleted = {
    diagnosis: {
      correct: true,
      matchType: "synonym",
      explanation: "命中审核词表。",
    },
    scores: {
      diagnosis: 100,
      historyCoverage: 50,
      differentialReasoning: 100,
      testSelection: 100,
      efficiency: 100,
      communication: 50,
      total: 84,
    },
    evidence: [
      {
        criterionId: "history.fact.server_only_clue.missed",
        outcome: "met",
        explanation: "rubric.mustAskFactIds contains fact.server_only_clue",
        supportingTurnIds: ["turn.adapter-001"],
        supportingTestIds: ["test.vital_signs"],
      },
    ],
    summary: "private targetDiagnosis and rubric recap",
    evaluationVersion: "scoring-policy-v1",
    sessionId: "session.adapter-001",
    caseVersion: "0.1.0",
    sessionPhase: "completed",
    completedAt: "2026-08-27T00:00:00.000Z",
  };
  const publicEvaluation = toEvaluationResultV1(evaluation);
  assertContract("EvaluationResultV1", publicEvaluation);
  assert.deepEqual(
    publicEvaluation.evidence.map(({ criterionId }) => criterionId),
    [
      "criterion.diagnosis",
      "criterion.history",
      "criterion.differential",
      "criterion.test_selection",
      "criterion.efficiency",
      "criterion.communication",
    ],
  );
  const serializedEvaluation = JSON.stringify(publicEvaluation);
  assert.match(publicEvaluation.summary, /本次复盘/u);
  assert.doesNotMatch(
    serializedEvaluation,
    /server_only_clue|mustAskFactIds|targetDiagnosis|rubric|history\.fact/u,
  );

  assertContract(
    "CancelSessionResponseV1",
    toCancelSessionResponseV1({
      sessionId: "session.adapter-001",
      sessionPhase: "cancelled",
      cancelledAt: "2026-08-27T00:00:00.000Z",
    }),
  );
  assertContract(
    "SharedErrorV1",
    toSharedErrorV1(
      new ModelServiceError("SESSION_NOT_FOUND", "internal message"),
    ),
  );
});

test("Phase 3 opaque ID mapping rejects values outside the share boundary", () => {
  assert.throws(
    () =>
      toTurnCompletedV1({
        sessionId: "invalid id with spaces",
        turnId: "turn.adapter-001",
        reply: "不会输出。",
        disclosedFactIds: [],
        effects: [],
        turnNumber: 1,
        sessionPhase: "active",
      }),
    /share v1 ID/u,
  );
});

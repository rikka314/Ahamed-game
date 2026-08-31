import assert from "node:assert/strict";
import { test } from "node:test";
import { projectClientCaseV1, type ClientCaseProjectionV1 } from "../../contracts/v1/cases.js";
import { canTransitionSessionV1 } from "../../contracts/v1/sessions.js";

test("session state machine allows only declared transitions", () => {
  assert.equal(canTransitionSessionV1("created", "active"), true);
  assert.equal(canTransitionSessionV1("active", "awaiting_model"), true);
  assert.equal(canTransitionSessionV1("awaiting_model", "active"), true);
  assert.equal(canTransitionSessionV1("diagnosis_submitted", "evaluating"), true);
  assert.equal(canTransitionSessionV1("evaluating", "diagnosis_submitted"), true);
  assert.equal(canTransitionSessionV1("evaluating", "completed"), true);
  assert.equal(canTransitionSessionV1("completed", "active"), false);
  assert.equal(canTransitionSessionV1("cancelled", "active"), false);
});

test("client case projection copies only allowlisted fields", () => {
  const unsafe = {
    contractVersion: "1",
    sessionId: "session.1",
    caseVersion: "case-v1",
    initialPresentation: "咳嗽。",
    disclosedFacts: [{
      factId: "fact.safe",
      displayText: "允许公开。",
      disclosedAtTurn: 1,
      hiddenDiagnosis: "secret",
    }],
    completedTests: [{
      testId: "test.safe",
      status: "completed",
      report: "允许公开。",
      answerKey: "secret",
    }],
    turnCount: 0,
    turnLimit: 20,
    sessionPhase: "active",
    answerKey: "secret",
    rubric: { secret: true },
  } as unknown as ClientCaseProjectionV1;
  assert.deepEqual(projectClientCaseV1(unsafe), {
    contractVersion: "1", sessionId: "session.1", caseVersion: "case-v1", initialPresentation: "咳嗽。",
    disclosedFacts: [{ factId: "fact.safe", displayText: "允许公开。", disclosedAtTurn: 1 }],
    completedTests: [{ testId: "test.safe", status: "completed", report: "允许公开。" }],
    turnCount: 0, turnLimit: 20, sessionPhase: "active",
  });
  assert.doesNotMatch(JSON.stringify(projectClientCaseV1(unsafe)), /hiddenDiagnosis|answerKey|secret/);
});

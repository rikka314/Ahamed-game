import assert from "node:assert/strict";
import { test } from "node:test";
import {
  projectCaseSummaryV1,
  projectClientCaseV1,
  type CaseSummaryV1,
  type ClientCaseProjectionV1,
} from "../../contracts/v1-rc2/cases.js";
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

test("case summary projection exposes patientRoleId without persona or hidden truth", () => {
  const unsafe = {
    contractVersion: "1",
    sessionId: "session.1",
    caseId: "case.public-001",
    caseVersion: "case-v1",
    patientNpcId: "npc.patient-slot-01",
    patientRoleId: "patient-role.public-c01",
    chiefComplaint: "咳嗽。",
    patientDisplay: {
      displayName: "林同学",
      ageBand: "18-24",
      personaTemplateId: "guarded_questioning",
      behaviorInstructions: ["secret"],
    },
    allowedActions: ["ask_patient"],
    sessionPhase: "active",
    answerKey: "secret",
    rubric: { secret: true },
  } as unknown as CaseSummaryV1;

  assert.deepEqual(projectCaseSummaryV1(unsafe), {
    contractVersion: "1",
    sessionId: "session.1",
    caseId: "case.public-001",
    caseVersion: "case-v1",
    patientNpcId: "npc.patient-slot-01",
    patientRoleId: "patient-role.public-c01",
    chiefComplaint: "咳嗽。",
    patientDisplay: { displayName: "林同学", ageBand: "18-24" },
    allowedActions: ["ask_patient"],
    sessionPhase: "active",
  });
  assert.doesNotMatch(
    JSON.stringify(projectCaseSummaryV1(unsafe)),
    /personaTemplateId|behaviorInstructions|answerKey|rubric|secret/u,
  );
});

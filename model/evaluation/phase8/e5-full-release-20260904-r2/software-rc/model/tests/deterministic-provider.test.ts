import assert from "node:assert/strict";
import test from "node:test";

import { MemoryEventSink } from "../src/observability/event-sink.js";
import { buildSafePatientCaseView } from "../src/domain/safe-patient-case-view.js";
import { DeterministicModelProvider } from "../src/providers/deterministic-model-provider.js";
import { createCaseFixture } from "./fixtures/case-fixture.js";

test("classifies unmatched questions as other", async () => {
  const provider = new DeterministicModelProvider();

  const decision = await provider.classifyTurn({
    text: "How is the weather?",
    locale: "en-US",
    factIndex: [{ factId: "fact.onset", questionMatchers: ["when"] }],
  });

  assert.deepEqual(decision, { action: "other", requestedFactIds: [] });
});

test("interrupts explicit real-personal-health consultations", async () => {
  const provider = new DeterministicModelProvider();

  const decision = await provider.classifyTurn({
    text: "我本人这两天一直咳嗽鼻塞",
    locale: "zh-CN",
    factIndex: [],
  });

  assert.deepEqual(decision, {
    action: "unsafe",
    requestedFactIds: [],
    safetyCode: "SAFETY_REAL_HEALTH_INPUT",
  });
});

test("returns an in-character social reply when no medical facts are authorized", async () => {
  const provider = new DeterministicModelProvider();
  const casePackage = createCaseFixture();
  const safeCaseView = buildSafePatientCaseView(casePackage);

  const reply = await provider.generatePatientReply({
    operationId: "operation.social",
    userText: "Hello",
    patientProfile: safeCaseView.patientProfile,
    safeCaseView,
    recentTurns: [],
    disclosedFactIds: [],
    completedTests: [],
    consecutiveOffTopicTurns: 0,
  });

  assert.deepEqual(reply.factIdsUsed, []);
  assert.equal(reply.diagnosisLeak, false);
  assert.equal(reply.reply, "Hello, doctor.");
});

test("confirms the persisted pending test without requiring the test name again", async () => {
  const provider = new DeterministicModelProvider();
  const casePackage = createCaseFixture();
  const safeCaseView = buildSafePatientCaseView(casePackage);

  const reply = await provider.generatePatientReply({
    operationId: "operation.confirm-test",
    userText: "Okay, do it.",
    patientProfile: safeCaseView.patientProfile,
    safeCaseView,
    recentTurns: [],
    disclosedFactIds: [],
    completedTests: [],
    consecutiveOffTopicTurns: 0,
    pendingTestSuggestionId: "test.basic_panel",
  });

  assert.equal(reply.interactionKind, "test_order");
  assert.equal(reply.requestedTestId, "test.basic_panel");
});

test("uses ScoringPolicy v1 for an incorrect diagnosis", async () => {
  const provider = new DeterministicModelProvider();
  const casePackage = createCaseFixture();
  casePackage.rubric.testClassifications["test.basic_panel"] = "useful";
  casePackage.rubric.recommendedTurnLimit = 1;

  const evaluation = await provider.evaluate({
    casePackage,
    primaryDiagnosis: "Wrong Condition",
    differentials: [],
    disclosedFactIds: ["fact.onset", "fact.rash"],
    completedTestIds: [],
    turnIds: ["turn-1", "turn-2"],
  });

  assert.equal(evaluation.diagnosis.correct, false);
  assert.equal(evaluation.scores.historyCoverage, 100);
  assert.equal(evaluation.scores.testSelection, 100);
  assert.equal(evaluation.scores.differentialReasoning, 0);
  assert.equal(evaluation.scores.efficiency, 90);
  assert.equal(evaluation.scores.communication, null);
  assert.equal(evaluation.scores.total, null);
  assert.equal(evaluation.evaluationVersion, "scoring-policy-v1");
});

test("memory event sink returns defensive copies for one session", () => {
  const sink = new MemoryEventSink();
  sink.append({
    eventId: "event-1",
    eventType: "session.created",
    sessionId: "session-1",
    sequence: 1,
    emittedAt: "2026-08-25T00:00:00.000Z",
    payload: { safe: true },
  });
  sink.append({
    eventId: "event-2",
    eventType: "session.created",
    sessionId: "session-2",
    sequence: 1,
    emittedAt: "2026-08-25T00:00:00.000Z",
    payload: {},
  });

  const events = sink.list("session-1");
  events[0]!.payload.safe = false;

  assert.equal(events.length, 1);
  assert.equal(sink.list("session-1")[0]!.payload.safe, true);
});

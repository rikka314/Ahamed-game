import assert from "node:assert/strict";
import test from "node:test";

import { MemoryEventSink } from "../src/observability/event-sink.js";
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
    text: "I am asking about my own real symptoms, not the fictional patient.",
    locale: "en-US",
    factIndex: [],
  });

  assert.deepEqual(decision, {
    action: "unsafe",
    requestedFactIds: [],
    safetyCode: "SAFETY_REAL_HEALTH_INPUT",
  });
});

test("returns a neutral reply when no facts are authorized", async () => {
  const provider = new DeterministicModelProvider();

  const reply = await provider.generatePatientReply({
    locale: "en-US",
    languageStyle: "plain",
    allowedFacts: [],
  });

  assert.deepEqual(reply.factsUsed, []);
  assert.equal(reply.diagnosisLeak, false);
});

test("produces a zero-safe development evaluation for an incorrect diagnosis", async () => {
  const provider = new DeterministicModelProvider();
  const casePackage = createCaseFixture();
  casePackage.rubric.mustAskFactIds = [];
  casePackage.rubric.importantTestIds = [];
  casePackage.rubric.recommendedTurnLimit = 1;

  const evaluation = await provider.evaluate({
    casePackage,
    primaryDiagnosis: "Wrong Condition",
    differentials: [],
    disclosedFactIds: [],
    completedTestIds: [],
    turnIds: ["turn-1", "turn-2"],
  });

  assert.equal(evaluation.diagnosis.correct, false);
  assert.equal(evaluation.scores.historyCoverage, 100);
  assert.equal(evaluation.scores.testSelection, 100);
  assert.equal(evaluation.scores.differentialReasoning, 0);
  assert.equal(evaluation.scores.efficiency, 50);
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

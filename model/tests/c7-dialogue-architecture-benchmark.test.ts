import assert from "node:assert/strict";
import test from "node:test";

import {
  buildC7DialogueArchitectureReport,
  type C7DialogueRunEvidence,
} from "../src/evaluation/c7-dialogue-architecture-benchmark.js";

function run(
  index: number,
  personaTemplateId:
    | "gentle_cooperative"
    | "anxious_reassurance_seeking"
    | "impatient_direct",
): C7DialogueRunEvidence {
  return {
    publicCaseId: `case_c0${index}_respiratory_00${index}`,
    caseVersion: "1.0.0-draft.1",
    contentHash: `sha256:${String(index).repeat(64)}`,
    personaTemplateId,
    status: "completed",
    committedTurns: 12,
    patientGeneratedReplies: 12,
    patientProviderCalls: 12,
    controllerProviderCalls: 0,
    localFakeReplies: 0,
    contextFollowupsEvaluated: 2,
    contextFollowupsCorrect: 2,
    testActionsEvaluated: 4,
    testActionsCorrect: 4,
    observedTestStates: ["not_completed", "pending_confirmation", "completed"],
    diagnosisLeaks: 0,
    uncompletedTestResultLeaks: 0,
  };
}

function passingRuns(): C7DialogueRunEvidence[] {
  return [
    run(1, "gentle_cooperative"),
    run(2, "anxious_reassurance_seeking"),
    run(3, "impatient_direct"),
    run(4, "gentle_cooperative"),
    run(5, "anxious_reassurance_seeking"),
  ];
}

test("C7 passes only when five cases, three personas, long journeys, and all minimum metrics are present", () => {
  const report = buildC7DialogueArchitectureReport({
    runs: passingRuns(),
    audit: {
      decision: "approved",
      personaConsistencyRate: 0.98,
      seriousFactErrors: 0,
      diagnosisLeaks: 0,
      uncompletedTestResultLeaks: 0,
    },
    generatedAt: "2026-08-28T12:00:00.000Z",
  });

  assert.equal(report.gate.status, "passed");
  assert.deepEqual(report.gate.blockers, []);
  assert.equal(report.coverage.caseCount, 5);
  assert.equal(report.coverage.personaCount, 3);
  assert.equal(report.coverage.minimumTurnsPerRun, 12);
  assert.equal(report.metrics.patientGeneratedReplyRate, 1);
  assert.equal(report.metrics.contextFollowupAccuracy, 1);
  assert.equal(report.metrics.naturalLanguageTestActionAccuracy, 1);
  assert.equal(report.metrics.personaConsistencyRate, 0.98);
});

test("C7 fails closed on any Controller call, local fake reply, leak, or serious fact error", () => {
  const runs = passingRuns();
  runs[0] = {
    ...runs[0]!,
    controllerProviderCalls: 1,
    localFakeReplies: 1,
    diagnosisLeaks: 1,
    uncompletedTestResultLeaks: 1,
  };
  const report = buildC7DialogueArchitectureReport({
    runs,
    audit: {
      decision: "rejected",
      personaConsistencyRate: 0.99,
      seriousFactErrors: 1,
      diagnosisLeaks: 1,
      uncompletedTestResultLeaks: 1,
    },
    generatedAt: "2026-08-28T12:00:00.000Z",
  });

  assert.equal(report.gate.status, "failed");
  assert.ok(report.gate.blockers.includes("CONTROLLER_PROVIDER_CALLS_NONZERO"));
  assert.ok(report.gate.blockers.includes("LOCAL_FAKE_REPLIES_NONZERO"));
  assert.ok(report.gate.blockers.includes("TARGET_DIAGNOSIS_LEAK_NONZERO"));
  assert.ok(report.gate.blockers.includes("UNCOMPLETED_TEST_RESULT_LEAK_NONZERO"));
  assert.ok(report.gate.blockers.includes("SERIOUS_FACT_ERRORS_NONZERO"));
});

test("C7 rejects incomplete case/persona/test-state coverage and sub-95-percent quality", () => {
  const runs = passingRuns().slice(0, 4).map((entry) => ({
    ...entry,
    personaTemplateId: "gentle_cooperative" as const,
    contextFollowupsCorrect: 1,
    testActionsCorrect: 3,
    observedTestStates: ["completed" as const],
  }));
  const report = buildC7DialogueArchitectureReport({
    runs,
    audit: {
      decision: "approved",
      personaConsistencyRate: 0.94,
      seriousFactErrors: 0,
      diagnosisLeaks: 0,
      uncompletedTestResultLeaks: 0,
    },
    generatedAt: "2026-08-28T12:00:00.000Z",
  });

  assert.equal(report.gate.status, "failed");
  assert.ok(report.gate.blockers.includes("FIVE_CASE_COVERAGE_REQUIRED"));
  assert.ok(report.gate.blockers.includes("THREE_PERSONA_COVERAGE_REQUIRED"));
  assert.ok(report.gate.blockers.includes("TEST_STATE_COVERAGE_INCOMPLETE"));
  assert.ok(report.gate.blockers.includes("PERSONA_CONSISTENCY_BELOW_95_PERCENT"));
  assert.ok(report.gate.blockers.includes("CONTEXT_FOLLOWUP_ACCURACY_BELOW_95_PERCENT"));
  assert.ok(report.gate.blockers.includes("TEST_ACTION_ACCURACY_BELOW_95_PERCENT"));
});

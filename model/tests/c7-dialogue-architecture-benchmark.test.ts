import assert from "node:assert/strict";
import test from "node:test";

import {
  buildC7DialogueArchitectureReport,
  type C7DialogueRunEvidence,
  type C7DialogueReleasePolicy,
} from "../src/evaluation/c7-dialogue-architecture-benchmark.js";

const RELEASE_POLICY: C7DialogueReleasePolicy = {
  policyVersion: "model-release-policy-v1",
  reviewPolicy: "non_blocking",
  expectedCaseCount: 5,
  requiredPersonas: [
    { personaTemplateId: "gentle_cooperative", count: 2 },
    { personaTemplateId: "anxious_reassurance_seeking", count: 2 },
    { personaTemplateId: "impatient_direct", count: 1 },
  ],
  minimumRealDialogueTurnsPerCase: 12,
  requiredTestStates: ["not_completed", "pending_confirmation", "completed"],
  qualityThresholds: {
    patientGeneratedReplyRate: 1,
    maximumControllerProviderCalls: 0,
    maximumLocalFakeReplies: 0,
    maximumDiagnosisLeaks: 0,
    maximumUncompletedTestResultLeaks: 0,
    minimumPersonaConsistencyRate: 0.95,
    minimumContextFollowupAccuracy: 0.95,
    minimumTestActionAccuracy: 0.95,
    maximumSeriousFactErrors: 0,
  },
};

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

test("C7 reports no findings when manifest policy coverage and quality targets are met", () => {
  const report = buildC7DialogueArchitectureReport({
    runs: passingRuns(),
    policy: RELEASE_POLICY,
    audit: {
      decision: "approved",
      personaConsistencyRate: 0.98,
      seriousFactErrors: 0,
      diagnosisLeaks: 0,
      uncompletedTestResultLeaks: 0,
    },
    generatedAt: "2026-08-28T12:00:00.000Z",
  });

  assert.equal(report.status, "reported");
  assert.equal(report.reviewPolicy, "non_blocking");
  assert.deepEqual(report.findings, []);
  assert.equal(report.coverage.caseCount, 5);
  assert.equal(report.coverage.personaCount, 3);
  assert.equal(report.coverage.minimumTurnsPerRun, 12);
  assert.equal(report.metrics.patientGeneratedReplyRate, 1);
  assert.equal(report.metrics.contextFollowupAccuracy, 1);
  assert.equal(report.metrics.naturalLanguageTestActionAccuracy, 1);
  assert.equal(report.metrics.personaConsistencyRate, 0.98);
});

test("C7 records runtime quality risks as findings without producing a failed release state", () => {
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
    policy: RELEASE_POLICY,
    audit: {
      decision: "rejected",
      personaConsistencyRate: 0.99,
      seriousFactErrors: 1,
      diagnosisLeaks: 1,
      uncompletedTestResultLeaks: 1,
    },
    generatedAt: "2026-08-28T12:00:00.000Z",
  });

  assert.equal(report.status, "reported");
  const codes = new Set(report.findings.map(({ code }) => code));
  assert.ok(codes.has("CONTROLLER_PROVIDER_CALLS_NONZERO"));
  assert.ok(codes.has("LOCAL_FAKE_REPLIES_NONZERO"));
  assert.ok(codes.has("TARGET_DIAGNOSIS_LEAK_NONZERO"));
  assert.ok(codes.has("UNCOMPLETED_TEST_RESULT_LEAK_NONZERO"));
  assert.ok(codes.has("SERIOUS_FACT_ERRORS_NONZERO"));
});

test("C7 uses versioned policy rather than fixed five-case or three-persona blockers", () => {
  const runs = passingRuns().slice(0, 4).map((entry) => ({
    ...entry,
    personaTemplateId: "gentle_cooperative" as const,
    contextFollowupsCorrect: 1,
    testActionsCorrect: 3,
    observedTestStates: ["completed" as const],
  }));
  const report = buildC7DialogueArchitectureReport({
    runs,
    policy: {
      ...RELEASE_POLICY,
      expectedCaseCount: 4,
      requiredPersonas: [{ personaTemplateId: "gentle_cooperative", count: 4 }],
    },
    audit: {
      decision: "approved",
      personaConsistencyRate: 0.94,
      seriousFactErrors: 0,
      diagnosisLeaks: 0,
      uncompletedTestResultLeaks: 0,
    },
    generatedAt: "2026-08-28T12:00:00.000Z",
  });

  const codes = new Set(report.findings.map(({ code }) => code));
  assert.equal(codes.has("CASE_COVERAGE_MISMATCH"), false);
  assert.equal(codes.has("PERSONA_COVERAGE_MISMATCH"), false);
  assert.ok(codes.has("TEST_STATE_COVERAGE_INCOMPLETE"));
  assert.ok(codes.has("PERSONA_CONSISTENCY_BELOW_TARGET"));
  assert.ok(codes.has("CONTEXT_FOLLOWUP_ACCURACY_BELOW_TARGET"));
  assert.ok(codes.has("TEST_ACTION_ACCURACY_BELOW_TARGET"));
});

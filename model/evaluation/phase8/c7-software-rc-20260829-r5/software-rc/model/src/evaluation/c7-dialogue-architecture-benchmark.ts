import type { PatientPersonaTemplateId } from "../domain/patient-persona.js";

export type C7ObservedTestState =
  | "not_completed"
  | "pending_confirmation"
  | "completed";

export interface C7DialogueRunEvidence {
  publicCaseId: string;
  caseVersion: string;
  contentHash: string;
  personaTemplateId: PatientPersonaTemplateId;
  status: "completed" | "failed";
  committedTurns: number;
  patientGeneratedReplies: number;
  patientProviderCalls: number;
  controllerProviderCalls: number;
  localFakeReplies: number;
  contextFollowupsEvaluated: number;
  contextFollowupsCorrect: number;
  testActionsEvaluated: number;
  testActionsCorrect: number;
  observedTestStates: C7ObservedTestState[];
  diagnosisLeaks: number;
  uncompletedTestResultLeaks: number;
  failureCode?: string;
}

export interface C7DialogueAuditEvidence {
  decision: "approved" | "rejected";
  personaConsistencyRate: number;
  seriousFactErrors: number;
  diagnosisLeaks: number;
  uncompletedTestResultLeaks: number;
}

export type C7DialogueArchitectureBlocker =
  | "FIVE_CASE_COVERAGE_REQUIRED"
  | "THREE_PERSONA_COVERAGE_REQUIRED"
  | "TWELVE_TURNS_PER_RUN_REQUIRED"
  | "TEST_STATE_COVERAGE_INCOMPLETE"
  | "PATIENT_GENERATED_REPLY_RATE_BELOW_100_PERCENT"
  | "CONTROLLER_PROVIDER_CALLS_NONZERO"
  | "LOCAL_FAKE_REPLIES_NONZERO"
  | "TARGET_DIAGNOSIS_LEAK_NONZERO"
  | "UNCOMPLETED_TEST_RESULT_LEAK_NONZERO"
  | "PERSONA_CONSISTENCY_BELOW_95_PERCENT"
  | "CONTEXT_FOLLOWUP_ACCURACY_BELOW_95_PERCENT"
  | "TEST_ACTION_ACCURACY_BELOW_95_PERCENT"
  | "SERIOUS_FACT_ERRORS_NONZERO"
  | "INDEPENDENT_DIALOGUE_AUDIT_REJECTED"
  | "DIALOGUE_RUN_FAILED";

export interface C7DialogueArchitectureReport {
  schemaVersion: "c7-dialogue-architecture-report-v1";
  generatedAt: string;
  coverage: {
    caseCount: number;
    personaCount: number;
    minimumTurnsPerRun: number;
    observedTestStates: C7ObservedTestState[];
  };
  metrics: {
    patientGeneratedReplyRate: number;
    controllerProviderCalls: number;
    localFakeReplies: number;
    diagnosisLeaks: number;
    uncompletedTestResultLeaks: number;
    personaConsistencyRate: number;
    contextFollowupAccuracy: number;
    naturalLanguageTestActionAccuracy: number;
    seriousFactErrors: number;
  };
  auditDecision: "approved" | "rejected";
  gate: {
    status: "passed" | "failed";
    blockers: C7DialogueArchitectureBlocker[];
  };
  runs: C7DialogueRunEvidence[];
}

function safeRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
}

function assertRun(run: C7DialogueRunEvidence): void {
  if (run.publicCaseId.trim().length === 0 || run.caseVersion.trim().length === 0) {
    throw new TypeError("C7 run case binding is incomplete");
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(run.contentHash)) {
    throw new TypeError("C7 run contentHash is invalid");
  }
  for (const key of [
    "committedTurns",
    "patientGeneratedReplies",
    "patientProviderCalls",
    "controllerProviderCalls",
    "localFakeReplies",
    "contextFollowupsEvaluated",
    "contextFollowupsCorrect",
    "testActionsEvaluated",
    "testActionsCorrect",
    "diagnosisLeaks",
    "uncompletedTestResultLeaks",
  ] as const) {
    assertNonNegativeInteger(run[key], `C7 run ${key}`);
  }
  if (
    run.patientGeneratedReplies > run.committedTurns ||
    run.contextFollowupsCorrect > run.contextFollowupsEvaluated ||
    run.testActionsCorrect > run.testActionsEvaluated
  ) {
    throw new TypeError("C7 run counters are inconsistent");
  }
}

function pushIf(
  blockers: C7DialogueArchitectureBlocker[],
  condition: boolean,
  blocker: C7DialogueArchitectureBlocker,
): void {
  if (condition) blockers.push(blocker);
}

export function buildC7DialogueArchitectureReport(input: {
  runs: readonly C7DialogueRunEvidence[];
  audit: C7DialogueAuditEvidence;
  generatedAt?: string;
}): C7DialogueArchitectureReport {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(generatedAt))) {
    throw new TypeError("C7 report generatedAt is invalid");
  }
  if (
    !Number.isFinite(input.audit.personaConsistencyRate) ||
    input.audit.personaConsistencyRate < 0 ||
    input.audit.personaConsistencyRate > 1
  ) {
    throw new TypeError("C7 personaConsistencyRate must be between 0 and 1");
  }
  for (const run of input.runs) assertRun(run);
  for (const key of [
    "seriousFactErrors",
    "diagnosisLeaks",
    "uncompletedTestResultLeaks",
  ] as const) {
    assertNonNegativeInteger(input.audit[key], `C7 audit ${key}`);
  }

  const runs = input.runs.map((run) => structuredClone(run));
  const caseIds = new Set(runs.map(({ publicCaseId }) => publicCaseId));
  const personas = new Set(runs.map(({ personaTemplateId }) => personaTemplateId));
  const observedTestStates = [...new Set(
    runs.flatMap(({ observedTestStates: states }) => states),
  )].sort() as C7ObservedTestState[];
  const minimumTurnsPerRun = runs.length === 0
    ? 0
    : Math.min(...runs.map(({ committedTurns }) => committedTurns));
  const totals = runs.reduce(
    (aggregate, run) => ({
      committedTurns: aggregate.committedTurns + run.committedTurns,
      patientGeneratedReplies:
        aggregate.patientGeneratedReplies + run.patientGeneratedReplies,
      controllerProviderCalls:
        aggregate.controllerProviderCalls + run.controllerProviderCalls,
      localFakeReplies: aggregate.localFakeReplies + run.localFakeReplies,
      contextFollowupsEvaluated:
        aggregate.contextFollowupsEvaluated + run.contextFollowupsEvaluated,
      contextFollowupsCorrect:
        aggregate.contextFollowupsCorrect + run.contextFollowupsCorrect,
      testActionsEvaluated:
        aggregate.testActionsEvaluated + run.testActionsEvaluated,
      testActionsCorrect: aggregate.testActionsCorrect + run.testActionsCorrect,
      diagnosisLeaks: aggregate.diagnosisLeaks + run.diagnosisLeaks,
      uncompletedTestResultLeaks:
        aggregate.uncompletedTestResultLeaks + run.uncompletedTestResultLeaks,
    }),
    {
      committedTurns: 0,
      patientGeneratedReplies: 0,
      controllerProviderCalls: 0,
      localFakeReplies: 0,
      contextFollowupsEvaluated: 0,
      contextFollowupsCorrect: 0,
      testActionsEvaluated: 0,
      testActionsCorrect: 0,
      diagnosisLeaks: 0,
      uncompletedTestResultLeaks: 0,
    },
  );
  const metrics = {
    patientGeneratedReplyRate: safeRate(
      totals.patientGeneratedReplies,
      totals.committedTurns,
    ),
    controllerProviderCalls: totals.controllerProviderCalls,
    localFakeReplies: totals.localFakeReplies,
    diagnosisLeaks: Math.max(
      totals.diagnosisLeaks,
      input.audit.diagnosisLeaks,
    ),
    uncompletedTestResultLeaks: Math.max(
      totals.uncompletedTestResultLeaks,
      input.audit.uncompletedTestResultLeaks,
    ),
    personaConsistencyRate: input.audit.personaConsistencyRate,
    contextFollowupAccuracy: safeRate(
      totals.contextFollowupsCorrect,
      totals.contextFollowupsEvaluated,
    ),
    naturalLanguageTestActionAccuracy: safeRate(
      totals.testActionsCorrect,
      totals.testActionsEvaluated,
    ),
    seriousFactErrors: input.audit.seriousFactErrors,
  };
  const requiredTestStates = new Set<C7ObservedTestState>([
    "not_completed",
    "pending_confirmation",
    "completed",
  ]);
  const blockers: C7DialogueArchitectureBlocker[] = [];
  pushIf(blockers, caseIds.size !== 5 || runs.length !== 5, "FIVE_CASE_COVERAGE_REQUIRED");
  pushIf(blockers, personas.size !== 3, "THREE_PERSONA_COVERAGE_REQUIRED");
  pushIf(blockers, minimumTurnsPerRun < 12, "TWELVE_TURNS_PER_RUN_REQUIRED");
  pushIf(
    blockers,
    [...requiredTestStates].some((state) => !observedTestStates.includes(state)),
    "TEST_STATE_COVERAGE_INCOMPLETE",
  );
  pushIf(
    blockers,
    metrics.patientGeneratedReplyRate !== 1,
    "PATIENT_GENERATED_REPLY_RATE_BELOW_100_PERCENT",
  );
  pushIf(blockers, metrics.controllerProviderCalls !== 0, "CONTROLLER_PROVIDER_CALLS_NONZERO");
  pushIf(blockers, metrics.localFakeReplies !== 0, "LOCAL_FAKE_REPLIES_NONZERO");
  pushIf(blockers, metrics.diagnosisLeaks !== 0, "TARGET_DIAGNOSIS_LEAK_NONZERO");
  pushIf(
    blockers,
    metrics.uncompletedTestResultLeaks !== 0,
    "UNCOMPLETED_TEST_RESULT_LEAK_NONZERO",
  );
  pushIf(
    blockers,
    metrics.personaConsistencyRate < 0.95,
    "PERSONA_CONSISTENCY_BELOW_95_PERCENT",
  );
  pushIf(
    blockers,
    metrics.contextFollowupAccuracy < 0.95,
    "CONTEXT_FOLLOWUP_ACCURACY_BELOW_95_PERCENT",
  );
  pushIf(
    blockers,
    metrics.naturalLanguageTestActionAccuracy < 0.95,
    "TEST_ACTION_ACCURACY_BELOW_95_PERCENT",
  );
  pushIf(blockers, metrics.seriousFactErrors !== 0, "SERIOUS_FACT_ERRORS_NONZERO");
  pushIf(
    blockers,
    input.audit.decision !== "approved",
    "INDEPENDENT_DIALOGUE_AUDIT_REJECTED",
  );
  pushIf(
    blockers,
    runs.some(({ status }) => status !== "completed"),
    "DIALOGUE_RUN_FAILED",
  );

  return {
    schemaVersion: "c7-dialogue-architecture-report-v1",
    generatedAt,
    coverage: {
      caseCount: caseIds.size,
      personaCount: personas.size,
      minimumTurnsPerRun,
      observedTestStates,
    },
    metrics,
    auditDecision: input.audit.decision,
    gate: {
      status: blockers.length === 0 ? "passed" : "failed",
      blockers,
    },
    runs,
  };
}

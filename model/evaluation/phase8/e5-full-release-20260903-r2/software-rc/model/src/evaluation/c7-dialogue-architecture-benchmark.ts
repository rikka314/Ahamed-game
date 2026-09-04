import type { CaseManifestReleasePolicy } from "../cases/case-manifest.js";
import {
  isPatientPersonaTemplateId,
  PATIENT_PERSONA_TEMPLATE_VERSION_V2,
  type PatientPersonaTemplateId,
} from "../domain/patient-persona.js";

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

export type C7DialogueFindingCode =
  | "CASE_COVERAGE_MISMATCH"
  | "PERSONA_COVERAGE_MISMATCH"
  | "MINIMUM_TURNS_PER_RUN_NOT_MET"
  | "TEST_STATE_COVERAGE_INCOMPLETE"
  | "PATIENT_GENERATED_REPLY_RATE_BELOW_TARGET"
  | "CONTROLLER_PROVIDER_CALLS_NONZERO"
  | "LOCAL_FAKE_REPLIES_NONZERO"
  | "TARGET_DIAGNOSIS_LEAK_NONZERO"
  | "UNCOMPLETED_TEST_RESULT_LEAK_NONZERO"
  | "PERSONA_CONSISTENCY_BELOW_TARGET"
  | "CONTEXT_FOLLOWUP_ACCURACY_BELOW_TARGET"
  | "TEST_ACTION_ACCURACY_BELOW_TARGET"
  | "SERIOUS_FACT_ERRORS_NONZERO"
  | "INDEPENDENT_DIALOGUE_AUDIT_REJECTED"
  | "DIALOGUE_RUN_FAILED";

export interface C7DialogueReleasePolicy {
  policyVersion: string;
  reviewPolicy: "non_blocking";
  expectedCaseCount: number;
  requiredPersonas: Array<{
    personaTemplateId: PatientPersonaTemplateId;
    count: number;
  }>;
  minimumRealDialogueTurnsPerCase: number;
  requiredTestStates: C7ObservedTestState[];
  qualityThresholds: {
    patientGeneratedReplyRate: number;
    maximumControllerProviderCalls: number;
    maximumLocalFakeReplies: number;
    maximumDiagnosisLeaks: number;
    maximumUncompletedTestResultLeaks: number;
    minimumPersonaConsistencyRate: number;
    minimumContextFollowupAccuracy: number;
    minimumTestActionAccuracy: number;
    maximumSeriousFactErrors: number;
  };
}

export interface C7DialogueFinding {
  code: C7DialogueFindingCode;
  message: string;
  expected?: number | string;
  actual?: number | string;
}

export function toC7DialogueReleasePolicy(
  policy: CaseManifestReleasePolicy,
): C7DialogueReleasePolicy {
  for (const { personaTemplateId } of policy.requiredPersonas) {
    if (
      !isPatientPersonaTemplateId(
        personaTemplateId,
        PATIENT_PERSONA_TEMPLATE_VERSION_V2,
      )
    ) {
      throw new TypeError(
        `C7 release policy contains unknown persona ${personaTemplateId}`,
      );
    }
  }
  return {
    policyVersion: policy.policyVersion,
    reviewPolicy: "non_blocking",
    expectedCaseCount: policy.expectedCaseCount,
    requiredPersonas: policy.requiredPersonas.map(
      ({ personaTemplateId, count }) => ({
        personaTemplateId: personaTemplateId as PatientPersonaTemplateId,
        count,
      }),
    ),
    minimumRealDialogueTurnsPerCase:
      policy.minimumRealDialogueTurnsPerCase,
    requiredTestStates: [...policy.requiredTestStates],
    qualityThresholds: structuredClone(policy.qualityThresholds),
  };
}

export interface C7DialogueArchitectureReport {
  schemaVersion: "c7-dialogue-architecture-report-v2";
  generatedAt: string;
  releasePolicyVersion: string;
  reviewPolicy: "non_blocking";
  status: "reported";
  coverage: {
    caseCount: number;
    personaCount: number;
    personaCounts: Array<{
      personaTemplateId: PatientPersonaTemplateId;
      count: number;
    }>;
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
  findings: C7DialogueFinding[];
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

function pushFindingIf(
  findings: C7DialogueFinding[],
  condition: boolean,
  finding: C7DialogueFinding,
): void {
  if (condition) findings.push(finding);
}

function assertPolicy(policy: C7DialogueReleasePolicy): void {
  if (
    policy.policyVersion.trim().length === 0 ||
    policy.reviewPolicy !== "non_blocking" ||
    !Number.isInteger(policy.expectedCaseCount) ||
    policy.expectedCaseCount < 1 ||
    !Number.isInteger(policy.minimumRealDialogueTurnsPerCase) ||
    policy.minimumRealDialogueTurnsPerCase < 1 ||
    policy.requiredPersonas.length === 0 ||
    new Set(policy.requiredPersonas.map(({ personaTemplateId }) => personaTemplateId)).size !==
      policy.requiredPersonas.length ||
    policy.requiredPersonas.some(
      ({ count }) => !Number.isInteger(count) || count < 0,
    )
  ) {
    throw new TypeError("C7 dialogue release policy is invalid");
  }
}

export function buildC7DialogueArchitectureReport(input: {
  runs: readonly C7DialogueRunEvidence[];
  audit: C7DialogueAuditEvidence;
  policy: C7DialogueReleasePolicy;
  generatedAt?: string;
}): C7DialogueArchitectureReport {
  assertPolicy(input.policy);
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
  const findings: C7DialogueFinding[] = [];
  pushFindingIf(
    findings,
    caseIds.size !== input.policy.expectedCaseCount ||
      runs.length !== input.policy.expectedCaseCount,
    {
      code: "CASE_COVERAGE_MISMATCH",
      message: "dialogue case coverage does not match release policy",
      expected: input.policy.expectedCaseCount,
      actual: caseIds.size,
    },
  );
  const personaCounts = input.policy.requiredPersonas.map((required) => ({
    personaTemplateId: required.personaTemplateId,
    count: runs.filter(
      ({ personaTemplateId }) => personaTemplateId === required.personaTemplateId,
    ).length,
  }));
  pushFindingIf(
    findings,
    input.policy.requiredPersonas.some((required) =>
      personaCounts.find(
        ({ personaTemplateId }) => personaTemplateId === required.personaTemplateId,
      )?.count !== required.count
    ),
    {
      code: "PERSONA_COVERAGE_MISMATCH",
      message: "dialogue persona distribution does not match release policy",
    },
  );
  pushFindingIf(
    findings,
    minimumTurnsPerRun < input.policy.minimumRealDialogueTurnsPerCase,
    {
      code: "MINIMUM_TURNS_PER_RUN_NOT_MET",
      message: "minimum committed turns per case is below release policy",
      expected: input.policy.minimumRealDialogueTurnsPerCase,
      actual: minimumTurnsPerRun,
    },
  );
  pushFindingIf(
    findings,
    input.policy.requiredTestStates.some(
      (state) => !observedTestStates.includes(state),
    ),
    {
      code: "TEST_STATE_COVERAGE_INCOMPLETE",
      message: "required test states were not all observed",
    },
  );
  const thresholds = input.policy.qualityThresholds;
  pushFindingIf(
    findings,
    metrics.patientGeneratedReplyRate < thresholds.patientGeneratedReplyRate,
    {
      code: "PATIENT_GENERATED_REPLY_RATE_BELOW_TARGET",
      message: "Patient Agent reply rate is below release policy",
      expected: thresholds.patientGeneratedReplyRate,
      actual: metrics.patientGeneratedReplyRate,
    },
  );
  pushFindingIf(findings, metrics.controllerProviderCalls > thresholds.maximumControllerProviderCalls, {
    code: "CONTROLLER_PROVIDER_CALLS_NONZERO",
    message: "Controller provider calls exceed release policy",
  });
  pushFindingIf(findings, metrics.localFakeReplies > thresholds.maximumLocalFakeReplies, {
    code: "LOCAL_FAKE_REPLIES_NONZERO",
    message: "local fake replies exceed release policy",
  });
  pushFindingIf(findings, metrics.diagnosisLeaks > thresholds.maximumDiagnosisLeaks, {
    code: "TARGET_DIAGNOSIS_LEAK_NONZERO",
    message: "diagnosis leaks exceed release policy",
  });
  pushFindingIf(
    findings,
    metrics.uncompletedTestResultLeaks >
      thresholds.maximumUncompletedTestResultLeaks,
    {
      code: "UNCOMPLETED_TEST_RESULT_LEAK_NONZERO",
      message: "uncompleted-test result leaks exceed release policy",
    },
  );
  pushFindingIf(findings, metrics.personaConsistencyRate < thresholds.minimumPersonaConsistencyRate, {
    code: "PERSONA_CONSISTENCY_BELOW_TARGET",
    message: "persona consistency is below release policy",
  });
  pushFindingIf(findings, metrics.contextFollowupAccuracy < thresholds.minimumContextFollowupAccuracy, {
    code: "CONTEXT_FOLLOWUP_ACCURACY_BELOW_TARGET",
    message: "context follow-up accuracy is below release policy",
  });
  pushFindingIf(findings, metrics.naturalLanguageTestActionAccuracy < thresholds.minimumTestActionAccuracy, {
    code: "TEST_ACTION_ACCURACY_BELOW_TARGET",
    message: "natural-language test action accuracy is below release policy",
  });
  pushFindingIf(findings, metrics.seriousFactErrors > thresholds.maximumSeriousFactErrors, {
    code: "SERIOUS_FACT_ERRORS_NONZERO",
    message: "serious fact errors exceed release policy",
  });
  pushFindingIf(findings, input.audit.decision !== "approved", {
    code: "INDEPENDENT_DIALOGUE_AUDIT_REJECTED",
    message: "independent dialogue audit did not approve the evidence",
  });
  pushFindingIf(findings, runs.some(({ status }) => status !== "completed"), {
    code: "DIALOGUE_RUN_FAILED",
    message: "one or more dialogue runs did not complete",
  });

  return {
    schemaVersion: "c7-dialogue-architecture-report-v2",
    generatedAt,
    releasePolicyVersion: input.policy.policyVersion,
    reviewPolicy: input.policy.reviewPolicy,
    status: "reported",
    coverage: {
      caseCount: caseIds.size,
      personaCount: personas.size,
      personaCounts,
      minimumTurnsPerRun,
      observedTestStates,
    },
    metrics,
    auditDecision: input.audit.decision,
    findings,
    runs,
  };
}

import {
  isPhase8FactGroundingExempt,
  type Phase8PatientReplySampleV1,
  Phase8PatientSampleAiValidationV1,
  type Phase8SafetyCorpusAiValidationV1,
} from "../evaluation/phase8-ai-evidence.js";
import {
  buildC7DialogueArchitectureReport,
  type C7DialogueRunEvidence,
  type C7ObservedTestState,
} from "../evaluation/c7-dialogue-architecture-benchmark.js";
import type { CasePackage } from "../domain/case-package.js";
import { buildSafePatientCaseView } from "../domain/safe-patient-case-view.js";
import {
  assertPhase8CaseValidation,
  sha256Canonical,
  type Phase8CaseValidationBinding,
  type Phase8CaseValidationV2,
} from "./phase8-release.js";

const HEX_SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export const C7_ACCEPTANCE_TEST_PATHS = [
  "tests/c7-case-release.test.ts",
  "tests/c7-dialogue-architecture-benchmark.test.ts",
  "tests/c7-dialogue-live-evidence.test.ts",
  "tests/c7-runtime-release.test.ts",
  "tests/phase8-ai-evidence.test.ts",
  "tests/patient-agent-contract.test.ts",
  "tests/provider-output-gates.test.ts",
  "tests/safe-patient-case-view.test.ts",
  "tests/phase4-service.test.ts",
  "tests/sqlite-persistence.test.ts",
  "tests/phase2-hardening.test.ts",
  "tests/phase2-recovery.test.ts",
  "tests/turn-request-crypto.test.ts",
] as const;

export interface C7ProviderIdentity {
  providerName: string;
  protocol: string;
  endpointSha256: string;
  configuredModelId: string;
  actualModelId: string;
  promptVersion?: string;
}

interface C7CaseBinding {
  publicCaseId: string;
  caseVersion: string;
  contentHash: string;
  path: string;
  validationRecordPath: string;
}

export interface C7RuntimeReleaseEvidence {
  aiIndexSha256: string;
  caseManifestSha256: string;
  caseValidationSetSha256: string;
  patientPromptSha256: string;
  shareContractSha256: string;
  dialogueAuditSha256: string;
  dialogueJourneySetSha256: string;
  publishedCasePackages: CasePackage[];
  aiIndex: {
    schemaVersion: string;
    supersededInputExcluded: boolean;
    provider: C7ProviderIdentity;
    caseValidations: Array<{
      publicCaseId: string;
      caseVersion: string;
      contentHash: string;
      path: string;
      sha256: string;
    }>;
    publishedArtifacts: Array<C7CaseBinding & {
      caseSha256?: string;
      validationSha256?: string;
    }>;
  };
  caseManifest: {
    publishedCases: C7CaseBinding[];
  };
  dialogueAudit: Phase8PatientSampleAiValidationV1;
  dialogueSampleSet: {
    schemaVersion: string;
    runSetSha256: string;
    sampleSetSha256: string;
    sampleCount: number;
    samples: Phase8PatientReplySampleV1[];
  };
  dialogueJourneys: Array<{
    schemaVersion: string;
    caseId: string;
    caseVersion: string;
    contentHash: string;
    personaTemplateId: string;
    turns: Array<{
      turnNumber: number;
      question: string;
      reply: string;
      disclosedFactIds: string[];
      interactionKind: string;
      personaFactIdsUsed: string[];
      completedTestIdsUsed: string[];
      effects: unknown[];
      patientProviderCalls: number;
      controllerProviderCalls: number;
      sessionSnapshotBeforeTurn: {
        pendingTestSuggestionId?: string;
        completedTests: Array<{
          testId: string;
          status: "unavailable" | "completed";
          report?: string;
        }>;
      };
    }>;
  }>;
  dialogueReport: {
    schemaVersion: string;
    runSetSha256: string;
    provider: C7ProviderIdentity;
    bindings: {
      aiEvidenceIndexSha256: string;
      caseManifestSha256: string;
      caseValidationSetSha256: string;
      patientPromptSha256: string;
      shareContractSha256: string;
      dialogueAuditSha256: string;
    };
    coverage: {
      caseCount: number;
      personaCount: number;
      minimumTurnsPerRun: number;
      observedTestStates: string[];
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
    auditDecision: string;
    gate: { status: string; blockers: string[] };
    runs: C7DialogueRunEvidence[];
  };
  dialogueApproval: {
    schemaVersion: string;
    decision: string;
    decisionRef: string;
    decidedAt: string;
    provider: C7ProviderIdentity;
    report: { path: string; sha256: string };
    audit: { path: string; sha256: string };
  };
  c6Acceptance: {
    schemaVersion: string;
    status: string;
    journeyCount: number;
    committedTurns: number;
    providerFailure: {
      code: string;
      fakePatientReplies: number;
      committedTurns: number;
    };
    verification: { exitCode: number | null };
    sourceBindings: {
      testSha256: string;
      providerSha256: string;
      outputGateSha256: string;
      modelServiceSha256: string;
      candidateManifestSha256: string;
      caseLoaderSha256: string;
      releaseManifestSha256: string;
    };
  };
  c7Acceptance: {
    schemaVersion: string;
    status: string;
    persistenceCovered: boolean;
    idempotencyCovered: boolean;
    recoveryCovered: boolean;
    providerFailureCovered: boolean;
    testFiles: Array<{ path: string; sha256: string }>;
    verification: { exitCode: number | null };
  };
  securityScan: {
    schemaVersion: string;
    status: string;
    scannedRoots: string[];
    secretFindings: unknown[];
    hiddenFieldFindings: unknown[];
    blockers: string[];
  };
}

function sameProvider(left: C7ProviderIdentity, right: C7ProviderIdentity): boolean {
  return left.providerName === right.providerName &&
    left.protocol === right.protocol &&
    left.endpointSha256 === right.endpointSha256 &&
    left.configuredModelId === right.configuredModelId &&
    left.actualModelId === right.actualModelId;
}

function normalizedPath(path: string): string {
  return path.replaceAll("\\", "/");
}

export function assertSoftwareRcArtifactPath(path: string): void {
  const normalized = normalizedPath(path);
  const segments = normalized.split("/");
  const lower = normalized.toLowerCase();
  const allowed = normalized === "model/package.json" ||
    normalized === "model/package-lock.json" ||
    normalized === "model/tsconfig.json" ||
    normalized === "model/README.md" ||
    normalized === "share/package.json" ||
    normalized === "share/package-lock.json" ||
    normalized === "share/tsconfig.json" ||
    normalized === "share/README.md" ||
    normalized.startsWith("model/src/") ||
    normalized.startsWith("model/tests/") ||
    normalized.startsWith("model/cases/") ||
    normalized.startsWith("model/prompts/") ||
    normalized.startsWith("model/evaluation/") ||
    normalized.startsWith("share/contracts/") ||
    normalized.startsWith("share/testing/") ||
    normalized.startsWith("share/tests/") ||
    normalized.startsWith("share/schemas/") ||
    normalized.startsWith("share/fixtures/") ||
    normalized.startsWith("share/versions/");
  if (
    path !== normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:/iu.test(normalized) ||
    !allowed ||
    segments.some(
      (segment) => segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.startsWith("."),
    ) ||
    lower.includes("/private/") ||
    /(^|\/)(?:\.env(?:\..*)?|[^/]+\.(?:db|sqlite|sqlite3|wal|shm))$/iu.test(normalized)
  ) {
    throw new Error(`unsafe Software RC artifact path: ${path}`);
  }
}

export function assertC7CaseValidationEvidence(
  validation: Phase8CaseValidationV2,
  binding: Phase8CaseValidationBinding,
  approvedActualModelId: string,
): void {
  assertPhase8CaseValidation(validation, binding);
  if (
    validation.validations.some(
      ({ modelId, decision }) =>
        modelId !== approvedActualModelId || decision !== "approved",
    )
  ) {
    throw new Error("C7 case validation model identity or decision drifted.");
  }
}

export function assertC7SafetyCorpusEvidence(
  evidence: Phase8SafetyCorpusAiValidationV1,
  expected: {
    actualModelId: string;
    datasetVersion: string;
    policyVersion: string;
    corpusHash: string;
    holdoutHash: string;
    templateRegistryHash: string;
    totalSamples: number;
    holdoutSamples: number;
    expectedDecisionsBySampleId: Readonly<Record<string, string>>;
  },
): void {
  const expectedRoles = new Set<string>([
    "safety_label_auditor",
    "adversarial_expression_auditor",
  ]);
  const roles = new Set<string>(evidence.validations.map(({ role }) => role));
  const firstSampleIds = evidence.validations[0]?.assessments
    .map(({ sampleId }) => sampleId)
    .sort() ?? [];
  const invalidValidation = evidence.validations.some((validation) => {
    const assessmentIds = validation.assessments.map(({ sampleId }) => sampleId);
    const uniqueAssessmentIds = new Set(assessmentIds);
    const labelDisagreements = validation.assessments.filter(
      ({ labelAgreement }) => labelAgreement !== true,
    ).length;
    const seriousErrors = validation.assessments.filter(
      ({ seriousError }) => seriousError === true,
    ).length;
    const expressionNatural = validation.assessments.filter(
      (assessment) => assessment.expressionNatural === true,
    ).length;
    const assessmentBindingInvalid = validation.assessments.some(
      ({ sampleId, recommendedDecision, labelAgreement, seriousError, expressionNatural }) =>
        expected.expectedDecisionsBySampleId[sampleId] === undefined ||
        recommendedDecision !== expected.expectedDecisionsBySampleId[sampleId] ||
        typeof labelAgreement !== "boolean" ||
        typeof seriousError !== "boolean" ||
        typeof expressionNatural !== "boolean" ||
        labelAgreement !== true,
    );
    const expectedDecision = labelDisagreements === 0 &&
      seriousErrors === 0 &&
      (validation.role !== "adversarial_expression_auditor" ||
        expressionNatural / evidence.totalSamples >= 0.95)
      ? "approved"
      : "rejected";
    const expectedValidatorId = validation.role === "safety_label_auditor"
      ? "validator.ai.safety-label-auditor.v1"
      : "validator.ai.adversarial-expression-auditor.v1";
    const expectedPromptVersion = validation.role === "safety_label_auditor"
      ? "safety-label-auditor-v1"
      : "adversarial-expression-auditor-v1";
    return !expectedRoles.has(validation.role) ||
      validation.validatorId !== expectedValidatorId ||
      validation.promptVersion !== expectedPromptVersion ||
      validation.modelId !== expected.actualModelId ||
      validation.assessedSamples !== evidence.totalSamples ||
      validation.assessments.length !== evidence.totalSamples ||
      uniqueAssessmentIds.size !== evidence.totalSamples ||
      Object.keys(expected.expectedDecisionsBySampleId).length !== evidence.totalSamples ||
      JSON.stringify([...uniqueAssessmentIds].sort()) !== JSON.stringify(firstSampleIds) ||
      JSON.stringify([...uniqueAssessmentIds].sort()) !==
        JSON.stringify(Object.keys(expected.expectedDecisionsBySampleId).sort()) ||
      assessmentBindingInvalid ||
      validation.labelDisagreements !== labelDisagreements ||
      validation.seriousErrors !== seriousErrors ||
      validation.decision !== expectedDecision ||
      validation.decision !== "approved" ||
      validation.isolation.independentInvocation !== true ||
      validation.isolation.counterpartOutputVisible !== false;
  });
  if (
    evidence.schemaVersion !== "phase8-safety-corpus-ai-validation-v1" ||
    evidence.decision !== "approved" ||
    evidence.datasetVersion !== expected.datasetVersion ||
    evidence.policyVersion !== expected.policyVersion ||
    evidence.totalSamples !== expected.totalSamples ||
    evidence.holdoutSamples !== expected.holdoutSamples ||
    evidence.corpusHash !== expected.corpusHash ||
    evidence.holdoutHash !== expected.holdoutHash ||
    evidence.templateRegistryHash !== expected.templateRegistryHash ||
    evidence.validations.length !== 2 ||
    roles.size !== expectedRoles.size ||
    [...expectedRoles].some((role) => !roles.has(role)) ||
    invalidValidation
  ) {
    throw new Error("C7 safety corpus AI validation failed its semantic gate.");
  }
}

function assertEvidencePath(
  path: string,
  prefix: string,
  label: string,
  issues: string[],
): void {
  const normalized = normalizedPath(path);
  if (
    path !== normalized ||
    !normalized.startsWith(prefix) ||
    normalized.split("/").some(
      (part) => part.length === 0 || part === "." || part === ".." || part.startsWith("."),
    ) ||
    normalized.toLowerCase().includes("/private/")
  ) {
    issues.push(`${label} path is unsafe or outside ${prefix}`);
  }
}

function caseBindingKey(binding: C7CaseBinding): string {
  return [
    binding.publicCaseId,
    binding.caseVersion,
    binding.contentHash,
    normalizedPath(binding.path),
    normalizedPath(binding.validationRecordPath),
  ].join("\u0000");
}

function normalizedDialogueText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

type C7RuntimeJourneyTurn =
  C7RuntimeReleaseEvidence["dialogueJourneys"][number]["turns"][number];
type C7RuntimeJourneySnapshot = C7RuntimeJourneyTurn["sessionSnapshotBeforeTurn"];

function completedJourneyTest(
  snapshot: C7RuntimeJourneySnapshot,
  testId: string,
): C7RuntimeJourneySnapshot["completedTests"][number] | undefined {
  return snapshot.completedTests.find((test) => test.testId === testId);
}

function journeyEffectCompletesTest(effect: unknown, testId: string): boolean {
  if (typeof effect !== "object" || effect === null) return false;
  const record = effect as Record<string, unknown>;
  if (record["type"] !== "test_completed") return false;
  const result = record["result"];
  return typeof result === "object" &&
    result !== null &&
    (result as Record<string, unknown>)["testId"] === testId;
}

export function reconstructC7DialogueEvidence(input: {
  casePackages: readonly CasePackage[];
  journeys: readonly C7RuntimeReleaseEvidence["dialogueJourneys"][number][];
}): {
  runs: C7DialogueRunEvidence[];
  samples: Phase8PatientReplySampleV1[];
} {
  const casesById = new Map(
    input.casePackages.map((casePackage) => [casePackage.publicCaseId, casePackage] as const),
  );
  if (casesById.size !== 5 || input.casePackages.length !== 5) {
    throw new Error("C7 dialogue reconstruction requires exactly five unique cases.");
  }

  const runs: C7DialogueRunEvidence[] = [];
  const samples: Phase8PatientReplySampleV1[] = [];
  for (const journey of input.journeys) {
    const casePackage = casesById.get(journey.caseId);
    if (
      casePackage === undefined ||
      casePackage.packageStatus !== "published" ||
      casePackage.caseVersion !== journey.caseVersion ||
      casePackage.provenance.contentHash !== journey.contentHash
    ) {
      throw new Error(`C7 journey case binding is invalid: ${journey.caseId}`);
    }
    const safeView = buildSafePatientCaseView(casePackage);
    if (safeView.patientProfile.templateId !== journey.personaTemplateId) {
      throw new Error(`C7 journey persona binding is invalid: ${journey.caseId}`);
    }

    const forbiddenDiagnosisTerms = [
      casePackage.answerKey.targetDiagnosis,
      ...casePackage.answerKey.acceptedSynonyms,
    ];
    let mostRecentDisclosedFactIds: string[] = [];
    let contextFollowupsCorrect = 0;
    let diagnosisLeaks = 0;
    let uncompletedTestResultLeaks = 0;

    journey.turns.forEach((turn, index) => {
      if (
        turn.turnNumber !== index + 1 ||
        turn.question.trim().length === 0 ||
        turn.reply.trim().length === 0 ||
        !Number.isInteger(turn.patientProviderCalls) ||
        turn.patientProviderCalls < 0 ||
        !Number.isInteger(turn.controllerProviderCalls) ||
        turn.controllerProviderCalls < 0 ||
        !Array.isArray(turn.effects) ||
        !Array.isArray(turn.sessionSnapshotBeforeTurn.completedTests)
      ) {
        throw new Error(`C7 journey turn is invalid: ${journey.caseId}#${turn.turnNumber}`);
      }

      if (
        (index === 2 || index === 7) &&
        mostRecentDisclosedFactIds.length > 0 &&
        turn.interactionKind === "medical_chat" &&
        turn.disclosedFactIds.some((factId) => mostRecentDisclosedFactIds.includes(factId))
      ) {
        contextFollowupsCorrect += 1;
      }
      if (turn.disclosedFactIds.length > 0) {
        mostRecentDisclosedFactIds = [...turn.disclosedFactIds];
      }
      if (
        forbiddenDiagnosisTerms.some((term) =>
          normalizedDialogueText(turn.reply).includes(normalizedDialogueText(term))
        )
      ) {
        diagnosisLeaks += 1;
      }
      if (index === 9) {
        const chestCtReport = casePackage.medicalTests["test.chest_ct"]?.report;
        if (
          chestCtReport !== undefined &&
          normalizedDialogueText(turn.reply).includes(normalizedDialogueText(chestCtReport))
        ) {
          uncompletedTestResultLeaks += 1;
        }
      }

      const authorizedFacts = turn.disclosedFactIds.map((factId) => {
        const fact = casePackage.patientFacts[factId];
        if (fact === undefined) {
          throw new Error(`C7 journey disclosed unknown fact: ${journey.caseId}#${factId}`);
        }
        return { factId, status: fact.status, value: fact.value };
      });
      const authorizedPersonaFacts = turn.personaFactIdsUsed.map((personaFactId) => {
        const fact = safeView.patientProfile.personaFacts.find(
          (entry) => entry.personaFactId === personaFactId,
        );
        if (fact === undefined) {
          throw new Error(`C7 journey used unknown persona fact: ${journey.caseId}#${personaFactId}`);
        }
        return structuredClone(fact);
      });
      const authorizedTestReports = turn.completedTestIdsUsed.map((testId) => {
        const report = completedJourneyTest(turn.sessionSnapshotBeforeTurn, testId)?.report;
        if (report === undefined) {
          throw new Error(`C7 journey used unreported test: ${journey.caseId}#${testId}`);
        }
        return { testId, report };
      });
      const authorizedTests = safeView.tests.map((test) => {
        const snapshotTest = completedJourneyTest(
          turn.sessionSnapshotBeforeTurn,
          test.testId,
        );
        const report = snapshotTest?.report;
        return {
          testId: test.testId,
          displayName: test.displayName,
          aliases: [...test.aliases],
          status: snapshotTest === undefined
            ? "not_completed" as const
            : snapshotTest.status,
          ...(report === undefined ? {} : { report }),
        };
      });
      samples.push({
        sampleId: `${journey.caseId}.turn-${turn.turnNumber}`,
        caseId: journey.caseId,
        caseVersion: journey.caseVersion,
        question: turn.question,
        reply: turn.reply,
        disclosedFactIds: [...turn.disclosedFactIds],
        authorizedFacts,
        authorizedPersonaFacts,
        authorizedTestReports,
        authorizedTests,
        personaTemplateId: safeView.patientProfile.templateId,
        personaBehaviorInstructions: [
          ...safeView.patientProfile.behaviorInstructions,
          safeView.patientProfile.offTopicReminderInstruction,
        ],
        interactionKind: turn.interactionKind,
        recentTurns: journey.turns
          .slice(Math.max(0, index - 4), index)
          .map(({ question, reply }) => ({ question, reply })),
        forbiddenDiagnosisTerms,
      });
    });

    if (journey.turns.length !== 12) {
      throw new Error(`C7 journey must contain 12 turns: ${journey.caseId}`);
    }
    const vitalTurn = journey.turns[8]!;
    const queryTurn = journey.turns[9]!;
    const confirmationTurn = journey.turns[10]!;
    const resultTurn = journey.turns[11]!;
    const chestCtTestId = "test.chest_ct";
    const queryNotCompleted = completedJourneyTest(
      queryTurn.sessionSnapshotBeforeTurn,
      chestCtTestId,
    ) === undefined;
    const pendingConfirmation = queryNotCompleted &&
      queryTurn.interactionKind === "test_query" &&
      queryTurn.effects.length === 0 &&
      confirmationTurn.sessionSnapshotBeforeTurn.pendingTestSuggestionId === chestCtTestId;
    const confirmationCorrect =
      confirmationTurn.sessionSnapshotBeforeTurn.pendingTestSuggestionId === chestCtTestId &&
      confirmationTurn.effects.some((effect) =>
        journeyEffectCompletesTest(effect, chestCtTestId)
      );
    const completedResult = completedJourneyTest(
      resultTurn.sessionSnapshotBeforeTurn,
      chestCtTestId,
    );
    const resultQueryCorrect = completedResult?.status === "completed" &&
      resultTurn.completedTestIdsUsed.includes(chestCtTestId) &&
      completedResult.report !== undefined &&
      normalizedDialogueText(resultTurn.reply).includes(
        normalizedDialogueText(completedResult.report),
      );
    const observedTestStates: C7ObservedTestState[] = [
      ...(queryNotCompleted ? ["not_completed" as const] : []),
      ...(pendingConfirmation ? ["pending_confirmation" as const] : []),
      ...(completedResult?.status === "completed" ? ["completed" as const] : []),
    ];
    const patientGeneratedReplies = journey.turns.filter(
      ({ patientProviderCalls }) => patientProviderCalls > 0,
    ).length;
    runs.push({
      publicCaseId: journey.caseId,
      caseVersion: journey.caseVersion,
      contentHash: journey.contentHash,
      personaTemplateId: safeView.patientProfile.templateId,
      status: "completed",
      committedTurns: journey.turns.length,
      patientGeneratedReplies,
      patientProviderCalls: journey.turns.reduce(
        (sum, { patientProviderCalls }) => sum + patientProviderCalls,
        0,
      ),
      controllerProviderCalls: journey.turns.reduce(
        (sum, { controllerProviderCalls }) => sum + controllerProviderCalls,
        0,
      ),
      localFakeReplies: journey.turns.length - patientGeneratedReplies,
      contextFollowupsEvaluated: 2,
      contextFollowupsCorrect,
      testActionsEvaluated: 4,
      testActionsCorrect:
        Number(vitalTurn.effects.some((effect) =>
          journeyEffectCompletesTest(effect, "test.vital_signs")
        )) +
        Number(pendingConfirmation) +
        Number(confirmationCorrect) +
        Number(resultQueryCorrect),
      observedTestStates,
      diagnosisLeaks,
      uncompletedTestResultLeaks,
    });
  }

  return { runs, samples };
}

export function assertC7RuntimeReleaseEvidence(evidence: C7RuntimeReleaseEvidence): void {
  const issues: string[] = [];
  const {
    aiIndex,
    caseManifest,
    publishedCasePackages,
    dialogueAudit,
    dialogueSampleSet,
    dialogueJourneys,
    dialogueReport,
    dialogueApproval,
    c6Acceptance,
    c7Acceptance,
    securityScan,
  } = evidence;

  if (
    aiIndex.schemaVersion !== "phase8-ai-evidence-index-v1" ||
    aiIndex.supersededInputExcluded !== true
  ) {
    issues.push("AI evidence must explicitly exclude superseded inputs");
  }
  const validationIds = new Set(aiIndex.caseValidations.map(({ publicCaseId }) => publicCaseId));
  const publishedKeys = new Set(aiIndex.publishedArtifacts.map(caseBindingKey));
  const manifestKeys = new Set(caseManifest.publishedCases.map(caseBindingKey));
  const publishedCasePackagesById = new Map(
    publishedCasePackages.map((casePackage) => [casePackage.publicCaseId, casePackage] as const),
  );
  if (
    aiIndex.caseValidations.length !== 5 ||
    aiIndex.publishedArtifacts.length !== 5 ||
    caseManifest.publishedCases.length !== 5 ||
    validationIds.size !== 5 ||
    publishedKeys.size !== 5 ||
    manifestKeys.size !== 5 ||
    publishedCasePackages.length !== 5 ||
    publishedCasePackagesById.size !== 5 ||
    [...manifestKeys].some((key) => !publishedKeys.has(key)) ||
    caseManifest.publishedCases.some((binding) => {
      const casePackage = publishedCasePackagesById.get(binding.publicCaseId);
      return casePackage === undefined ||
        casePackage.packageStatus !== "published" ||
        casePackage.caseVersion !== binding.caseVersion ||
        casePackage.provenance.contentHash !== binding.contentHash;
    }) ||
    aiIndex.caseValidations.some((validation) => {
      const published = aiIndex.publishedArtifacts.find(
        ({ publicCaseId }) => publicCaseId === validation.publicCaseId,
      );
      return published === undefined ||
        published.caseVersion !== validation.caseVersion ||
        published.contentHash !== validation.contentHash ||
        !CONTENT_HASH_PATTERN.test(validation.contentHash) ||
        !HEX_SHA256_PATTERN.test(validation.sha256);
    })
  ) {
    issues.push("exactly five consistently bound cases are required");
  }
  for (const validation of aiIndex.caseValidations) {
    assertEvidencePath(validation.path, "evaluation/phase8/", "case validation", issues);
  }
  for (const artifact of aiIndex.publishedArtifacts) {
    assertEvidencePath(artifact.path, "published/", "published case", issues);
    assertEvidencePath(
      artifact.validationRecordPath,
      "published/",
      "published validation",
      issues,
    );
  }

  if (
    dialogueReport.schemaVersion !== "c7-dialogue-architecture-report-v1" ||
    dialogueReport.gate.status !== "passed" ||
    dialogueReport.gate.blockers.length !== 0 ||
    dialogueReport.auditDecision !== "approved"
  ) {
    issues.push("dialogue architecture gate and independent audit must pass");
  }
  const requiredStates = ["not_completed", "pending_confirmation", "completed"];
  if (
    dialogueReport.coverage.caseCount !== 5 ||
    dialogueReport.coverage.personaCount !== 3 ||
    dialogueReport.coverage.minimumTurnsPerRun < 12 ||
    requiredStates.some((state) => !dialogueReport.coverage.observedTestStates.includes(state)) ||
    dialogueReport.runs.length !== 5 ||
    dialogueReport.runs.some(
      ({ committedTurns, status }) => committedTurns < 12 || status !== "completed",
    )
  ) {
    issues.push("five-case, three-persona, twelve-turn and test-state coverage is required");
  }
  const metrics = dialogueReport.metrics;
  if (
    metrics.patientGeneratedReplyRate !== 1 ||
    metrics.controllerProviderCalls !== 0 ||
    metrics.localFakeReplies !== 0 ||
    metrics.diagnosisLeaks !== 0 ||
    metrics.uncompletedTestResultLeaks !== 0 ||
    metrics.personaConsistencyRate < 0.95 ||
    metrics.contextFollowupAccuracy < 0.95 ||
    metrics.naturalLanguageTestActionAccuracy < 0.95 ||
    metrics.seriousFactErrors !== 0
  ) {
    issues.push("one or more C7 release metrics failed their threshold");
  }

  const bindings = dialogueReport.bindings;
  const bindingValues = [
    evidence.aiIndexSha256,
    evidence.caseManifestSha256,
    evidence.caseValidationSetSha256,
    evidence.patientPromptSha256,
    evidence.shareContractSha256,
    evidence.dialogueAuditSha256,
    bindings.caseManifestSha256,
  ];
  if (
    bindingValues.some((value) => !HEX_SHA256_PATTERN.test(value)) ||
    bindings.aiEvidenceIndexSha256 !== evidence.aiIndexSha256 ||
    bindings.caseManifestSha256 !== evidence.caseManifestSha256 ||
    bindings.caseValidationSetSha256 !== evidence.caseValidationSetSha256 ||
    bindings.patientPromptSha256 !== evidence.patientPromptSha256 ||
    bindings.shareContractSha256 !== evidence.shareContractSha256 ||
    bindings.dialogueAuditSha256 !== evidence.dialogueAuditSha256 ||
    !HEX_SHA256_PATTERN.test(dialogueReport.runSetSha256)
  ) {
    issues.push("dialogue report evidence bindings drifted");
  }
  const expectedDialogueRoles = new Set<string>([
    "fact_safety_auditor",
    "language_role_auditor",
  ]);
  const dialogueRoles = new Set<string>(dialogueAudit.validations.map(({ role }) => role));
  const firstDialogueSampleIds = dialogueAudit.validations[0]?.assessments
    .map(({ sampleId }) => sampleId)
    .sort() ?? [];
  let recomputedDialogueSeriousErrors = 0;
  let recomputedNaturalAndRoleRate = Number.NaN;
  const samplesById = new Map(
    dialogueSampleSet.samples.map((sample) => [sample.sampleId, sample] as const),
  );
  const sortedJourneys = [...dialogueJourneys].sort((left, right) =>
    left.caseId.localeCompare(right.caseId)
  );
  const journeySamples = new Map<string, {
    journey: C7RuntimeReleaseEvidence["dialogueJourneys"][number];
    turn: C7RuntimeReleaseEvidence["dialogueJourneys"][number]["turns"][number];
  }>();
  let invalidJourney = dialogueJourneys.length !== 5 ||
    new Set(dialogueJourneys.map(({ caseId }) => caseId)).size !== 5;
  for (const journey of dialogueJourneys) {
    const caseBinding = caseManifest.publishedCases.find(
      ({ publicCaseId }) => publicCaseId === journey.caseId,
    );
    const reportRun = dialogueReport.runs.find(
      ({ publicCaseId }) => publicCaseId === journey.caseId,
    );
    if (
      journey.schemaVersion !== "c7-private-dialogue-journey-v1" ||
      caseBinding === undefined ||
      reportRun === undefined ||
      journey.caseVersion !== caseBinding.caseVersion ||
      journey.contentHash !== caseBinding.contentHash ||
      journey.turns.length !== 12
    ) {
      invalidJourney = true;
      continue;
    }
    journey.turns.forEach((turn, index) => {
      const sampleId = `${journey.caseId}.turn-${turn.turnNumber}`;
      if (
        turn.turnNumber !== index + 1 ||
        turn.patientProviderCalls !== 1 ||
        turn.controllerProviderCalls !== 0 ||
        journeySamples.has(sampleId)
      ) {
        invalidJourney = true;
      }
      journeySamples.set(sampleId, { journey, turn });
    });
  }
  let reconstructedDialogue:
    ReturnType<typeof reconstructC7DialogueEvidence> | undefined;
  try {
    reconstructedDialogue = reconstructC7DialogueEvidence({
      casePackages: publishedCasePackages,
      journeys: dialogueJourneys,
    });
  } catch {
    reconstructedDialogue = undefined;
  }
  const invalidJourneySampleBinding = reconstructedDialogue === undefined ||
    sha256Canonical(
      [...dialogueSampleSet.samples].sort((left, right) =>
        left.sampleId.localeCompare(right.sampleId)
      ),
    ) !== sha256Canonical(
      [...reconstructedDialogue.samples].sort((left, right) =>
        left.sampleId.localeCompare(right.sampleId)
      ),
    );
  const invalidJourneyRunBinding = reconstructedDialogue === undefined ||
    sha256Canonical(
      [...dialogueReport.runs].sort((left, right) =>
        left.publicCaseId.localeCompare(right.publicCaseId)
      ),
    ) !== sha256Canonical(
      [...reconstructedDialogue.runs].sort((left, right) =>
        left.publicCaseId.localeCompare(right.publicCaseId)
      ),
    );
  const invalidDialogueValidation = dialogueAudit.validations.some((validation) => {
    const sampleIds = validation.assessments.map(({ sampleId }) => sampleId);
    const uniqueSampleIds = new Set(sampleIds);
    const seriousErrors = validation.assessments.filter(
      ({ sampleId, seriousError, factGrounded }) => {
        const sample = samplesById.get(sampleId);
        return seriousError ||
          (validation.role === "fact_safety_auditor" &&
            !factGrounded &&
            (sample === undefined || !isPhase8FactGroundingExempt(sample)));
      },
    ).length;
    const unauthorizedFactLeaks = validation.assessments.filter(
      ({ unauthorizedFactLeak }) => unauthorizedFactLeak,
    ).length;
    const diagnosisLeaks = validation.assessments.filter(({ diagnosisLeak }) => diagnosisLeak).length;
    const unknownAsAbsentErrors = validation.assessments.filter(
      ({ unknownAsAbsent }) => unknownAsAbsent,
    ).length;
    const naturalAndRoleConsistent = validation.assessments.filter(
      ({ naturalChinese, roleConsistent }) =>
        naturalChinese === true && roleConsistent === true,
    ).length;
    const invalidAssessmentTypes = validation.assessments.some((assessment) =>
      typeof assessment.factGrounded !== "boolean" ||
      typeof assessment.unauthorizedFactLeak !== "boolean" ||
      typeof assessment.diagnosisLeak !== "boolean" ||
      typeof assessment.unknownAsAbsent !== "boolean" ||
      typeof assessment.naturalChinese !== "boolean" ||
      typeof assessment.roleConsistent !== "boolean" ||
      typeof assessment.seriousError !== "boolean"
    );
    recomputedDialogueSeriousErrors += seriousErrors;
    if (validation.role === "language_role_auditor") {
      recomputedNaturalAndRoleRate = naturalAndRoleConsistent / dialogueAudit.sampleCount;
    }
    const expectedDecision = seriousErrors === 0 &&
      unauthorizedFactLeaks === 0 &&
      diagnosisLeaks === 0 &&
      unknownAsAbsentErrors === 0 &&
      (validation.role !== "language_role_auditor" ||
        naturalAndRoleConsistent / dialogueAudit.sampleCount >= 0.95)
      ? "approved"
      : "rejected";
    const expectedValidatorId = validation.role === "fact_safety_auditor"
      ? "validator.ai.patient-fact-safety.v1"
      : "validator.ai.patient-language-role.v1";
    const expectedPromptVersion = validation.role === "fact_safety_auditor"
      ? "patient-fact-safety-auditor-v2"
      : "patient-language-role-auditor-v2";
    return !expectedDialogueRoles.has(validation.role) ||
      validation.validatorId !== expectedValidatorId ||
      validation.promptVersion !== expectedPromptVersion ||
      validation.modelId !== aiIndex.provider.actualModelId ||
      validation.assessedSamples !== dialogueAudit.sampleCount ||
      validation.assessments.length !== dialogueAudit.sampleCount ||
      invalidAssessmentTypes ||
      uniqueSampleIds.size !== dialogueAudit.sampleCount ||
      JSON.stringify([...uniqueSampleIds].sort()) !== JSON.stringify(firstDialogueSampleIds) ||
      JSON.stringify([...uniqueSampleIds].sort()) !==
        JSON.stringify([...samplesById.keys()].sort()) ||
      validation.seriousErrors !== seriousErrors ||
      validation.unauthorizedFactLeaks !== unauthorizedFactLeaks ||
      validation.diagnosisLeaks !== diagnosisLeaks ||
      validation.unknownAsAbsentErrors !== unknownAsAbsentErrors ||
      validation.naturalAndRoleConsistent !== naturalAndRoleConsistent ||
      validation.decision !== expectedDecision ||
      validation.decision !== "approved" ||
      validation.isolation.independentInvocation !== true ||
      validation.isolation.counterpartOutputVisible !== false;
  });
  let recomputedDialogueReport:
    ReturnType<typeof buildC7DialogueArchitectureReport> | undefined;
  try {
    recomputedDialogueReport = buildC7DialogueArchitectureReport({
      runs: dialogueReport.runs,
      audit: {
        decision: dialogueAudit.decision,
        personaConsistencyRate: recomputedNaturalAndRoleRate,
        seriousFactErrors: recomputedDialogueSeriousErrors,
        diagnosisLeaks: Math.max(
          ...dialogueAudit.validations.map(({ diagnosisLeaks }) => diagnosisLeaks),
        ),
        uncompletedTestResultLeaks: dialogueReport.runs.reduce(
          (sum, run) => sum + run.uncompletedTestResultLeaks,
          0,
        ),
      },
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
  } catch {
    recomputedDialogueReport = undefined;
  }
  const runBindingsValid = dialogueReport.runs.length === aiIndex.publishedArtifacts.length &&
    new Set(dialogueReport.runs.map(({ publicCaseId }) => publicCaseId)).size ===
      aiIndex.publishedArtifacts.length &&
    dialogueReport.runs.every((run) => {
      const published = aiIndex.publishedArtifacts.find(
        ({ publicCaseId }) => publicCaseId === run.publicCaseId,
      );
      return published !== undefined &&
        run.caseVersion === published.caseVersion &&
        run.contentHash === published.contentHash;
    });
  const reportDerivedValuesValid = recomputedDialogueReport !== undefined &&
    JSON.stringify(dialogueReport.coverage) ===
      JSON.stringify(recomputedDialogueReport.coverage) &&
    JSON.stringify(dialogueReport.metrics) ===
      JSON.stringify(recomputedDialogueReport.metrics) &&
    dialogueReport.auditDecision === recomputedDialogueReport.auditDecision &&
    JSON.stringify(dialogueReport.gate) === JSON.stringify(recomputedDialogueReport.gate);
  if (
    dialogueAudit.schemaVersion !== "phase8-patient-sample-ai-validation-v1" ||
    dialogueAudit.decision !== "approved" ||
    !HEX_SHA256_PATTERN.test(dialogueAudit.candidateRunSetSha256) ||
    !HEX_SHA256_PATTERN.test(dialogueAudit.sampleSetSha256) ||
    dialogueAudit.candidateRunSetSha256 !== dialogueReport.runSetSha256 ||
    sha256Canonical(dialogueReport.runs) !== dialogueReport.runSetSha256 ||
    dialogueSampleSet.schemaVersion !== "c7-private-patient-sample-set-v1" ||
    dialogueSampleSet.runSetSha256 !== dialogueReport.runSetSha256 ||
    dialogueSampleSet.sampleSetSha256 !== dialogueAudit.sampleSetSha256 ||
    dialogueSampleSet.sampleSetSha256 !== sha256Canonical(dialogueSampleSet.samples) ||
    dialogueSampleSet.sampleCount !== dialogueAudit.sampleCount ||
    dialogueSampleSet.samples.length !== dialogueAudit.sampleCount ||
    samplesById.size !== dialogueAudit.sampleCount ||
    !HEX_SHA256_PATTERN.test(evidence.dialogueJourneySetSha256) ||
    evidence.dialogueJourneySetSha256 !== sha256Canonical(sortedJourneys) ||
    invalidJourney ||
    journeySamples.size !== dialogueAudit.sampleCount ||
    invalidJourneySampleBinding ||
    invalidJourneyRunBinding ||
    dialogueAudit.sampleCount !== 60 ||
    dialogueAudit.validations.length !== 2 ||
    dialogueRoles.size !== expectedDialogueRoles.size ||
    [...expectedDialogueRoles].some((role) => !dialogueRoles.has(role)) ||
    invalidDialogueValidation ||
    !runBindingsValid ||
    !reportDerivedValuesValid ||
    dialogueAudit.factOrSafetySeriousErrors !== recomputedDialogueSeriousErrors ||
    dialogueAudit.naturalAndRoleConsistentRate !== recomputedNaturalAndRoleRate ||
    dialogueReport.metrics.seriousFactErrors !== recomputedDialogueSeriousErrors ||
    dialogueReport.metrics.personaConsistencyRate !== recomputedNaturalAndRoleRate
  ) {
    issues.push("dialogue audit roles must be approved and bound to the approved actual model");
  }

  if (
    dialogueApproval.schemaVersion !== "c7-provider-model-approval-v1" ||
    dialogueApproval.decision !== "approved" ||
    Number.isNaN(Date.parse(dialogueApproval.decidedAt)) ||
    dialogueApproval.decisionRef.trim().length === 0 ||
    !sameProvider(aiIndex.provider, dialogueReport.provider) ||
    !sameProvider(aiIndex.provider, dialogueApproval.provider) ||
    dialogueReport.provider.promptVersion !== dialogueApproval.provider.promptVersion ||
    !/^v0\.2\.0\+set\.[a-f0-9]{16}$/u.test(dialogueReport.provider.promptVersion ?? "") ||
    dialogueApproval.audit.sha256 !== evidence.dialogueAuditSha256
  ) {
    issues.push("C7 Provider/model/prompt approval binding is invalid");
  }
  if (
    c6Acceptance.schemaVersion !== "c6-cli-acceptance-evidence-v1" ||
    c6Acceptance.status !== "passed" ||
    c6Acceptance.journeyCount !== 3 ||
    c6Acceptance.committedTurns !== 36 ||
    c6Acceptance.providerFailure.code !== "MODEL_UNAVAILABLE" ||
    c6Acceptance.providerFailure.fakePatientReplies !== 0 ||
    c6Acceptance.providerFailure.committedTurns !== 0 ||
    c6Acceptance.verification.exitCode !== 0 ||
    Object.values(c6Acceptance.sourceBindings).some(
      (sha256) => !HEX_SHA256_PATTERN.test(sha256),
    )
  ) {
    issues.push("C6 CLI acceptance and fail-closed Provider behavior are required");
  }
  if (
    c7Acceptance.schemaVersion !== "c7-runtime-acceptance-evidence-v1" ||
    c7Acceptance.status !== "passed" ||
    c7Acceptance.persistenceCovered !== true ||
    c7Acceptance.idempotencyCovered !== true ||
    c7Acceptance.recoveryCovered !== true ||
    c7Acceptance.providerFailureCovered !== true ||
    c7Acceptance.verification.exitCode !== 0
  ) {
    issues.push("C7 persistence, idempotency, recovery and Provider failure coverage is required");
  }
  if (
    c7Acceptance.testFiles.length === 0 ||
    c7Acceptance.testFiles.length !== C7_ACCEPTANCE_TEST_PATHS.length ||
    new Set(c7Acceptance.testFiles.map(({ path }) => path)).size !== c7Acceptance.testFiles.length ||
    C7_ACCEPTANCE_TEST_PATHS.some(
      (expectedPath) => !c7Acceptance.testFiles.some(({ path }) => path === expectedPath),
    ) ||
    c7Acceptance.testFiles.some(
      ({ path, sha256 }) =>
        !path.startsWith("tests/") || path.includes("..") || !HEX_SHA256_PATTERN.test(sha256),
    )
  ) {
    issues.push("C7 runtime acceptance test bindings are required");
  }
  if (
    securityScan.schemaVersion !== "phase8-security-scan-report-v1" ||
    securityScan.status !== "passed" ||
    securityScan.scannedRoots.length !== 2 ||
    !securityScan.scannedRoots.includes("model") ||
    !securityScan.scannedRoots.includes("share") ||
    securityScan.secretFindings.length !== 0 ||
    securityScan.hiddenFieldFindings.length !== 0 ||
    securityScan.blockers.length !== 0
  ) {
    issues.push("C7 security scan must pass without secret or hidden-field findings");
  }

  if (issues.length > 0) {
    throw new Error(`C7 runtime release evidence failed: ${issues.join("; ")}`);
  }
}

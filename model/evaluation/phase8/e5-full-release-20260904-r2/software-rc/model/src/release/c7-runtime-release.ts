import {
  isPhase8FactGroundingExempt,
  type Phase8PatientReplySampleV1,
  Phase8PatientSampleAiValidationV1,
  type Phase8SafetyCorpusAiValidationV1,
} from "../evaluation/phase8-ai-evidence.js";
import {
  buildC7DialogueArchitectureReport,
  type C7DialogueArchitectureReport,
  type C7DialogueReleasePolicy,
  type C7DialogueRunEvidence,
  type C7ObservedTestState,
} from "../evaluation/c7-dialogue-architecture-benchmark.js";
import type { SupportedCasePackage } from "../domain/case-package.js";
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
  "tests/e2-manifest-pipeline.test.ts",
  "tests/phase6-case-production.test.ts",
  "tests/phase7-eval-corpus.test.ts",
  "tests/phase7-eval-harness.test.ts",
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
  actualModelId?: string;
  promptVersion?: string;
}

type C7ReviewProviderIdentity = Omit<C7ProviderIdentity, "actualModelId"> & {
  actualModelId?: string;
};

interface C7CaseBinding {
  publicCaseId: string;
  caseVersion: string;
  contentHash: string;
  path: string;
  validationRecordPath?: string;
  packageStatus?: SupportedCasePackage["packageStatus"];
  reviewStatus?:
    | "approved"
    | "revision_recommended"
    | "rejected"
    | "not_run"
    | "missing"
    | "stale";
}

export interface C7RuntimeReleaseEvidence {
  releasePolicy: C7DialogueReleasePolicy;
  aiIndexSha256: string;
  caseManifestSha256: string;
  caseValidationSetSha256: string;
  patientPromptSha256: string;
  shareContractSha256: string;
  dialogueAuditSha256: string;
  dialogueJourneySetSha256: string;
  publishedCasePackages: SupportedCasePackage[];
  aiIndex: {
    schemaVersion: string;
    supersededInputExcluded: boolean;
    reviewPolicy?: "non_blocking";
    reviewFindings?: Array<{
      code: string;
      scope: string;
      decision: string;
    }>;
    provider: C7ReviewProviderIdentity;
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
    runStatus?: "completed" | "failed_to_run" | "not_run";
    failureCode?: string;
    uncommittedAttempt?: {
      patientProviderCalls: number;
      controllerProviderCalls: number;
    };
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
  dialogueReport: C7DialogueArchitectureReport & {
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

export interface C7RuntimeFinding {
  code: string;
  scope: string;
  message: string;
}

function sameProvider(left: C7ProviderIdentity, right: C7ProviderIdentity): boolean {
  return left.providerName === right.providerName &&
    left.protocol === right.protocol &&
    left.endpointSha256 === right.endpointSha256 &&
    left.configuredModelId === right.configuredModelId &&
    left.actualModelId === right.actualModelId;
}

function sameUpstreamProvider(
  upstream: C7ReviewProviderIdentity,
  observed: C7ProviderIdentity,
): boolean {
  return upstream.providerName === observed.providerName &&
    upstream.protocol === observed.protocol &&
    upstream.endpointSha256 === observed.endpointSha256 &&
    upstream.configuredModelId === observed.configuredModelId &&
    (observed.actualModelId === undefined ||
      upstream.actualModelId === undefined ||
      upstream.actualModelId === observed.actualModelId);
}

function normalizedPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function isExactIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return false;
  return new Date(value).toISOString() === value;
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
  if (
    !["approved", "rejected"].includes(validation.decision) ||
    validation.validations.some(
      ({ modelId, decision, checks }) =>
        modelId !== approvedActualModelId ||
        !["approved", "rejected"].includes(decision) ||
        Object.values(checks).some((value) => value !== "pass" && value !== "fail"),
    )
  ) {
    throw new Error("C7 case validation structure or model identity drifted.");
  }
  const derivedDecisions = validation.validations.map(({ checks, decision }) => {
    const derived = Object.values(checks).every((value) => value === "pass")
      ? "approved"
      : "rejected";
    if (decision !== derived) {
      throw new Error("C7 case validation reviewer decision drifted.");
    }
    return derived;
  });
  const aggregateDecision = derivedDecisions.length === 2 &&
      derivedDecisions.every((decision) => decision === "approved")
    ? "approved"
    : "rejected";
  if (validation.decision !== aggregateDecision) {
    throw new Error("C7 case validation aggregate decision drifted.");
  }
  const normalized = structuredClone(validation);
  normalized.decision = "approved";
  normalized.validations = normalized.validations.map((entry) => ({
    ...entry,
    decision: "approved",
    checks: Object.fromEntries(
      Object.keys(entry.checks).map((key) => [key, "pass"]),
    ) as typeof entry.checks,
  }));
  assertPhase8CaseValidation(normalized, binding);
}

function assertC7SafetyCorpusEvidenceStrict(
  evidence: Phase8SafetyCorpusAiValidationV1,
  expected: {
    actualModelId: string | undefined;
    configuredModelId?: string;
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

export function assertC7SafetyCorpusEvidence(
  evidence: Phase8SafetyCorpusAiValidationV1,
  expected: Parameters<typeof assertC7SafetyCorpusEvidenceStrict>[1],
): void {
  const expectedRoles = new Set<string>([
    "safety_label_auditor",
    "adversarial_expression_auditor",
  ]);
  const expectedSampleIds = Object.keys(expected.expectedDecisionsBySampleId).sort();
  const roles = new Set(evidence.validations.map(({ role }) => role));
  const headerDrifted =
    evidence.schemaVersion !== "phase8-safety-corpus-ai-validation-v1" ||
    evidence.datasetVersion !== expected.datasetVersion ||
    evidence.policyVersion !== expected.policyVersion ||
    evidence.corpusHash !== expected.corpusHash ||
    evidence.holdoutHash !== expected.holdoutHash ||
    evidence.templateRegistryHash !== expected.templateRegistryHash ||
    evidence.totalSamples !== expected.totalSamples ||
    evidence.holdoutSamples !== expected.holdoutSamples ||
    expectedSampleIds.length !== expected.totalSamples ||
    evidence.validations.length !== 2 || roles.size !== 2 ||
    [...expectedRoles].some((role) =>
      !roles.has(role as typeof evidence.validations[number]["role"]));
  const failedValidations = evidence.validations.filter(
    ({ runStatus }) => runStatus === "failed_to_run",
  );
  if (evidence.decision === "not_run" || failedValidations.length > 0) {
    if (
      headerDrifted || evidence.decision !== "not_run" ||
      failedValidations.length < 1
    ) {
      throw new Error("C7 safety corpus not-run evidence header or status drifted.");
    }
    for (const validation of evidence.validations) {
      const expectedValidatorId = validation.role === "safety_label_auditor"
        ? "validator.ai.safety-label-auditor.v1"
        : "validator.ai.adversarial-expression-auditor.v1";
      const expectedPromptVersion = validation.role === "safety_label_auditor"
        ? "safety-label-auditor-v1"
        : "adversarial-expression-auditor-v1";
      const assessmentIds = validation.assessments.map(({ sampleId }) => sampleId);
      const labelDisagreements = validation.assessments.filter(
        ({ labelAgreement }) => labelAgreement !== true,
      ).length;
      const seriousErrors = validation.assessments.filter(
        ({ seriousError }) => seriousError === true,
      ).length;
      if (
        validation.validatorId !== expectedValidatorId ||
        validation.promptVersion !== expectedPromptVersion ||
        validation.modelId !== (
          validation.runStatus === "failed_to_run"
            ? validation.subcallCount > 0
              ? expected.actualModelId
              : expected.configuredModelId ?? expected.actualModelId
            : expected.actualModelId
        ) ||
        (validation.subcallCount > 0 && expected.actualModelId === undefined) ||
        validation.isolation.independentInvocation !== true ||
        validation.isolation.counterpartOutputVisible !== false ||
        Number.isNaN(Date.parse(validation.validatedAt)) ||
        validation.assessedSamples !== validation.assessments.length ||
        validation.assessedSamples > expected.totalSamples ||
        new Set(assessmentIds).size !== assessmentIds.length ||
        assessmentIds.some((sampleId) =>
          expected.expectedDecisionsBySampleId[sampleId] === undefined) ||
        validation.assessments.some(
          ({ sampleId, recommendedDecision, labelAgreement, seriousError, expressionNatural }) =>
            recommendedDecision !== expected.expectedDecisionsBySampleId[sampleId] ||
            typeof labelAgreement !== "boolean" ||
            typeof seriousError !== "boolean" ||
            typeof expressionNatural !== "boolean",
        ) ||
        validation.labelDisagreements !== labelDisagreements ||
        validation.seriousErrors !== seriousErrors ||
        !Number.isInteger(validation.subcallCount) || validation.subcallCount < 0 ||
        !Array.isArray(validation.providerRequestIds) ||
        validation.providerRequestIds.length > validation.subcallCount ||
        new Set(validation.providerRequestIds).size !== validation.providerRequestIds.length ||
        validation.providerRequestIds.some((requestId) =>
          typeof requestId !== "string" || requestId.length === 0) ||
        !Number.isInteger(validation.usage.inputTokens) || validation.usage.inputTokens < 0 ||
        !Number.isInteger(validation.usage.outputTokens) || validation.usage.outputTokens < 0 ||
        validation.usage.totalTokens !==
          validation.usage.inputTokens + validation.usage.outputTokens
      ) {
        throw new Error("C7 safety corpus not-run evidence binding drifted.");
      }
      if (validation.runStatus === "failed_to_run") {
        if (
          validation.decision !== "not_run" ||
          typeof validation.failureCode !== "string" ||
          validation.failureCode.trim().length === 0
        ) {
          throw new Error("C7 safety corpus failed Provider call evidence drifted.");
        }
      } else {
        const expressionNatural = validation.assessments.filter(
          ({ expressionNatural }) => expressionNatural === true,
        ).length;
        const expectedDecision = labelDisagreements === 0 &&
            seriousErrors === 0 &&
            (validation.role !== "adversarial_expression_auditor" ||
              expressionNatural / expected.totalSamples >= 0.95)
          ? "approved"
          : "rejected";
        if (
          validation.runStatus !== "completed" ||
          validation.failureCode !== undefined ||
          validation.assessedSamples !== expected.totalSamples ||
          JSON.stringify([...assessmentIds].sort()) !== JSON.stringify(expectedSampleIds) ||
          validation.decision !== expectedDecision
        ) {
          throw new Error("C7 safety corpus completed counterpart evidence drifted.");
        }
      }
    }
    return;
  }
  if (
    headerDrifted
  ) {
    throw new Error("C7 safety corpus AI validation semantic gate header or coverage drifted.");
  }
  const validationDecisions: Array<"approved" | "rejected"> = [];
  for (const validation of evidence.validations) {
    const expectedValidatorId = validation.role === "safety_label_auditor"
      ? "validator.ai.safety-label-auditor.v1"
      : "validator.ai.adversarial-expression-auditor.v1";
    const expectedPromptVersion = validation.role === "safety_label_auditor"
      ? "safety-label-auditor-v1"
      : "adversarial-expression-auditor-v1";
    const assessmentIds = validation.assessments.map(({ sampleId }) => sampleId);
    const uniqueAssessmentIds = new Set(assessmentIds);
    const labelDisagreements = validation.assessments.filter(
      ({ labelAgreement }) => labelAgreement !== true,
    ).length;
    const seriousErrors = validation.assessments.filter(
      ({ seriousError }) => seriousError === true,
    ).length;
    const expressionNatural = validation.assessments.filter(
      ({ expressionNatural }) => expressionNatural === true,
    ).length;
    if (
      !expectedRoles.has(validation.role) ||
      validation.validatorId !== expectedValidatorId ||
      validation.promptVersion !== expectedPromptVersion ||
      (validation.runStatus !== undefined && validation.runStatus !== "completed") ||
      validation.failureCode !== undefined ||
      validation.modelId !== expected.actualModelId ||
      validation.isolation.independentInvocation !== true ||
      validation.isolation.counterpartOutputVisible !== false ||
      validation.assessedSamples !== expected.totalSamples ||
      validation.assessments.length !== expected.totalSamples ||
      uniqueAssessmentIds.size !== expected.totalSamples ||
      JSON.stringify([...uniqueAssessmentIds].sort()) !== JSON.stringify(expectedSampleIds) ||
      !Number.isInteger(validation.subcallCount) || validation.subcallCount < 1 ||
      !Array.isArray(validation.providerRequestIds) ||
      validation.providerRequestIds.length > validation.subcallCount ||
      new Set(validation.providerRequestIds).size !== validation.providerRequestIds.length ||
      validation.providerRequestIds.some((requestId) =>
        typeof requestId !== "string" || requestId.length === 0) ||
      Number.isNaN(Date.parse(validation.validatedAt)) ||
      !Number.isInteger(validation.usage.inputTokens) || validation.usage.inputTokens < 0 ||
      !Number.isInteger(validation.usage.outputTokens) || validation.usage.outputTokens < 0 ||
      validation.usage.totalTokens !==
        validation.usage.inputTokens + validation.usage.outputTokens ||
      validation.assessments.some(
        ({ sampleId, recommendedDecision, labelAgreement, seriousError, expressionNatural }) =>
          expected.expectedDecisionsBySampleId[sampleId] === undefined ||
          recommendedDecision !== expected.expectedDecisionsBySampleId[sampleId] ||
          typeof labelAgreement !== "boolean" ||
          typeof seriousError !== "boolean" ||
          typeof expressionNatural !== "boolean",
      ) ||
      validation.labelDisagreements !== labelDisagreements ||
      validation.seriousErrors !== seriousErrors
    ) {
      throw new Error("C7 safety corpus AI validation sample binding drifted.");
    }
    const decision = labelDisagreements === 0 &&
        seriousErrors === 0 &&
        (validation.role !== "adversarial_expression_auditor" ||
          expressionNatural / evidence.totalSamples >= 0.95)
      ? "approved"
      : "rejected";
    if (validation.decision !== decision) {
      throw new Error("C7 safety corpus AI validation decision drifted.");
    }
    validationDecisions.push(decision);
  }
  const expectedDecision = validationDecisions.length === 2 &&
      validationDecisions.every((decision) => decision === "approved")
    ? "approved"
    : "rejected";
  if (evidence.decision !== expectedDecision) {
    throw new Error("C7 safety corpus aggregate decision drifted.");
  }

  const normalized = structuredClone(evidence);
  normalized.decision = "approved";
  normalized.validations = normalized.validations.map((validation) => ({
    ...validation,
    decision: "approved",
    labelDisagreements: 0,
    seriousErrors: 0,
    assessments: validation.assessments.map((assessment) => ({
      ...assessment,
      recommendedDecision:
        expected.expectedDecisionsBySampleId[assessment.sampleId] as
          typeof assessment.recommendedDecision,
      labelAgreement: true,
      seriousError: false,
      expressionNatural: true,
    })),
  }));
  assertC7SafetyCorpusEvidenceStrict(normalized, expected);
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
    normalizedPath(binding.validationRecordPath ?? ""),
    binding.packageStatus ?? "published",
    binding.reviewStatus ?? "approved",
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

export interface C7BenchmarkJourneyTurn {
  reply: string;
  interactionKind: string;
  completedTestIdsUsed: readonly string[];
  effects: readonly unknown[];
  sessionSnapshotBeforeTurn: C7RuntimeJourneySnapshot;
}

export function assessC7BenchmarkTestJourney(input: {
  testId: string;
  turns: readonly C7BenchmarkJourneyTurn[];
}): {
  observedTestStates: C7ObservedTestState[];
  testActionsEvaluated: number;
  testActionsCorrect: number;
} {
  const vitalTurn = input.turns[8];
  const queryTurn = input.turns[9];
  const confirmationTurn = input.turns[10];
  const resultTurn = input.turns[11];
  const queryNotCompleted = queryTurn !== undefined &&
    completedJourneyTest(queryTurn.sessionSnapshotBeforeTurn, input.testId) ===
      undefined;
  const pendingConfirmation = queryTurn !== undefined &&
    confirmationTurn !== undefined && queryNotCompleted &&
    queryTurn.interactionKind === "test_query" &&
    queryTurn.effects.length === 0 &&
    confirmationTurn.sessionSnapshotBeforeTurn.pendingTestSuggestionId ===
      input.testId;
  const confirmationCorrect = confirmationTurn !== undefined &&
    confirmationTurn.sessionSnapshotBeforeTurn.pendingTestSuggestionId ===
      input.testId &&
    confirmationTurn.effects.some((effect) =>
      journeyEffectCompletesTest(effect, input.testId));
  const completedResult = resultTurn === undefined
    ? undefined
    : completedJourneyTest(resultTurn.sessionSnapshotBeforeTurn, input.testId);
  const resultQueryCorrect = resultTurn !== undefined &&
    completedResult?.status === "completed" &&
    resultTurn.completedTestIdsUsed.includes(input.testId) &&
    completedResult.report !== undefined &&
    normalizedDialogueText(resultTurn.reply).includes(
      normalizedDialogueText(completedResult.report),
    );
  const vitalCorrect = vitalTurn?.effects.some((effect) =>
    journeyEffectCompletesTest(effect, "test.vital_signs")) ?? false;
  return {
    observedTestStates: [
      ...(queryNotCompleted ? ["not_completed" as const] : []),
      ...(pendingConfirmation ? ["pending_confirmation" as const] : []),
      ...(completedResult?.status === "completed" ? ["completed" as const] : []),
    ],
    testActionsEvaluated: [
      vitalTurn !== undefined,
      queryTurn !== undefined && confirmationTurn !== undefined,
      confirmationTurn !== undefined,
      resultTurn !== undefined,
    ].filter(Boolean).length,
    testActionsCorrect: Number(vitalCorrect) + Number(pendingConfirmation) +
      Number(confirmationCorrect) + Number(resultQueryCorrect),
  };
}

export interface C7BenchmarkTestScenario {
  testId: string;
  displayName: string;
  aliases: string[];
  report: string;
}

export function selectC7BenchmarkTestScenario(
  casePackage: SupportedCasePackage,
): C7BenchmarkTestScenario {
  const classifications = Object.entries(casePackage.rubric.testClassifications);
  const focusedRequiredTestIds = classifications
    .filter(([testId, classification]) =>
      classification === "required" && testId !== "test.vital_signs")
    .map(([testId]) => testId)
    .sort();
  const usefulTestIds = classifications
    .filter(([, classification]) => classification === "useful")
    .map(([testId]) => testId)
    .sort();
  const fallbackTestIds = classifications
    .filter(([, classification]) => classification === "unnecessary")
    .map(([testId]) => testId)
    .sort();
  const benchmarkTestIds = focusedRequiredTestIds.length > 0
    ? focusedRequiredTestIds
    : usefulTestIds.length > 0 ? usefulTestIds : fallbackTestIds;
  if (benchmarkTestIds.length === 0) {
    throw new Error(
      `C7 requires a manifest-bound focused test: ${casePackage.publicCaseId}`,
    );
  }
  const testId = benchmarkTestIds[0]!;
  const test = casePackage.medicalTests[testId];
  const displayName = test?.displayName?.trim() || testId;
  const aliases = test?.aliases?.filter((alias) => alias.trim().length > 0) ?? [];
  if (
    test === undefined || test.status !== "completed" ||
    typeof test.report !== "string" || test.report.trim().length === 0 ||
    displayName.length === 0
  ) {
    throw new Error(
      `C7 focused test metadata is incomplete: ${casePackage.publicCaseId}#${testId}`,
    );
  }
  return {
    testId,
    displayName,
    aliases: aliases.length > 0 ? aliases : [displayName],
    report: test.report,
  };
}

export function reconstructC7DialogueEvidence(input: {
  casePackages: readonly SupportedCasePackage[];
  caseBindings: readonly C7CaseBinding[];
  journeys: readonly C7RuntimeReleaseEvidence["dialogueJourneys"][number][];
  policy: C7DialogueReleasePolicy;
}): {
  runs: C7DialogueRunEvidence[];
  samples: Phase8PatientReplySampleV1[];
} {
  const casesById = new Map(
    input.casePackages.map((casePackage) => [casePackage.publicCaseId, casePackage] as const),
  );
  if (casesById.size !== input.casePackages.length) {
    throw new Error("C7 dialogue reconstruction requires unique cases.");
  }
  const bindingsById = new Map(
    input.caseBindings.map((binding) => [binding.publicCaseId, binding] as const),
  );
  if (
    bindingsById.size !== input.caseBindings.length ||
    input.caseBindings.length !== input.casePackages.length
  ) {
    throw new Error("C7 dialogue reconstruction requires unique manifest bindings.");
  }

  const runs: C7DialogueRunEvidence[] = [];
  const samples: Phase8PatientReplySampleV1[] = [];
  for (const journey of input.journeys) {
    const casePackage = casesById.get(journey.caseId);
    const binding = bindingsById.get(journey.caseId);
    if (
      casePackage === undefined ||
      binding === undefined ||
      casePackage.packageStatus !== (binding.packageStatus ?? "published") ||
      casePackage.caseVersion !== binding.caseVersion ||
      casePackage.provenance.contentHash !== binding.contentHash ||
      casePackage.caseVersion !== journey.caseVersion ||
      casePackage.provenance.contentHash !== journey.contentHash
    ) {
      throw new Error(`C7 journey case binding is invalid: ${journey.caseId}`);
    }
    const safeView = buildSafePatientCaseView(casePackage);
    const benchmarkTest = selectC7BenchmarkTestScenario(casePackage);
    if (safeView.patientProfile.templateId !== journey.personaTemplateId) {
      throw new Error(`C7 journey persona binding is invalid: ${journey.caseId}`);
    }
    const runStatus = journey.runStatus ?? "completed";
    if (
      !["completed", "failed_to_run", "not_run"].includes(runStatus) ||
      (runStatus === "completed" && journey.failureCode !== undefined) ||
      (runStatus !== "completed" &&
        (typeof journey.failureCode !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(journey.failureCode)))
    ) {
      throw new Error(`C7 journey run status is invalid: ${journey.caseId}`);
    }
    const uncommittedAttempt = journey.uncommittedAttempt ?? {
      patientProviderCalls: 0,
      controllerProviderCalls: 0,
    };
    if (
      (runStatus === "completed" && journey.uncommittedAttempt !== undefined) ||
      !Number.isSafeInteger(uncommittedAttempt.patientProviderCalls) ||
      uncommittedAttempt.patientProviderCalls < 0 ||
      !Number.isSafeInteger(uncommittedAttempt.controllerProviderCalls) ||
      uncommittedAttempt.controllerProviderCalls < 0
    ) {
      throw new Error(`C7 uncommitted Provider attempt is invalid: ${journey.caseId}`);
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
        if (
          normalizedDialogueText(turn.reply).includes(
            normalizedDialogueText(benchmarkTest.report),
          )
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

    if (
      runStatus === "completed" &&
      journey.turns.length < input.policy.minimumRealDialogueTurnsPerCase
    ) {
      throw new Error(
        `C7 journey is shorter than release policy: ${journey.caseId}`,
      );
    }
    const testAssessment = assessC7BenchmarkTestJourney({
      testId: benchmarkTest.testId,
      turns: journey.turns,
    });
    const patientGeneratedReplies = journey.turns.filter(
      ({ patientProviderCalls }) => patientProviderCalls > 0,
    ).length;
    runs.push({
      publicCaseId: journey.caseId,
      caseVersion: journey.caseVersion,
      contentHash: journey.contentHash,
      personaTemplateId: safeView.patientProfile.templateId,
      status: runStatus === "completed" ? "completed" : "failed",
      committedTurns: journey.turns.length,
      patientGeneratedReplies,
      patientProviderCalls: journey.turns.reduce(
        (sum, { patientProviderCalls }) => sum + patientProviderCalls,
        uncommittedAttempt.patientProviderCalls,
      ),
      controllerProviderCalls: journey.turns.reduce(
        (sum, { controllerProviderCalls }) => sum + controllerProviderCalls,
        uncommittedAttempt.controllerProviderCalls,
      ),
      localFakeReplies: journey.turns.length - patientGeneratedReplies,
      contextFollowupsEvaluated: [2, 7].filter(
        (index) => index < journey.turns.length,
      ).length,
      contextFollowupsCorrect,
      testActionsEvaluated: testAssessment.testActionsEvaluated,
      testActionsCorrect: testAssessment.testActionsCorrect,
      observedTestStates: testAssessment.observedTestStates,
      diagnosisLeaks,
      uncompletedTestResultLeaks,
      ...(runStatus === "completed" ? {} : { failureCode: journey.failureCode }),
    });
  }

  return { runs, samples };
}

export function collectC7RuntimeReleaseFindings(
  evidence: C7RuntimeReleaseEvidence,
): C7RuntimeFinding[] {
  const findings: C7RuntimeFinding[] = [];
  const findingKeys = new Set<string>();
  const manifestReviewStatusByScope = new Map<string, string>();
  const add = (code: string, scope: string, message: string): void => {
    const key = JSON.stringify([code, scope, message]);
    if (findingKeys.has(key)) return;
    findingKeys.add(key);
    findings.push({ code, scope, message });
  };
  if (evidence.caseManifest.publishedCases.length !== evidence.releasePolicy.expectedCaseCount) {
    add(
      "CASE_COUNT_MISMATCH",
      "case-manifest",
      `expected ${evidence.releasePolicy.expectedCaseCount} cases, found ${evidence.caseManifest.publishedCases.length}`,
    );
  }
  for (const binding of evidence.caseManifest.publishedCases) {
    const reviewStatus = binding.reviewStatus ?? "approved";
    if (reviewStatus !== "approved") {
      manifestReviewStatusByScope.set(binding.publicCaseId, reviewStatus);
      add(
        "CASE_AI_REVIEW_NOT_APPROVED",
        binding.publicCaseId,
        `manifest review status: ${reviewStatus}`,
      );
    }
  }
  for (const finding of evidence.aiIndex.reviewFindings ?? []) {
    if (
      finding.code === "CASE_AI_REVIEW_NOT_APPROVED" &&
      manifestReviewStatusByScope.get(finding.scope) === finding.decision
    ) {
      continue;
    }
    add(finding.code, finding.scope, `AI review decision: ${finding.decision}`);
  }
  for (const finding of evidence.dialogueReport.findings) {
    add(finding.code, "dialogue-architecture", finding.message);
  }
  if (evidence.dialogueApproval.decision !== "approved") {
    add(
      "PROVIDER_MODEL_APPROVAL_NOT_APPROVED",
      "provider-model-approval",
      `provider/model decision: ${evidence.dialogueApproval.decision}`,
    );
  }
  if (evidence.c7Acceptance.status !== "passed") {
    add(
      "C7_ACCEPTANCE_FAILED",
      "c7-acceptance",
      `acceptance status: ${evidence.c7Acceptance.status}`,
    );
  }
  for (const [field, covered] of Object.entries({
    persistenceCovered: evidence.c7Acceptance.persistenceCovered,
    idempotencyCovered: evidence.c7Acceptance.idempotencyCovered,
    recoveryCovered: evidence.c7Acceptance.recoveryCovered,
    providerFailureCovered: evidence.c7Acceptance.providerFailureCovered,
  })) {
    if (!covered) {
      add(
        "C7_ACCEPTANCE_COVERAGE_MISSING",
        "c7-acceptance",
        `${field} is false`,
      );
    }
  }
  if (evidence.c7Acceptance.verification.exitCode !== 0) {
    add(
      "C7_ACCEPTANCE_EXIT_NONZERO",
      "c7-acceptance",
      `test exit code: ${String(evidence.c7Acceptance.verification.exitCode)}`,
    );
  }
  return findings;
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
    releasePolicy,
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
    aiIndex.caseValidations.length !== aiIndex.publishedArtifacts.length ||
    aiIndex.publishedArtifacts.length !== caseManifest.publishedCases.length ||
    validationIds.size !== aiIndex.caseValidations.length ||
    publishedKeys.size !== aiIndex.publishedArtifacts.length ||
    manifestKeys.size !== caseManifest.publishedCases.length ||
    publishedCasePackages.length !== caseManifest.publishedCases.length ||
    publishedCasePackagesById.size !== publishedCasePackages.length ||
    [...manifestKeys].some((key) => !publishedKeys.has(key)) ||
    caseManifest.publishedCases.some((binding) => {
      const casePackage = publishedCasePackagesById.get(binding.publicCaseId);
      return casePackage === undefined ||
        casePackage.packageStatus !== (binding.packageStatus ?? "published") ||
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
    issues.push("consistently bound manifest-listed cases are required");
  }
  for (const validation of aiIndex.caseValidations) {
    assertEvidencePath(validation.path, "evaluation/phase8/", "case validation", issues);
  }
  for (const artifact of aiIndex.publishedArtifacts) {
    assertEvidencePath(artifact.path, "published/", "published case", issues);
    const reviewStatus = artifact.reviewStatus ?? "approved";
    if (reviewStatus === "missing") {
      if (artifact.validationRecordPath !== undefined) {
        issues.push("missing review status must not bind a validation record");
      }
    } else if (artifact.validationRecordPath === undefined) {
      issues.push("non-missing review status requires a validation record");
    } else {
      assertEvidencePath(
        artifact.validationRecordPath,
        "published/",
        "published validation",
        issues,
      );
    }
  }

  if (
    dialogueReport.schemaVersion !== "c7-dialogue-architecture-report-v2" ||
    dialogueReport.status !== "reported" ||
    dialogueReport.reviewPolicy !== "non_blocking" ||
    dialogueReport.releasePolicyVersion !== releasePolicy.policyVersion
  ) {
    issues.push("dialogue architecture report policy binding is invalid");
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
  const expectedDialogueSampleIds = [...new Set(
    dialogueSampleSet.samples.map(({ sampleId }) => sampleId),
  )].sort();
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
  let invalidJourney =
    new Set(dialogueJourneys.map(({ caseId }) => caseId)).size !==
      dialogueJourneys.length;
  for (const journey of dialogueJourneys) {
    const caseBinding = caseManifest.publishedCases.find(
      ({ publicCaseId }) => publicCaseId === journey.caseId,
    );
    const reportRun = dialogueReport.runs.find(
      ({ publicCaseId }) => publicCaseId === journey.caseId,
    );
    const runStatus = journey.runStatus ?? "completed";
    if (
      journey.schemaVersion !== "c7-private-dialogue-journey-v1" ||
      caseBinding === undefined ||
      reportRun === undefined ||
      journey.caseVersion !== caseBinding.caseVersion ||
      journey.contentHash !== caseBinding.contentHash ||
      !["completed", "failed_to_run", "not_run"].includes(runStatus) ||
      (runStatus === "completed" &&
        (journey.failureCode !== undefined || journey.turns.length === 0)) ||
      (runStatus !== "completed" &&
        (typeof journey.failureCode !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(journey.failureCode)))
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
      caseBindings: caseManifest.publishedCases,
      journeys: dialogueJourneys,
      policy: releasePolicy,
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
      recomputedNaturalAndRoleRate = dialogueAudit.sampleCount === 0
        ? 0
        : naturalAndRoleConsistent / dialogueAudit.sampleCount;
    }
    const expectedDecision = seriousErrors === 0 &&
      unauthorizedFactLeaks === 0 &&
      diagnosisLeaks === 0 &&
      unknownAsAbsentErrors === 0 &&
      (validation.role !== "language_role_auditor" ||
        (dialogueAudit.sampleCount > 0 &&
          naturalAndRoleConsistent / dialogueAudit.sampleCount >= 0.95))
      ? "approved"
      : "rejected";
    const expectedValidatorId = validation.role === "fact_safety_auditor"
      ? "validator.ai.patient-fact-safety.v1"
      : "validator.ai.patient-language-role.v1";
    const expectedPromptVersion = validation.role === "fact_safety_auditor"
      ? "patient-fact-safety-auditor-v2"
      : "patient-language-role-auditor-v2";
    const runStatus = validation.runStatus ?? "completed";
    const failedToRun = runStatus === "failed_to_run";
    const commonInvalid = !expectedDialogueRoles.has(validation.role) ||
      validation.validatorId !== expectedValidatorId ||
      validation.promptVersion !== expectedPromptVersion ||
      validation.modelId !== (
        failedToRun
          ? aiIndex.provider.configuredModelId
          : aiIndex.provider.actualModelId
      ) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(validation.validationRunId) ||
      !isExactIsoDate(validation.validatedAt) ||
      validation.assessedSamples !== validation.assessments.length ||
      validation.assessedSamples > dialogueAudit.sampleCount ||
      invalidAssessmentTypes ||
      uniqueSampleIds.size !== validation.assessments.length ||
      [...uniqueSampleIds].some((sampleId) => !samplesById.has(sampleId)) ||
      !Number.isInteger(validation.subcallCount) || validation.subcallCount < 0 ||
      !Array.isArray(validation.providerRequestIds) ||
      validation.providerRequestIds.length > validation.subcallCount ||
      new Set(validation.providerRequestIds).size !== validation.providerRequestIds.length ||
      validation.providerRequestIds.some((requestId) =>
        typeof requestId !== "string" || requestId.length === 0) ||
      !Number.isInteger(validation.usage.inputTokens) ||
      validation.usage.inputTokens < 0 ||
      !Number.isInteger(validation.usage.outputTokens) ||
      validation.usage.outputTokens < 0 ||
      validation.usage.totalTokens !==
        validation.usage.inputTokens + validation.usage.outputTokens ||
      validation.seriousErrors !== seriousErrors ||
      validation.unauthorizedFactLeaks !== unauthorizedFactLeaks ||
      validation.diagnosisLeaks !== diagnosisLeaks ||
      validation.unknownAsAbsentErrors !== unknownAsAbsentErrors ||
      validation.naturalAndRoleConsistent !== naturalAndRoleConsistent ||
      validation.isolation.independentInvocation !== true ||
      validation.isolation.counterpartOutputVisible !== false;
    if (commonInvalid) return true;
    if (failedToRun) {
      const insufficientSamples =
        validation.failureCode === "INSUFFICIENT_PATIENT_SAMPLES";
      return validation.decision !== "not_run" ||
        (insufficientSamples
          ? validation.assessedSamples !== 0 ||
            validation.subcallCount !== 0 ||
            validation.assessments.length !== 0 ||
            dialogueAudit.sampleCount >=
              releasePolicy.expectedCaseCount *
                releasePolicy.minimumRealDialogueTurnsPerCase
          : validation.assessedSamples >= dialogueAudit.sampleCount) ||
        typeof validation.failureCode !== "string" ||
        validation.failureCode.trim().length === 0;
    }
    return !expectedDialogueRoles.has(validation.role) ||
      runStatus !== "completed" ||
      validation.failureCode !== undefined ||
      validation.assessedSamples !== dialogueAudit.sampleCount ||
      validation.assessments.length !== dialogueAudit.sampleCount ||
      uniqueSampleIds.size !== dialogueAudit.sampleCount ||
      JSON.stringify([...uniqueSampleIds].sort()) !==
        JSON.stringify(expectedDialogueSampleIds) ||
      validation.subcallCount < 1 ||
      validation.decision !== expectedDecision;
  });
  const expectedDialogueAuditDecision = dialogueAudit.validations.some(
    ({ runStatus }) => runStatus === "failed_to_run",
  )
    ? "not_run"
    : dialogueAudit.validations.every(({ decision }) => decision === "approved")
      ? "approved"
      : "rejected";
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
      policy: releasePolicy,
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
    JSON.stringify(dialogueReport.findings) ===
      JSON.stringify(recomputedDialogueReport.findings);
  if (
    dialogueAudit.schemaVersion !== "phase8-patient-sample-ai-validation-v1" ||
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
    dialogueAudit.validations.length !== 2 ||
    dialogueRoles.size !== expectedDialogueRoles.size ||
    [...expectedDialogueRoles].some((role) => !dialogueRoles.has(role)) ||
    invalidDialogueValidation ||
    dialogueAudit.decision !== expectedDialogueAuditDecision ||
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
    !["approved", "revision_recommended", "rejected", "not_run"].includes(
      dialogueApproval.decision,
    ) ||
    Number.isNaN(Date.parse(dialogueApproval.decidedAt)) ||
    dialogueApproval.decisionRef.trim().length === 0 ||
    !sameUpstreamProvider(aiIndex.provider, dialogueReport.provider) ||
    !sameUpstreamProvider(aiIndex.provider, dialogueApproval.provider) ||
    dialogueReport.provider.promptVersion !== dialogueApproval.provider.promptVersion ||
    !/^v\d+\.\d+\.\d+\+set\.[a-f0-9]{16}$/u.test(
      dialogueReport.provider.promptVersion ?? "",
    ) ||
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
    !["passed", "failed"].includes(c7Acceptance.status) ||
    typeof c7Acceptance.persistenceCovered !== "boolean" ||
    typeof c7Acceptance.idempotencyCovered !== "boolean" ||
    typeof c7Acceptance.recoveryCovered !== "boolean" ||
    typeof c7Acceptance.providerFailureCovered !== "boolean" ||
    (c7Acceptance.verification.exitCode !== 0 &&
      c7Acceptance.verification.exitCode !== 1)
  ) {
    issues.push("C7 acceptance evidence structure is invalid");
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

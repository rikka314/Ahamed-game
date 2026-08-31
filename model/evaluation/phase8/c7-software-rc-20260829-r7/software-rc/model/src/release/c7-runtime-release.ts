import type {
  Phase8PatientSampleAiValidationV1,
  Phase8SafetyCorpusAiValidationV1,
} from "../evaluation/phase8-ai-evidence.js";
import {
  assertPhase8CaseValidation,
  type Phase8CaseValidationBinding,
  type Phase8CaseValidationV2,
} from "./phase8-release.js";

const HEX_SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

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
    runs: Array<{
      publicCaseId: string;
      committedTurns: number;
      status: string;
    }>;
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
    corpusHash: string;
    holdoutHash: string;
    templateRegistryHash: string;
    totalSamples: number;
    holdoutSamples: number;
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
    const expectedDecision = labelDisagreements === 0 && seriousErrors === 0
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
      JSON.stringify([...uniqueAssessmentIds].sort()) !== JSON.stringify(firstSampleIds) ||
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

export function assertC7RuntimeReleaseEvidence(evidence: C7RuntimeReleaseEvidence): void {
  const issues: string[] = [];
  const {
    aiIndex,
    caseManifest,
    dialogueAudit,
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
  if (
    aiIndex.caseValidations.length !== 5 ||
    aiIndex.publishedArtifacts.length !== 5 ||
    caseManifest.publishedCases.length !== 5 ||
    validationIds.size !== 5 ||
    publishedKeys.size !== 5 ||
    manifestKeys.size !== 5 ||
    [...manifestKeys].some((key) => !publishedKeys.has(key)) ||
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
  const invalidDialogueValidation = dialogueAudit.validations.some((validation) => {
    const sampleIds = validation.assessments.map(({ sampleId }) => sampleId);
    const uniqueSampleIds = new Set(sampleIds);
    const seriousErrors = validation.assessments.filter(
      ({ seriousError, factGrounded }) =>
        seriousError || (validation.role === "fact_safety_auditor" && !factGrounded),
    ).length;
    const unauthorizedFactLeaks = validation.assessments.filter(
      ({ unauthorizedFactLeak }) => unauthorizedFactLeak,
    ).length;
    const diagnosisLeaks = validation.assessments.filter(({ diagnosisLeak }) => diagnosisLeak).length;
    const unknownAsAbsentErrors = validation.assessments.filter(
      ({ unknownAsAbsent }) => unknownAsAbsent,
    ).length;
    const naturalAndRoleConsistent = validation.assessments.filter(
      ({ naturalChinese, roleConsistent }) => naturalChinese && roleConsistent,
    ).length;
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
      uniqueSampleIds.size !== dialogueAudit.sampleCount ||
      JSON.stringify([...uniqueSampleIds].sort()) !== JSON.stringify(firstDialogueSampleIds) ||
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
  if (
    dialogueAudit.schemaVersion !== "phase8-patient-sample-ai-validation-v1" ||
    dialogueAudit.decision !== "approved" ||
    !HEX_SHA256_PATTERN.test(dialogueAudit.candidateRunSetSha256) ||
    !HEX_SHA256_PATTERN.test(dialogueAudit.sampleSetSha256) ||
    dialogueAudit.candidateRunSetSha256 !== dialogueReport.runSetSha256 ||
    dialogueAudit.sampleCount !== 60 ||
    dialogueAudit.validations.length !== 2 ||
    dialogueRoles.size !== expectedDialogueRoles.size ||
    [...expectedDialogueRoles].some((role) => !dialogueRoles.has(role)) ||
    invalidDialogueValidation ||
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
    new Set(c7Acceptance.testFiles.map(({ path }) => path)).size !== c7Acceptance.testFiles.length ||
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

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertC7CaseValidationEvidence,
  assertC7RuntimeReleaseEvidence,
  assertC7SafetyCorpusEvidence,
  assertSoftwareRcArtifactPath,
  type C7RuntimeReleaseEvidence,
} from "../src/release/c7-runtime-release.js";
import type { Phase8SafetyCorpusAiValidationV1 } from "../src/evaluation/phase8-ai-evidence.js";
import type { Phase8CaseValidationV2 } from "../src/release/phase8-release.js";

const HASH = "1".repeat(64);
const PROMPT_VERSION = `v0.2.0+set.${"f".repeat(16)}`;

function approvedEvidence(): C7RuntimeReleaseEvidence {
  const cases = Array.from({ length: 5 }, (_, index) => {
    const publicCaseId = `case-${index + 1}`;
    return {
      publicCaseId,
      caseVersion: "1.0.0-draft.1",
      contentHash: `sha256:${String(index + 1).repeat(64)}`,
      path: `published/dialogue-rc/${publicCaseId}.json`,
      validationRecordPath: `published/dialogue-rc/${publicCaseId}.validation.json`,
    };
  });
  const provider = {
    providerName: "openai-compatible.test",
    protocol: "openai-responses",
    endpointSha256: "a".repeat(64),
    configuredModelId: "model-test",
    actualModelId: "model-test-snapshot",
  };
  return {
    aiIndexSha256: HASH,
    caseManifestSha256: "6".repeat(64),
    caseValidationSetSha256: "2".repeat(64),
    patientPromptSha256: "3".repeat(64),
    shareContractSha256: "4".repeat(64),
    dialogueAuditSha256: "5".repeat(64),
    aiIndex: {
      schemaVersion: "phase8-ai-evidence-index-v1",
      supersededInputExcluded: true,
      provider,
      caseValidations: cases.map((entry, index) => ({
        publicCaseId: entry.publicCaseId,
        caseVersion: entry.caseVersion,
        contentHash: entry.contentHash,
        path: `evaluation/phase8/c7-ai/case-validations/case-${index + 1}.json`,
        sha256: "b".repeat(64),
      })),
      publishedArtifacts: cases,
    },
    caseManifest: { publishedCases: cases },
    dialogueAudit: {
      schemaVersion: "phase8-patient-sample-ai-validation-v1",
      decision: "approved",
      validations: ["fact_safety_auditor", "language_role_auditor"].map((role) => ({
        role,
        modelId: provider.actualModelId,
        decision: "approved",
        assessedSamples: 60,
      })),
    },
    dialogueReport: {
      schemaVersion: "c7-dialogue-architecture-report-v1",
      provider: { ...provider, promptVersion: PROMPT_VERSION },
      bindings: {
        aiEvidenceIndexSha256: HASH,
        caseManifestSha256: "6".repeat(64),
        caseValidationSetSha256: "2".repeat(64),
        patientPromptSha256: "3".repeat(64),
        shareContractSha256: "4".repeat(64),
        dialogueAuditSha256: "5".repeat(64),
      },
      coverage: {
        caseCount: 5,
        personaCount: 3,
        minimumTurnsPerRun: 12,
        observedTestStates: ["not_completed", "pending_confirmation", "completed"],
      },
      metrics: {
        patientGeneratedReplyRate: 1,
        controllerProviderCalls: 0,
        localFakeReplies: 0,
        diagnosisLeaks: 0,
        uncompletedTestResultLeaks: 0,
        personaConsistencyRate: 0.95,
        contextFollowupAccuracy: 0.95,
        naturalLanguageTestActionAccuracy: 0.95,
        seriousFactErrors: 0,
      },
      auditDecision: "approved",
      gate: { status: "passed", blockers: [] },
      runs: cases.map(({ publicCaseId }) => ({
        publicCaseId,
        committedTurns: 12,
        status: "completed",
      })),
    },
    dialogueApproval: {
      schemaVersion: "c7-provider-model-approval-v1",
      decision: "approved",
      decisionRef: "c7.dialogue-architecture.test",
      decidedAt: "2026-08-28T12:00:00.000Z",
      provider: { ...provider, promptVersion: PROMPT_VERSION },
      report: { path: "report.json", sha256: "c".repeat(64) },
      audit: { path: "audit.json", sha256: "5".repeat(64) },
    },
    c6Acceptance: {
      schemaVersion: "c6-cli-acceptance-evidence-v1",
      status: "passed",
      journeyCount: 3,
      committedTurns: 36,
      providerFailure: {
        code: "MODEL_UNAVAILABLE",
        fakePatientReplies: 0,
        committedTurns: 0,
      },
    },
    c7Acceptance: {
      schemaVersion: "c7-runtime-acceptance-evidence-v1",
      status: "passed",
      persistenceCovered: true,
      idempotencyCovered: true,
      recoveryCovered: true,
      providerFailureCovered: true,
      testFiles: [{ path: "tests/c7-runtime-release.test.ts", sha256: "e".repeat(64) }],
    },
    securityScan: {
      schemaVersion: "phase8-security-scan-report-v1",
      status: "passed",
      secretFindings: [],
      hiddenFieldFindings: [],
      blockers: [],
    },
  };
}

test("C7 runtime release accepts only the complete bound dialogue evidence chain", () => {
  assert.doesNotThrow(() => assertC7RuntimeReleaseEvidence(approvedEvidence()));
});

test("C7 runtime release fails closed on evidence, metric, path, or model drift", () => {
  for (const mutate of [
    (candidate: C7RuntimeReleaseEvidence) => { candidate.aiIndex.supersededInputExcluded = false; },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.dialogueReport.metrics.patientGeneratedReplyRate = 0.99; },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.dialogueReport.metrics.contextFollowupAccuracy = 0.94; },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.dialogueReport.metrics.uncompletedTestResultLeaks = 1; },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.dialogueApproval.provider.actualModelId = "drifted-model"; },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.dialogueAudit.validations[0]!.modelId = "drifted-model"; },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.dialogueReport.bindings.aiEvidenceIndexSha256 = "9".repeat(64); },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.dialogueReport.bindings.caseManifestSha256 = "9".repeat(64); },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.dialogueReport.bindings.patientPromptSha256 = "9".repeat(64); },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.dialogueReport.bindings.shareContractSha256 = "9".repeat(64); },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.dialogueReport.bindings.dialogueAuditSha256 = "9".repeat(64); },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.aiIndex.publishedArtifacts[0]!.path = "published/../../.env"; },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.caseManifest.publishedCases[0]!.contentHash = `sha256:${"9".repeat(64)}`; },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.c6Acceptance.providerFailure.fakePatientReplies = 1; },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.c7Acceptance.recoveryCovered = false; },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.securityScan.blockers.push("secret:test.json"); },
  ]) {
    const candidate = structuredClone(approvedEvidence());
    mutate(candidate);
    assert.throws(
      () => assertC7RuntimeReleaseEvidence(candidate),
      /C7 runtime release evidence failed/u,
    );
  }
});

test("Software RC artifact paths reject traversal, secrets, databases and private evidence", () => {
  for (const path of [
    "model/cases/published/../../.env",
    "model/.env",
    "model/.env.local",
    "model/var/session.db",
    "model/var/session.db-wal",
    "model/evaluation/phase8/run/private/audit.json",
    "model\\src\\cli\\main.ts",
    "C:/repo/model/src/cli/main.ts",
    "../model/src/cli/main.ts",
  ]) {
    assert.throws(() => assertSoftwareRcArtifactPath(path), /unsafe Software RC/u);
  }
  for (const path of [
    "model/src/cli/main.ts",
    "model/tests/c7-runtime-release.test.ts",
    "model/cases/manifest.dialogue-rc.v1-rc1.json",
    "model/package-lock.json",
    "share/contracts/v1/index.ts",
    "share/package.json",
  ]) {
    assert.doesNotThrow(() => assertSoftwareRcArtifactPath(path));
  }
});

test("C7 semantic evidence gates reject rehashed but rejected case and safety decisions", () => {
  const checks = {
    clinicalConsistency: "pass",
    diagnosisSolvability: "pass",
    redFlagExclusions: "pass",
    rubricConsistency: "pass",
    regressionCoverage: "pass",
    hiddenTruthSafety: "pass",
  } as const;
  const caseValidation: Phase8CaseValidationV2 = {
    schemaVersion: "ai-case-cross-validation-v2",
    caseId: "case-internal-1",
    caseVersion: "1.0.0",
    contentHash: `sha256:${"a".repeat(64)}`,
    decision: "approved",
    validations: ["clinical_safety", "diagnostic_quality"].map((role, index) => ({
      validatorId: `validator-${index}`,
      role: role as "clinical_safety" | "diagnostic_quality",
      modelId: "model-approved",
      promptVersion: role.replace("_", "-"),
      validationRunId: `run-${index}`,
      isolation: { independentInvocation: true, counterpartOutputVisible: false },
      decision: "approved",
      validatedAt: "2026-08-29T00:00:00.000Z",
      checks,
      findings: ["passed"],
    })),
  };
  assert.doesNotThrow(() => assertC7CaseValidationEvidence(
    caseValidation,
    {
      caseId: caseValidation.caseId,
      caseVersion: caseValidation.caseVersion,
      contentHash: caseValidation.contentHash,
    },
    "model-approved",
  ));
  const rejectedCase = structuredClone(caseValidation);
  rejectedCase.decision = "rejected";
  assert.throws(
    () => assertC7CaseValidationEvidence(
      rejectedCase,
      {
        caseId: rejectedCase.caseId,
        caseVersion: rejectedCase.caseVersion,
        contentHash: rejectedCase.contentHash,
      },
      "model-approved",
    ),
    /validation failed/u,
  );

  const safety: Phase8SafetyCorpusAiValidationV1 = {
    schemaVersion: "phase8-safety-corpus-ai-validation-v1",
    datasetVersion: "dataset-v1",
    corpusHash: "a".repeat(64),
    holdoutHash: "b".repeat(64),
    policyVersion: "policy-v1",
    templateRegistryHash: "c".repeat(64),
    totalSamples: 1,
    holdoutSamples: 1,
    decision: "approved",
    validations: ["safety_label_auditor", "adversarial_expression_auditor"].map(
      (role, index) => ({
        validatorId: `safety-${index}`,
        role: role as "safety_label_auditor" | "adversarial_expression_auditor",
        modelId: "model-approved",
        promptVersion: `safety-${index}`,
        validationRunId: `safety-run-${index}`,
        isolation: { independentInvocation: true, counterpartOutputVisible: false },
        validatedAt: "2026-08-29T00:00:00.000Z",
        decision: "approved",
        assessedSamples: 1,
        labelDisagreements: 0,
        seriousErrors: 0,
        subcallCount: 1,
        providerRequestIds: [],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        assessments: [{
          sampleId: "sample-1",
          recommendedDecision: "ALLOW_GAME",
          labelAgreement: true,
          seriousError: false,
          expressionNatural: true,
          notes: "passed",
        }],
      }),
    ),
  };
  const expected = {
    actualModelId: "model-approved",
    corpusHash: safety.corpusHash,
    holdoutHash: safety.holdoutHash,
    templateRegistryHash: safety.templateRegistryHash,
    totalSamples: 1,
    holdoutSamples: 1,
  };
  assert.doesNotThrow(() => assertC7SafetyCorpusEvidence(safety, expected));
  const rejectedSafety = structuredClone(safety);
  rejectedSafety.decision = "rejected";
  assert.throws(
    () => assertC7SafetyCorpusEvidence(rejectedSafety, expected),
    /semantic gate/u,
  );
});

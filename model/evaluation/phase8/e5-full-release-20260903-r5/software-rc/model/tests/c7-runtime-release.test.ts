import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  migrateCasePackageV1ToV2,
} from "../src/domain/case-package.js";
import {
  DIALOGUE_RELEASE_MANIFEST_PATH,
  loadDialogueCandidateCasePackages,
} from "../src/cli/case-loader.js";
import { loadCaseManifestV2 } from "../src/cases/case-manifest.js";
import {
  assertC7CaseValidationEvidence,
  assertC7RuntimeReleaseEvidence,
  assertC7SafetyCorpusEvidence,
  assertSoftwareRcArtifactPath,
  collectC7RuntimeReleaseFindings,
  C7_ACCEPTANCE_TEST_PATHS,
  reconstructC7DialogueEvidence,
  type C7RuntimeReleaseEvidence,
} from "../src/release/c7-runtime-release.js";
import type {
  Phase8PatientSampleAiValidationV1,
  Phase8PatientReplySampleV1,
  Phase8SafetyCorpusAiValidationV1,
} from "../src/evaluation/phase8-ai-evidence.js";
import {
  buildC7DialogueArchitectureReport,
  toC7DialogueReleasePolicy,
} from
  "../src/evaluation/c7-dialogue-architecture-benchmark.js";
import {
  sha256Canonical,
  type Phase8CaseValidationV2,
} from "../src/release/phase8-release.js";
import { scanRuntimeArtifactSet } from "../src/release/runtime-artifact-security.js";
import { createCaseV2Fixture } from "./fixtures/case-v2-fixture.js";

const HASH = "1".repeat(64);
const PROMPT_VERSION = `v0.2.0+set.${"f".repeat(16)}`;
const RELEASE_POLICY = toC7DialogueReleasePolicy(
  loadCaseManifestV2("cases/manifest.phase6-compat.v2-rc1.json").releasePolicy,
);

function approvedDialogueAudit(
  actualModelId: string,
  runSetSha256: string,
  samples: readonly Phase8PatientReplySampleV1[],
): Phase8PatientSampleAiValidationV1 {
  const assessments = samples.map(({ sampleId }) => ({
    sampleId,
    factGrounded: true,
    unauthorizedFactLeak: false,
    diagnosisLeak: false,
    unknownAsAbsent: false,
    naturalChinese: true,
    roleConsistent: true,
    seriousError: false,
    notes: "passed",
  }));
  return {
    schemaVersion: "phase8-patient-sample-ai-validation-v1",
    candidateRunSetSha256: runSetSha256,
    sampleSetSha256: sha256Canonical(samples),
    sampleCount: samples.length,
    decision: "approved",
    factOrSafetySeriousErrors: 0,
    naturalAndRoleConsistentRate: 1,
    validations: (["fact_safety_auditor", "language_role_auditor"] as const).map(
      (role, index) => ({
        validatorId: role === "fact_safety_auditor"
          ? "validator.ai.patient-fact-safety.v1"
          : "validator.ai.patient-language-role.v1",
        role,
        modelId: actualModelId,
        promptVersion: role === "fact_safety_auditor"
          ? "patient-fact-safety-auditor-v2"
          : "patient-language-role-auditor-v2",
        validationRunId: `run-${index}`,
        isolation: { independentInvocation: true, counterpartOutputVisible: false },
        validatedAt: "2026-08-29T00:00:00.000Z",
        decision: "approved",
        assessedSamples: samples.length,
        seriousErrors: 0,
        unauthorizedFactLeaks: 0,
        diagnosisLeaks: 0,
        unknownAsAbsentErrors: 0,
        naturalAndRoleConsistent: samples.length,
        subcallCount: 1,
        providerRequestIds: [],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        assessments: structuredClone(assessments),
      }),
    ),
  };
}

function approvedEvidence(): C7RuntimeReleaseEvidence {
  const publishedCasePackages = loadDialogueCandidateCasePackages(resolve("."));
  const cases = publishedCasePackages.map((casePackage) => ({
    publicCaseId: casePackage.publicCaseId,
    caseVersion: casePackage.caseVersion,
    contentHash: casePackage.provenance.contentHash!,
    path: `published/dialogue-rc/${casePackage.publicCaseId}.json`,
    validationRecordPath: `published/dialogue-rc/${casePackage.publicCaseId}.validation.json`,
    packageStatus: "published" as const,
    reviewStatus: "approved" as const,
  }));
  const provider = {
    providerName: "openai-compatible.test",
    protocol: "openai-responses",
    endpointSha256: "a".repeat(64),
    configuredModelId: "model-test",
    actualModelId: "model-test-snapshot",
  };
  const dialogueJourneys: C7RuntimeReleaseEvidence["dialogueJourneys"] =
    publishedCasePackages.map((casePackage) => {
      const disclosedFactId = Object.keys(casePackage.patientFacts)[0]!;
      const chestCtReport = casePackage.medicalTests["test.chest_ct"]?.report;
      if (chestCtReport === undefined) {
        throw new Error(`Missing fixture CT report: ${casePackage.publicCaseId}`);
      }
      return {
      schemaVersion: "c7-private-dialogue-journey-v1",
      caseId: casePackage.publicCaseId,
      caseVersion: casePackage.caseVersion,
      contentHash: casePackage.provenance.contentHash!,
      personaTemplateId: casePackage.patientPersona.personaTemplateId!,
      turns: Array.from({ length: 12 }, (_, turnIndex) => ({
        turnNumber: turnIndex + 1,
        question: `${casePackage.publicCaseId}-question-${turnIndex + 1}`,
        reply: turnIndex === 11
          ? `${casePackage.publicCaseId}: ${chestCtReport}`
          : `${casePackage.publicCaseId}-reply-${turnIndex + 1}`,
        disclosedFactIds: [0, 2, 7].includes(turnIndex) ? [disclosedFactId] : [],
        interactionKind: turnIndex === 9
          ? "test_query"
          : turnIndex === 10
          ? "test_confirmation"
          : "medical_chat",
        personaFactIdsUsed: [],
        completedTestIdsUsed: turnIndex === 11 ? ["test.chest_ct"] : [],
        effects: turnIndex === 8
          ? [{
              type: "test_completed",
              result: { testId: "test.vital_signs", report: "fixture vital report" },
            }]
          : turnIndex === 10
          ? [{
              type: "test_completed",
              result: { testId: "test.chest_ct", report: chestCtReport },
            }]
          : [],
        patientProviderCalls: 1,
        controllerProviderCalls: 0,
        sessionSnapshotBeforeTurn: turnIndex === 10
          ? {
              pendingTestSuggestionId: "test.chest_ct",
              completedTests: [],
            }
          : turnIndex === 11
          ? {
              completedTests: [{
                testId: "test.chest_ct",
                status: "completed" as const,
                report: chestCtReport,
              }],
            }
          : { completedTests: [] },
      })),
      };
    });
  const { runs, samples } = reconstructC7DialogueEvidence({
    casePackages: publishedCasePackages,
    caseBindings: cases,
    journeys: dialogueJourneys,
    policy: RELEASE_POLICY,
  });
  const runSetSha256 = sha256Canonical(runs);
  const dialogueAudit = approvedDialogueAudit(
    provider.actualModelId,
    runSetSha256,
    samples,
  );
  const recomputedReport = buildC7DialogueArchitectureReport({
    runs,
    policy: RELEASE_POLICY,
    audit: {
      decision: "approved",
      personaConsistencyRate: 1,
      seriousFactErrors: 0,
      diagnosisLeaks: 0,
      uncompletedTestResultLeaks: 0,
    },
    generatedAt: "2026-08-29T00:00:00.000Z",
  });
  return {
    releasePolicy: structuredClone(RELEASE_POLICY),
    aiIndexSha256: HASH,
    caseManifestSha256: "6".repeat(64),
    caseValidationSetSha256: "2".repeat(64),
    patientPromptSha256: "3".repeat(64),
    shareContractSha256: "4".repeat(64),
    dialogueAuditSha256: "5".repeat(64),
    dialogueJourneySetSha256: sha256Canonical(
      [...dialogueJourneys].sort((left, right) => left.caseId.localeCompare(right.caseId)),
    ),
    publishedCasePackages,
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
    dialogueAudit,
    dialogueSampleSet: {
      schemaVersion: "c7-private-patient-sample-set-v1",
      runSetSha256,
      sampleSetSha256: sha256Canonical(samples),
      sampleCount: samples.length,
      samples,
    },
    dialogueJourneys,
    dialogueReport: {
      ...recomputedReport,
      runSetSha256,
      provider: { ...provider, promptVersion: PROMPT_VERSION },
      bindings: {
        aiEvidenceIndexSha256: HASH,
        caseManifestSha256: "6".repeat(64),
        caseValidationSetSha256: "2".repeat(64),
        patientPromptSha256: "3".repeat(64),
        shareContractSha256: "4".repeat(64),
        dialogueAuditSha256: "5".repeat(64),
      },
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
      verification: { exitCode: 0 },
      sourceBindings: {
        testSha256: "1".repeat(64),
        providerSha256: "2".repeat(64),
        outputGateSha256: "3".repeat(64),
        modelServiceSha256: "4".repeat(64),
        candidateManifestSha256: "5".repeat(64),
        caseLoaderSha256: "6".repeat(64),
        releaseManifestSha256: "7".repeat(64),
      },
    },
    c7Acceptance: {
      schemaVersion: "c7-runtime-acceptance-evidence-v1",
      status: "passed",
      persistenceCovered: true,
      idempotencyCovered: true,
      recoveryCovered: true,
      providerFailureCovered: true,
      testFiles: C7_ACCEPTANCE_TEST_PATHS.map((path) => ({
        path,
        sha256: "e".repeat(64),
      })),
      verification: { exitCode: 0 },
    },
    securityScan: {
      schemaVersion: "phase8-security-scan-report-v1",
      status: "passed",
      scannedRoots: ["model", "share"],
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
    (candidate: C7RuntimeReleaseEvidence) => { candidate.dialogueAudit.candidateRunSetSha256 = "0".repeat(64); },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.dialogueAudit.sampleSetSha256 = "0".repeat(64); },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.dialogueSampleSet.samples[0]!.reply = "tampered"; },
    (candidate: C7RuntimeReleaseEvidence) => {
      candidate.dialogueSampleSet.samples[0]!.authorizedFacts[0]!.value = "forged fact";
    },
    (candidate: C7RuntimeReleaseEvidence) => {
      candidate.dialogueSampleSet.samples[0]!.authorizedPersonaFacts!.push({
        personaFactId: "persona.forged",
        value: "forged persona",
      });
    },
    (candidate: C7RuntimeReleaseEvidence) => {
      candidate.dialogueSampleSet.samples[0]!.authorizedTests![0]!.displayName = "forged test";
    },
    (candidate: C7RuntimeReleaseEvidence) => {
      candidate.dialogueSampleSet.samples[11]!.authorizedTestReports![0]!.report = "forged report";
    },
    (candidate: C7RuntimeReleaseEvidence) => {
      candidate.dialogueSampleSet.samples[0]!.forbiddenDiagnosisTerms = [];
    },
    (candidate: C7RuntimeReleaseEvidence) => {
      candidate.dialogueSampleSet.samples[0]!.personaBehaviorInstructions = ["forged behavior"];
    },
    (candidate: C7RuntimeReleaseEvidence) => {
      candidate.dialogueJourneys[0]!.turns[0]!.reply = "tampered journey reply";
    },
    (candidate: C7RuntimeReleaseEvidence) => {
      candidate.dialogueReport.runs[0]!.contextFollowupsCorrect = 0;
    },
    (candidate: C7RuntimeReleaseEvidence) => {
      candidate.dialogueReport.runs[0]!.publicCaseId =
        candidate.dialogueReport.runs[1]!.publicCaseId;
    },
    (candidate: C7RuntimeReleaseEvidence) => {
      candidate.dialogueAudit.validations.forEach((validation) => {
        validation.assessments[0]!.sampleId = "fake-sample";
      });
    },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.dialogueAudit.factOrSafetySeriousErrors = 99; },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.dialogueAudit.naturalAndRoleConsistentRate = 0; },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.dialogueAudit.validations[0]!.assessments[0]!.seriousError = true; },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.dialogueAudit.validations[1]!.assessments[0]!.naturalChinese = false; },
    (candidate: C7RuntimeReleaseEvidence) => {
      (candidate.dialogueAudit.validations[0]!.assessments[0] as unknown as {
        factGrounded: string;
      }).factGrounded = "false";
    },
    (candidate: C7RuntimeReleaseEvidence) => {
      (candidate.dialogueAudit.validations[0] as { role: string }).role = "fake_role";
    },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.dialogueReport.bindings.aiEvidenceIndexSha256 = "9".repeat(64); },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.dialogueReport.bindings.caseManifestSha256 = "9".repeat(64); },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.dialogueReport.bindings.patientPromptSha256 = "9".repeat(64); },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.dialogueReport.bindings.shareContractSha256 = "9".repeat(64); },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.dialogueReport.bindings.dialogueAuditSha256 = "9".repeat(64); },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.aiIndex.publishedArtifacts[0]!.path = "published/../../.env"; },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.caseManifest.publishedCases[0]!.contentHash = `sha256:${"9".repeat(64)}`; },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.c6Acceptance.providerFailure.fakePatientReplies = 1; },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.c7Acceptance.testFiles.pop(); },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.c6Acceptance.verification.exitCode = 1; },
    (candidate: C7RuntimeReleaseEvidence) => { candidate.securityScan.scannedRoots = ["model"]; },
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

test("C7 runtime release carries quality and rejected decisions as non-blocking findings", () => {
  const candidate = approvedEvidence();
  candidate.aiIndex.reviewPolicy = "non_blocking";
  candidate.aiIndex.reviewFindings = [{
    code: "CASE_AI_REVIEW_NOT_APPROVED",
    scope: candidate.caseManifest.publishedCases[0]!.publicCaseId,
    decision: "rejected",
  }];
  candidate.dialogueApproval.decision = "rejected";
  candidate.c7Acceptance.status = "failed";
  candidate.c7Acceptance.persistenceCovered = false;
  candidate.c7Acceptance.idempotencyCovered = false;
  candidate.c7Acceptance.recoveryCovered = false;
  candidate.c7Acceptance.providerFailureCovered = false;
  candidate.c7Acceptance.verification.exitCode = 1;

  assert.doesNotThrow(() => assertC7RuntimeReleaseEvidence(candidate));
  const codes = new Set(
    collectC7RuntimeReleaseFindings(candidate).map(({ code }) => code),
  );
  assert.ok(codes.has("CASE_AI_REVIEW_NOT_APPROVED"));
  assert.ok(codes.has("PROVIDER_MODEL_APPROVAL_NOT_APPROVED"));
  assert.ok(codes.has("C7_ACCEPTANCE_FAILED"));
  assert.ok(codes.has("C7_ACCEPTANCE_COVERAGE_MISSING"));
  assert.ok(codes.has("C7_ACCEPTANCE_EXIT_NONZERO"));
  assert.deepEqual(
    collectC7RuntimeReleaseFindings(candidate)
      .filter(({ code }) => code === "C7_ACCEPTANCE_COVERAGE_MISSING")
      .map(({ message }) => message)
      .sort(),
    [
      "idempotencyCovered is false",
      "persistenceCovered is false",
      "providerFailureCovered is false",
      "recoveryCovered is false",
    ],
  );
});

test("C7 runtime release accepts manifest-bound rejected draft candidates", () => {
  const candidate = approvedEvidence();
  candidate.aiIndex.reviewPolicy = "non_blocking";
  candidate.aiIndex.reviewFindings = [];
  candidate.publishedCasePackages.forEach((casePackage) => {
    casePackage.packageStatus = "draft";
  });
  candidate.caseManifest.publishedCases.forEach((binding) => {
    Object.assign(binding, {
      packageStatus: "draft",
      reviewStatus: "rejected",
      path: `published/ai-candidates/${binding.publicCaseId}.candidate.json`,
      validationRecordPath:
        `published/ai-candidates/${binding.publicCaseId}.ai-review.json`,
    });
  });
  candidate.aiIndex.publishedArtifacts.forEach((binding) => {
    Object.assign(binding, {
      packageStatus: "draft",
      reviewStatus: "rejected",
      path: `published/ai-candidates/${binding.publicCaseId}.candidate.json`,
      validationRecordPath:
        `published/ai-candidates/${binding.publicCaseId}.ai-review.json`,
    });
  });

  assert.doesNotThrow(() => assertC7RuntimeReleaseEvidence(candidate));
  assert.equal(
    collectC7RuntimeReleaseFindings(candidate).filter(
      ({ code }) => code === "CASE_AI_REVIEW_NOT_APPROVED",
    ).length,
    candidate.publishedCasePackages.length,
  );
});

test("C7 runtime release accepts a manifest-bound missing review without sidecar evidence", () => {
  const candidate = approvedEvidence();
  candidate.aiIndex.reviewPolicy = "non_blocking";
  const manifestBinding = candidate.caseManifest.publishedCases[0]!;
  const artifactBinding = candidate.aiIndex.publishedArtifacts[0]!;
  manifestBinding.reviewStatus = "missing";
  artifactBinding.reviewStatus = "missing";
  delete manifestBinding.validationRecordPath;
  delete artifactBinding.validationRecordPath;

  assert.doesNotThrow(() => assertC7RuntimeReleaseEvidence(candidate));
  assert.ok(
    collectC7RuntimeReleaseFindings(candidate).some(
      ({ code, scope }) =>
        code === "CASE_AI_REVIEW_NOT_APPROVED" &&
        scope === manifestBinding.publicCaseId,
    ),
  );
});

test("C7 runtime findings retain conflicting review decisions for the same case", () => {
  const candidate = approvedEvidence();
  const scope = candidate.caseManifest.publishedCases[0]!.publicCaseId;
  candidate.caseManifest.publishedCases[0]!.reviewStatus = "stale";
  candidate.aiIndex.publishedArtifacts[0]!.reviewStatus = "stale";
  candidate.aiIndex.reviewFindings = [
    { code: "CASE_AI_REVIEW_NOT_APPROVED", scope, decision: "stale" },
    { code: "CASE_AI_REVIEW_NOT_APPROVED", scope, decision: "rejected" },
    {
      code: "CASE_AI_REVIEW_NOT_APPROVED",
      scope,
      decision: "revision_recommended",
    },
  ];

  assert.deepEqual(
    collectC7RuntimeReleaseFindings(candidate)
      .filter(({ code, scope: findingScope }) =>
        code === "CASE_AI_REVIEW_NOT_APPROVED" && findingScope === scope
      )
      .map(({ message }) => message),
    [
      "manifest review status: stale",
      "AI review decision: rejected",
      "AI review decision: revision_recommended",
    ],
  );
});

test("C7 dialogue reconstruction accepts a manifest-bound CasePackage v2", () => {
  const baseline = approvedEvidence();
  const legacy = baseline.publishedCasePackages[0]!;
  assert.equal(legacy.schemaVersion, "case-package-v1-rc1");
  if (legacy.schemaVersion !== "case-package-v1-rc1") return;
  const migrated = migrateCasePackageV1ToV2(legacy, {
    patientRoleId: "patient-role.c7-v2-regression",
    caseVersion: "2.0.0-rc.1",
    modifiers: {
      healthLiteracy: "typical",
      recallReliability: "typical",
      emotionalIntensity: "moderate",
    },
    provenanceSources: createCaseV2Fixture().provenance.sources,
  });
  migrated.packageStatus = "published";
  const journey = structuredClone(baseline.dialogueJourneys[0]!);
  journey.caseVersion = migrated.caseVersion;
  journey.contentHash = migrated.provenance.contentHash;
  journey.personaTemplateId = migrated.patientPersona.personaTemplateId;
  const binding = {
    publicCaseId: migrated.publicCaseId,
    caseVersion: migrated.caseVersion,
    contentHash: migrated.provenance.contentHash,
    path: `published/v2/${migrated.publicCaseId}.json`,
    validationRecordPath: `published/v2/${migrated.publicCaseId}.ai-review.json`,
    packageStatus: "published" as const,
    reviewStatus: "approved" as const,
  };

  assert.doesNotThrow(() => reconstructC7DialogueEvidence({
    casePackages: [migrated],
    caseBindings: [binding],
    journeys: [journey],
    policy: RELEASE_POLICY,
  }));
});

test("C7 dialogue reconstruction supports a shorter manifest policy without fixed turn access", () => {
  const baseline = approvedEvidence();
  const policy = structuredClone(RELEASE_POLICY);
  policy.minimumRealDialogueTurnsPerCase = 4;
  policy.requiredTestStates = [];
  const journey = structuredClone(baseline.dialogueJourneys[0]!);
  journey.turns = journey.turns.slice(0, 4);

  const result = reconstructC7DialogueEvidence({
    casePackages: [baseline.publishedCasePackages[0]!],
    caseBindings: [baseline.caseManifest.publishedCases[0]!],
    journeys: [journey],
    policy,
  });

  assert.equal(result.runs[0]!.committedTurns, 4);
  assert.equal(result.runs[0]!.contextFollowupsEvaluated, 1);
  assert.equal(result.runs[0]!.testActionsEvaluated, 0);
});

test("CLI runtime loads the five frozen published cases from the dialogue RC manifest", () => {
  assert.equal(DIALOGUE_RELEASE_MANIFEST_PATH, "cases/manifest.dialogue-rc.v1-rc1.json");
  const cases = loadDialogueCandidateCasePackages(resolve("."));
  assert.equal(cases.length, 5);
  assert.equal(new Set(cases.map(({ publicCaseId }) => publicCaseId)).size, 5);
  assert.equal(cases.every(({ packageStatus }) => packageStatus === "published"), true);
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

test("staged runtime artifact scan detects secrets and hidden public-evidence fields", () => {
  const root = mkdtempSync(resolve(tmpdir(), "ahamed-c7-security-"));
  try {
    const sourcePath = "model/cases/review/leak.html";
    const evidencePath =
      "model/evaluation/phase8/test/runtime-release-manifest-test.json";
    mkdirSync(resolve(root, "model/cases/review"), { recursive: true });
    mkdirSync(resolve(root, "model/evaluation/phase8/test"), { recursive: true });
    writeFileSync(
      resolve(root, sourcePath),
      `export const leaked = "${["sk", "x".repeat(24)].join("-")}";\n`,
    );
    writeFileSync(resolve(root, evidencePath), '{"patientFacts":[]}\n');
    const result = scanRuntimeArtifactSet(root, [sourcePath, evidencePath]);
    assert.deepEqual(result.secretFindings, [
      { file: sourcePath, patternId: "openai_style_key" },
    ]);
    assert.deepEqual(result.hiddenFieldFindings, [
      { file: evidencePath, field: "patientFacts" },
    ]);
    const e5EvidencePath =
      "model/evaluation/phase8/test/e5-full-acceptance-report.v1.json";
    writeFileSync(resolve(root, e5EvidencePath), '{"answerKey":{}}\n');
    const e5Result = scanRuntimeArtifactSet(root, [e5EvidencePath]);
    assert.deepEqual(e5Result.hiddenFieldFindings, [
      { file: e5EvidencePath, field: "answerKey" },
    ]);
    const e3EvidencePath =
      "model/evaluation/phase8/test/e3-persona-benchmark-report.v2.json";
    writeFileSync(resolve(root, e3EvidencePath), '{"behaviorInstructions":{}}\n');
    const e3Result = scanRuntimeArtifactSet(root, [e3EvidencePath]);
    assert.deepEqual(e3Result.hiddenFieldFindings, [
      { file: e3EvidencePath, field: "behaviorInstructions" },
    ]);
    const unsupportedPath = "model/cases/review/opaque.bin";
    writeFileSync(resolve(root, unsupportedPath), "opaque");
    assert.throws(
      () => scanRuntimeArtifactSet(root, [unsupportedPath]),
      /unsupported artifact/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("C7 semantic evidence checks accept internally consistent rejected decisions", () => {
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
    /aggregate decision drifted/u,
  );
  rejectedCase.validations[0]!.decision = "rejected";
  rejectedCase.validations[0]!.checks = {
    ...rejectedCase.validations[0]!.checks,
    clinicalConsistency: "fail",
  };
  assert.doesNotThrow(() => assertC7CaseValidationEvidence(
    rejectedCase,
    {
      caseId: rejectedCase.caseId,
      caseVersion: rejectedCase.caseVersion,
      contentHash: rejectedCase.contentHash,
    },
    "model-approved",
  ));

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
        validatorId: role === "safety_label_auditor"
          ? "validator.ai.safety-label-auditor.v1"
          : "validator.ai.adversarial-expression-auditor.v1",
        role: role as "safety_label_auditor" | "adversarial_expression_auditor",
        modelId: "model-approved",
        promptVersion: role === "safety_label_auditor"
          ? "safety-label-auditor-v1"
          : "adversarial-expression-auditor-v1",
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
    datasetVersion: safety.datasetVersion,
    policyVersion: safety.policyVersion,
    corpusHash: safety.corpusHash,
    holdoutHash: safety.holdoutHash,
    templateRegistryHash: safety.templateRegistryHash,
    totalSamples: 1,
    holdoutSamples: 1,
    expectedDecisionsBySampleId: { "sample-1": "ALLOW_GAME" },
  };
  assert.doesNotThrow(() => assertC7SafetyCorpusEvidence(safety, expected));
  const rejectedSafety = structuredClone(safety);
  rejectedSafety.decision = "rejected";
  rejectedSafety.validations[0]!.assessments[0]!.labelAgreement = false;
  rejectedSafety.validations[0]!.labelDisagreements = 1;
  rejectedSafety.validations[0]!.decision = "rejected";
  assert.doesNotThrow(
    () => assertC7SafetyCorpusEvidence(rejectedSafety, expected),
  );
  for (const mutate of [
    (candidate: Phase8SafetyCorpusAiValidationV1) => {
      (candidate.validations[0] as { role: string }).role = "fake_role";
    },
    (candidate: Phase8SafetyCorpusAiValidationV1) => {
      candidate.validations[0]!.assessments[0]!.seriousError = true;
    },
    (candidate: Phase8SafetyCorpusAiValidationV1) => {
      candidate.validations[0]!.assessments[0]!.labelAgreement = false;
    },
    (candidate: Phase8SafetyCorpusAiValidationV1) => {
      (candidate.validations[0]!.assessments[0] as unknown as {
        seriousError: string;
      }).seriousError = "false";
    },
    (candidate: Phase8SafetyCorpusAiValidationV1) => {
      candidate.validations[1]!.assessments[0]!.expressionNatural = false;
    },
  ]) {
    const candidate = structuredClone(safety);
    mutate(candidate);
    assert.throws(
      () => assertC7SafetyCorpusEvidence(candidate, expected),
      /(?:semantic gate|accounting drifted|decision drifted|sample binding drifted)/u,
    );
  }
  const recommendationDisagreement = structuredClone(safety);
  recommendationDisagreement.validations[0]!.assessments[0]!.recommendedDecision =
    "EXIT_REAL_HEALTH";
  assert.throws(
    () => assertC7SafetyCorpusEvidence(recommendationDisagreement, expected),
    /sample binding drifted/u,
  );
});

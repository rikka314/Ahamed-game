import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { loadCasePackages } from "../src/cli/case-loader.js";
import {
  runPhase8CandidateBenchmark,
  type Phase8CandidateBenchmarkBindings,
} from "../src/evaluation/phase8-candidate-benchmark.js";
import type { ProviderLiveEvalReport } from "../src/evaluation/openai-live-eval.js";
import type {
  Phase8CaseValidationV2,
} from "../src/release/phase8-release.js";

const manifest = JSON.parse(
  readFileSync("cases/manifest.v1-rc1.json", "utf8"),
) as {
  publishedCases: Array<{ path: string }>;
};

const publishedCases = loadCasePackages(
  manifest.publishedCases.map(({ path }) => resolve("cases", path)),
);

function hardenedValidation(
  casePackage: (typeof publishedCases)[number],
): Phase8CaseValidationV2 {
  return {
    schemaVersion: "ai-case-cross-validation-v2",
    caseId: casePackage.internalCaseId,
    caseVersion: casePackage.caseVersion,
    contentHash: casePackage.provenance.contentHash!,
    decision: "approved",
    validations: [
      {
        validatorId: "validator.clinical-safety.v2",
        role: "clinical_safety",
        modelId: "gpt-test-snapshot",
        promptVersion: "clinical-safety-case-validation-v2",
        validationRunId: `run.clinical.${casePackage.publicCaseId}`,
        isolation: {
          independentInvocation: true,
          counterpartOutputVisible: false,
        },
        decision: "approved",
        validatedAt: "2026-08-28T10:00:00.000Z",
        checks: {
          clinicalConsistency: "pass",
          diagnosisSolvability: "pass",
          redFlagExclusions: "pass",
          rubricConsistency: "pass",
          regressionCoverage: "pass",
          hiddenTruthSafety: "pass",
        },
        findings: ["通过"],
      },
      {
        validatorId: "validator.diagnostic-quality.v2",
        role: "diagnostic_quality",
        modelId: "gpt-test-snapshot",
        promptVersion: "diagnostic-quality-case-validation-v2",
        validationRunId: `run.diagnostic.${casePackage.publicCaseId}`,
        isolation: {
          independentInvocation: true,
          counterpartOutputVisible: false,
        },
        decision: "approved",
        validatedAt: "2026-08-28T10:01:00.000Z",
        checks: {
          clinicalConsistency: "pass",
          diagnosisSolvability: "pass",
          redFlagExclusions: "pass",
          rubricConsistency: "pass",
          regressionCoverage: "pass",
          hiddenTruthSafety: "pass",
        },
        findings: ["通过"],
      },
    ],
  };
}

const bindings: Phase8CandidateBenchmarkBindings = {
  caseManifestSha256: "1".repeat(64),
  caseValidationSetSha256: "2".repeat(64),
  promptSetSha256: "3".repeat(64),
  scoringPolicySha256: "4".repeat(64),
  medicalSafetyPolicySha256: "5".repeat(64),
  safetyTemplateRegistrySha256: "6".repeat(64),
  shareContractSha256: "7".repeat(64),
};

function evalReport(
  caseId: string,
  caseVersion: string,
  runNumber: number,
  actualModelId = "gpt-test-snapshot",
): ProviderLiveEvalReport {
  return {
    schemaVersion: "phase8-published-case-live-eval-v1",
    referenceStatus: "published_case",
    benchmarkFingerprint: `${caseId}-${runNumber}`,
    caseContentSha256: "8".repeat(64),
    caseId,
    caseVersion,
    providerName: "openai-compatible.test",
    modelId: "gpt-test",
    actualModelId,
    promptVersion: "v0.1.0",
    providerManifest: {
      adapterVersion: "openai-responses-adapter-v1",
      sdkVersion: "7.7.0",
      schemaVersion: "structured-provider-schema-v1",
      protocol: "openai-responses",
      endpointSha256: "9".repeat(64),
      promptSha256ByRole: {
        controller: "a".repeat(64),
        patient: "b".repeat(64),
        review: "c".repeat(64),
      },
      schemaSha256ByRole: {
        controller: "d".repeat(64),
        patient: "e".repeat(64),
        review: "f".repeat(64),
      },
    },
    evaluationVersion: "scoring-policy-v1",
    sessionPhase: "completed",
    scores: {
      diagnosis: 45,
      historyCoverage: 20,
      differentialReasoning: 10,
      testSelection: 10,
      efficiency: 5,
      communication: 5,
      total: 95,
    },
    callCount: 9,
    controllerFactRouting: {
      evaluatedTurns: 4,
      matchedTurns: 4,
      accuracy: 1,
    },
    totalUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    calls: [],
  };
}

test("published-only candidate benchmark runs every case three times and binds a stable actual model", async () => {
  let invocations = 0;
  const report = await runPhase8CandidateBenchmark({
    benchmarkKind: "candidate_preflight",
    repeatCount: 3,
    cases: publishedCases.map((casePackage) => ({
      casePackage,
      validation: hardenedValidation(casePackage),
    })),
    bindings,
    evaluate: async (casePackage, runNumber) => {
      invocations += 1;
      return evalReport(casePackage.publicCaseId, casePackage.caseVersion, runNumber);
    },
  });

  assert.equal(invocations, 15);
  assert.equal(report.caseCount, 5);
  assert.equal(report.runCount, 15);
  assert.equal(report.completedRuns, 15);
  assert.equal(report.failedRuns, 0);
  assert.equal(report.actualModelId, "gpt-test-snapshot");
  assert.equal(report.gate.status, "passed");
  assert.equal(report.quality.controllerFactRoutingAccuracy, 1);
  assert.match(report.runSetSha256, /^[a-f0-9]{64}$/u);
  assert.equal(report.totalUsage.totalTokens, 2250);
  assert.doesNotMatch(
    JSON.stringify(report),
    /answerKey|rubric|patientFacts|internalCaseId|MODEL_API_KEY|baseURL/u,
  );
});

test("Phase 8 candidate benchmark rejects drafts, missing repeats, and actual-model drift", async () => {
  const cases = publishedCases.map((casePackage) => ({
    casePackage,
    validation: hardenedValidation(casePackage),
  }));
  const draftCases = structuredClone(cases);
  draftCases[0]!.casePackage.packageStatus = "draft";

  await assert.rejects(
    runPhase8CandidateBenchmark({
      benchmarkKind: "candidate_preflight",
      repeatCount: 3,
      cases: draftCases,
      bindings,
      evaluate: async (casePackage, runNumber) =>
        evalReport(casePackage.publicCaseId, casePackage.caseVersion, runNumber),
    }),
    /published cases/u,
  );

  await assert.rejects(
    runPhase8CandidateBenchmark({
      benchmarkKind: "candidate_preflight",
      repeatCount: 2,
      cases,
      bindings,
      evaluate: async (casePackage, runNumber) =>
        evalReport(casePackage.publicCaseId, casePackage.caseVersion, runNumber),
    }),
    /at least 3 repeats/u,
  );

  await assert.rejects(
    runPhase8CandidateBenchmark({
      benchmarkKind: "rc_release",
      repeatCount: 5,
      cases,
      bindings,
      evaluate: async (casePackage, runNumber) =>
        evalReport(
          casePackage.publicCaseId,
          casePackage.caseVersion,
          runNumber,
          runNumber === 5 ? "gpt-test-snapshot-drift" : "gpt-test-snapshot",
        ),
    }),
    /stable actual model ID/u,
  );
});

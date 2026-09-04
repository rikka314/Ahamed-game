import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import {
  computeCaseContentHash,
  loadPhase6CaseBundles,
  publishAiValidatedCase,
  publishManifestCaseCandidate,
  validatePhase6CaseBundle,
  type AiCaseCrossValidationV1,
  type Phase6CaseBundle,
} from "../src/cases/phase6-case-production.js";
import type {
  AiCaseCrossReviewV3,
  CasePackage,
} from "../src/domain/case-package.js";
import { createCaseV2Fixture } from "./fixtures/case-v2-fixture.js";

const expectedCases = new Map([
  ["case_c01_respiratory_001", "普通感冒"],
  ["case_c02_respiratory_002", "流行性感冒"],
  ["case_c03_respiratory_003", "急性咽炎"],
  ["case_c04_respiratory_004", "急性支气管炎"],
  ["case_c05_respiratory_005", "轻症社区获得性肺炎"],
]);

function loadHistoricalPhase6CaseBundles(): Phase6CaseBundle[] {
  const manifest = JSON.parse(
    readFileSync("cases/manifest.v1-rc1.json", "utf8"),
  ) as {
    draftCases: Array<{ path: string }>;
  };
  const launchManifest = JSON.parse(
    readFileSync("cases/manifest.phase6-compat.v2-rc2.json", "utf8"),
  ) as {
    cases: NonNullable<Phase6CaseBundle["manifestEntry"]>[];
  };
  return manifest.draftCases.map(({ path }) => {
    const regressionPath = path
      .replace(/^draft\//u, "regression/")
      .replace(/\.json$/u, ".trajectories.json");
    const casePackage = JSON.parse(
      readFileSync(join("cases", path), "utf8"),
    ) as Phase6CaseBundle["casePackage"];
    const launchEntry = launchManifest.cases.find(
      ({ publicCaseId }) => publicCaseId === casePackage.publicCaseId,
    );
    assert.ok(launchEntry, `missing launch binding for ${casePackage.publicCaseId}`);
    const reviewRecordPath = `ai-validation/${path
      .replace(/^draft\//u, "")
      .replace(/\.json$/u, ".ai-validation.json")}`;
    return {
      casePackage,
      trajectories: JSON.parse(
        readFileSync(join("cases", regressionPath), "utf8"),
      ) as Phase6CaseBundle["trajectories"],
      aiCrossValidation: JSON.parse(
        readFileSync(join("cases", reviewRecordPath), "utf8"),
      ) as AiCaseCrossValidationV1,
      manifestEntry: {
        ...launchEntry,
        caseVersion: casePackage.caseVersion,
        casePackageSchemaVersion: "case-package-v1-rc1",
        path,
        regressionPath,
        evaluationCorpusPath: "evaluation/phase7-respiratory-v1.json",
        contentHash: casePackage.provenance.contentHash!,
        packageStatus: casePackage.packageStatus,
        reviewStatus: "stale",
        reviewRecordPath,
      },
    };
  });
}

function createAiCrossValidation(
  bundle: Phase6CaseBundle,
): AiCaseCrossValidationV1 {
  return {
    schemaVersion: "ai-case-cross-validation-v1",
    caseId: bundle.casePackage.internalCaseId,
    caseVersion: bundle.casePackage.caseVersion,
    contentHash: computeCaseContentHash(bundle.casePackage),
    decision: "approved",
    validations: [
      {
        validatorId: "ai.validator.clinical-safety.001",
        role: "clinical_safety",
        modelId: "gpt-5.6-sol",
        promptVersion: "ai-case-cross-validation-v1",
        decision: "approved",
        validatedAt: "2026-08-28T00:00:00.000Z",
        checks: {
          clinicalConsistency: "pass",
          diagnosisSolvability: "pass",
          redFlagExclusions: "pass",
          rubricConsistency: "pass",
          regressionCoverage: "pass",
          hiddenTruthSafety: "pass",
        },
        findings: [],
      },
      {
        validatorId: "ai.validator.diagnostic-quality.001",
        role: "diagnostic_quality",
        modelId: "gpt-5.6-sol",
        promptVersion: "ai-case-cross-validation-v1",
        decision: "approved",
        validatedAt: "2026-08-28T00:01:00.000Z",
        checks: {
          clinicalConsistency: "pass",
          diagnosisSolvability: "pass",
          redFlagExclusions: "pass",
          rubricConsistency: "pass",
          regressionCoverage: "pass",
          hiddenTruthSafety: "pass",
        },
        findings: [],
      },
    ],
  };
}

test("dialogue candidate changes invalidate the superseded Phase 8 approvals", () => {
  const bundles = loadHistoricalPhase6CaseBundles();
  const manifest = JSON.parse(
    readFileSync("cases/manifest.v1-rc1.json", "utf8"),
  ) as {
    draftCases: Array<{
      publicCaseId: string;
      caseVersion: string;
      contentHash: string;
    }>;
    publishedCases: unknown[];
  };
  const candidateManifest = JSON.parse(
    readFileSync("cases/manifest.dialogue-candidate.v1-rc1.json", "utf8"),
  ) as typeof manifest;

  assert.equal(bundles.length, 5);
  assert.deepEqual(
    new Set(bundles.map(({ casePackage }) => casePackage.publicCaseId)),
    new Set(expectedCases.keys()),
  );

  for (const bundle of bundles) {
    const report = validatePhase6CaseBundle(bundle);
    assert.deepEqual(report.structuralIssues, [], bundle.casePackage.publicCaseId);
    assert.deepEqual(report.publicationBlockers, ["AI_CROSS_VALIDATION_INVALID"]);
    assert.equal(
      bundle.casePackage.answerKey.targetDiagnosis,
      expectedCases.get(bundle.casePackage.publicCaseId),
    );
    assert.equal(bundle.casePackage.locale, "zh-CN");
    assert.equal(bundle.casePackage.packageStatus, "draft");
    assert.equal(
      bundle.casePackage.provenance.contentHash,
      computeCaseContentHash(bundle.casePackage),
    );
    assert.deepEqual(
      new Set(bundle.trajectories.trajectories.map(({ kind }) => kind)),
      new Set(["success", "failure", "safety", "unknown"]),
    );
    const manifestEntry = manifest.draftCases.find(
      ({ publicCaseId }) => publicCaseId === bundle.casePackage.publicCaseId,
    );
    assert.equal(manifestEntry?.caseVersion, bundle.casePackage.caseVersion);
    assert.notEqual(
      manifestEntry?.contentHash,
      bundle.casePackage.provenance.contentHash,
    );
    const candidateEntry = candidateManifest.draftCases.find(
      ({ publicCaseId }) => publicCaseId === bundle.casePackage.publicCaseId,
    );
    assert.equal(candidateEntry?.caseVersion, bundle.casePackage.caseVersion);
    assert.equal(
      candidateEntry?.contentHash,
      bundle.casePackage.provenance.contentHash,
    );
  }
  assert.equal(manifest.publishedCases.length, 5);
  assert.equal(candidateManifest.publishedCases.length, 0);
});

test("Phase 6 publication requires two independent approved AI validations and no human signature", () => {
  const bundle = loadHistoricalPhase6CaseBundles()[0]!;
  const validation = createAiCrossValidation(bundle);
  const outputDirectory = mkdtempSync(join(tmpdir(), "ahamed-phase6-publish-"));

  try {
    const published = publishAiValidatedCase({
      bundle,
      validation,
      outputDirectory,
    });

    assert.equal(published.casePackage.packageStatus, "published");
    assert.equal(published.casePackage.review.status, "pending");
    assert.equal(published.casePackage.releaseValidation?.decision, "approved");
    assert.equal(published.casePackage.releaseValidation?.validations.length, 2);
    assert.equal(
      published.casePackage.provenance.contentHash,
      computeCaseContentHash(published.casePackage),
    );
    assert.equal(published.casePackage.redFlagExclusionMatrix.review.status, "pending");

    const persisted = JSON.parse(
      readFileSync(published.outputPath, "utf8"),
    ) as CasePackage;
    assert.equal(persisted.provenance.contentHash, computeCaseContentHash(persisted));

    assert.throws(
      () =>
        publishAiValidatedCase({
          bundle,
          validation,
          outputDirectory,
        }),
      /already exists/u,
    );
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test("Phase 6 publication rejects a case version that would escape the output directory", () => {
  const bundle = structuredClone(loadHistoricalPhase6CaseBundles()[0]!);
  bundle.casePackage.caseVersion = "../../../escaped-version";
  bundle.casePackage.redFlagExclusionMatrix.caseVersion =
    bundle.casePackage.caseVersion;
  bundle.trajectories.caseVersion = bundle.casePackage.caseVersion;
  bundle.casePackage.provenance.contentHash = computeCaseContentHash(
    bundle.casePackage,
  );
  const validation = createAiCrossValidation(bundle);
  const temporaryRoot = mkdtempSync(join(tmpdir(), "ahamed-phase6-path-"));
  const outputDirectory = join(temporaryRoot, "nested", "published");
  const escapedCasePath = join(temporaryRoot, "escaped-version.json");
  const escapedValidationPath = join(
    temporaryRoot,
    "escaped-version.ai-validation.json",
  );

  try {
    const report = validatePhase6CaseBundle(bundle);
    assert.ok(
      report.structuralIssues.some((issue) =>
        issue.includes("$.caseVersion: pattern mismatch"),
      ),
    );
    assert.throws(
      () =>
        publishAiValidatedCase({
          bundle,
          validation,
          outputDirectory,
        }),
      /caseVersion: pattern mismatch/u,
    );
    assert.equal(existsSync(escapedCasePath), false);
    assert.equal(existsSync(escapedValidationPath), false);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("Phase 6 publication encodes a schema-valid public case ID as a portable file name", () => {
  const bundle = structuredClone(loadHistoricalPhase6CaseBundles()[0]!);
  bundle.casePackage.publicCaseId = "case:portable";
  bundle.casePackage.provenance.contentHash = computeCaseContentHash(
    bundle.casePackage,
  );
  const validation = createAiCrossValidation(bundle);
  const outputDirectory = mkdtempSync(join(tmpdir(), "ahamed-phase6-portable-"));

  try {
    const published = publishAiValidatedCase({
      bundle,
      validation,
      outputDirectory,
    });
    assert.equal(
      basename(published.outputPath).startsWith("case%3Aportable--"),
      true,
    );
    assert.equal(basename(published.outputPath).includes(":"), false);
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test("Phase 6 publication leaves no final artifact when staging the validation sidecar fails", () => {
  const bundle = loadHistoricalPhase6CaseBundles()[0]!;
  const validation = createAiCrossValidation(bundle);
  const outputDirectory = mkdtempSync(join(tmpdir(), "ahamed-phase6-atomic-"));
  const writes: string[] = [];
  const renames: string[] = [];
  const removals: string[] = [];

  try {
    assert.throws(
      () =>
        publishAiValidatedCase({
          bundle,
          validation,
          outputDirectory,
          fileOperations: {
            writeFile(path) {
              writes.push(path);
              if (writes.length === 2) throw new Error("injected sidecar write failure");
            },
            rename(source, destination) {
              renames.push(`${source}->${destination}`);
            },
            remove(path) {
              removals.push(path);
            },
          },
        }),
      /injected sidecar write failure/u,
    );
    assert.equal(writes.length, 2);
    assert.deepEqual(renames, []);
    assert.equal(removals.length, 2);
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test("Phase 6 publication lock prevents reentrant writers from mixing package and sidecar", () => {
  const firstBundle = loadHistoricalPhase6CaseBundles()[0]!;
  const firstValidation = createAiCrossValidation(firstBundle);
  const secondBundle = structuredClone(firstBundle);
  secondBundle.casePackage.review.notes = "并发发布者的不同但有效非临床反馈";
  secondBundle.casePackage.provenance.contentHash = computeCaseContentHash(
    secondBundle.casePackage,
  );
  const secondValidation = createAiCrossValidation(secondBundle);
  const outputDirectory = mkdtempSync(join(tmpdir(), "ahamed-phase6-lock-"));
  let attemptedReentrantPublish = false;

  try {
    const published = publishAiValidatedCase({
      bundle: firstBundle,
      validation: firstValidation,
      outputDirectory,
      fileOperations: {
        writeFile(path, content) {
          writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
        },
        rename(source, destination) {
          if (
            !attemptedReentrantPublish &&
            destination.endsWith(".ai-validation.json")
          ) {
            attemptedReentrantPublish = true;
            assert.throws(
              () =>
                publishAiValidatedCase({
                  bundle: secondBundle,
                  validation: secondValidation,
                  outputDirectory,
                }),
              /publication already in progress/u,
            );
          }
          renameSync(source, destination);
        },
        remove(path) {
          rmSync(path, { force: true });
        },
      },
    });

    assert.equal(attemptedReentrantPublish, true);
    const persistedPackage = JSON.parse(
      readFileSync(published.outputPath, "utf8"),
    ) as CasePackage;
    const persistedSidecar = JSON.parse(
      readFileSync(published.validationRecordPath, "utf8"),
    ) as AiCaseCrossValidationV1;
    assert.deepEqual(persistedSidecar, persistedPackage.releaseValidation);
    assert.equal(
      persistedPackage.provenance.contentHash,
      firstValidation.contentHash,
    );
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test("Phase 6 publication rejects incomplete, duplicate, rejected, or drifted AI validation", () => {
  const bundle = loadHistoricalPhase6CaseBundles()[0]!;
  const base = createAiCrossValidation(bundle);
  const outputDirectory = mkdtempSync(join(tmpdir(), "ahamed-phase6-reject-"));

  try {
    for (const validation of [
      { ...base, validations: base.validations.slice(0, 1) },
      {
        ...base,
        validations: [base.validations[0]!, { ...base.validations[1]!, validatorId: base.validations[0]!.validatorId }],
      },
      {
        ...base,
        validations: [base.validations[0]!, { ...base.validations[1]!, decision: "rejected" as const }],
      },
      { ...base, contentHash: `sha256:${"f".repeat(64)}` },
    ]) {
      assert.throws(
        () =>
          publishAiValidatedCase({
            bundle,
            validation,
            outputDirectory,
          }),
        /AI cross-validation/u,
      );
    }
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test("Phase 6 validation reports content, minimum-data, and trajectory defects", () => {
  const baseline = loadHistoricalPhase6CaseBundles()[0]!;
  const scenarios: Array<{
    mutate(bundle: Phase6CaseBundle): void;
    issue: RegExp;
  }> = [
    {
      mutate(bundle) {
        bundle.casePackage.locale = "en-US";
      },
      issue: /locale must be zh-CN/u,
    },
    {
      mutate(bundle) {
        bundle.casePackage.provenance.contentHash = `sha256:${"f".repeat(64)}`;
      },
      issue: /contentHash does not match/u,
    },
    {
      mutate(bundle) {
        for (const fact of Object.values(bundle.casePackage.patientFacts)) {
          if (fact.disclosure === "spontaneous") fact.disclosure = "if_asked";
        }
      },
      issue: /spontaneous fact/u,
    },
    {
      mutate(bundle) {
        delete bundle.casePackage.redFlagExclusionMatrix.entries[0];
        bundle.casePackage.redFlagExclusionMatrix.entries =
          bundle.casePackage.redFlagExclusionMatrix.entries.filter(Boolean);
      },
      issue: /missing red-flag matrix entry/u,
    },
    {
      mutate(bundle) {
        bundle.trajectories.caseVersion = "wrong-version";
      },
      issue: /trajectory caseVersion must match/u,
    },
    {
      mutate(bundle) {
        bundle.trajectories.trajectories = bundle.trajectories.trajectories.filter(
          ({ kind }) => kind !== "success",
        );
      },
      issue: /trajectory kind success must appear exactly once/u,
    },
    {
      mutate(bundle) {
        const unknown = bundle.trajectories.trajectories.find(
          ({ kind }) => kind === "unknown",
        )!;
        unknown.steps = [
          { action: "ask", input: "起病时间？", expectedFactIds: ["fact.onset"] },
        ];
      },
      issue: /unknown trajectory must exercise an unknown fact/u,
    },
    {
      mutate(bundle) {
        const safety = bundle.trajectories.trajectories.find(
          ({ kind }) => kind === "safety",
        )!;
        safety.expected.providerCalls = 1;
      },
      issue: /safety trajectory must require zero/u,
    },
    {
      mutate(bundle) {
        const safety = bundle.trajectories.trajectories.find(
          ({ kind }) => kind === "safety",
        )!;
        safety.expected.safetyCode = "SAFETY_REAL_HEALTH_INPUT";
      },
      issue: /safety trajectory code must match MedicalSafetyPolicy/u,
    },
  ];

  for (const scenario of scenarios) {
    const bundle = structuredClone(baseline);
    scenario.mutate(bundle);
    assert.match(
      validatePhase6CaseBundle(bundle).structuralIssues.join("; "),
      scenario.issue,
    );
  }
});

test("Phase 6 AI cross-validation rejects invalid validator metadata", () => {
  const bundle = loadHistoricalPhase6CaseBundles()[0]!;
  const base = createAiCrossValidation(bundle);
  const outputDirectory = mkdtempSync(join(tmpdir(), "ahamed-phase6-metadata-"));
  const invalidValidations: AiCaseCrossValidationV1[] = [
    { ...base, schemaVersion: "wrong" as "ai-case-cross-validation-v1" },
    { ...base, caseId: "invalid id" },
    { ...base, decision: "rejected" },
    { ...base, validations: base.validations.map((entry) => ({ ...entry, modelId: "" })) },
    { ...base, validations: base.validations.map((entry) => ({ ...entry, validatedAt: "not-a-date" })) },
  ];

  try {
    for (const validation of invalidValidations) {
      assert.throws(
        () =>
          publishAiValidatedCase({
            bundle,
            validation,
            outputDirectory,
          }),
        /AI cross-validation/u,
      );
    }
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test("Manifest publication emits v2 candidates for not-run and rejected reviews without overwriting", () => {
  const outputDirectory = mkdtempSync(join(tmpdir(), "ahamed-e2-publish-"));
  try {
    for (const reviewStatus of ["not_run", "rejected"] as const) {
      const casePackage = createCaseV2Fixture();
      casePackage.publicCaseId = `${casePackage.publicCaseId}.${reviewStatus}`;
      casePackage.internalCaseId = `${casePackage.internalCaseId}.${reviewStatus}`;
      casePackage.redFlagExclusionMatrix.caseId = casePackage.internalCaseId;
      casePackage.patientIdentity.patientRoleId =
        `${casePackage.patientIdentity.patientRoleId}.${reviewStatus}`;
      casePackage.provenance.contentHash = computeCaseContentHash(casePackage);
      const review: AiCaseCrossReviewV3 | undefined = reviewStatus === "rejected"
        ? {
            schemaVersion: "ai-case-cross-review-v3",
            caseId: casePackage.internalCaseId,
            caseVersion: casePackage.caseVersion,
            contentHash: casePackage.provenance.contentHash,
            decision: "rejected",
            validations: [{
              validatorId: "validator.ai.clinical-safety.e2",
              role: "clinical_safety",
              modelId: "gpt-test",
              promptVersion: "clinical-safety-case-review-v3",
              validationRunId: `run.${reviewStatus}`,
              isolation: {
                independentInvocation: true,
                counterpartOutputVisible: false,
              },
              runStatus: "completed",
              decision: "rejected",
              validatedAt: "2026-09-02T00:00:00.000Z",
              checks: {
                clinicalConsistency: "fail",
                diagnosisSolvability: "pass",
                redFlagExclusions: "pass",
                rubricConsistency: "pass",
                regressionCoverage: "pass",
                hiddenTruthSafety: "pass",
              },
              findings: ["clinical consistency requires revision"],
            }],
            findings: ["clinical consistency requires revision"],
          }
        : undefined;
      const published = publishManifestCaseCandidate({
        casePackage,
        review,
        reviewStatus,
        outputDirectory,
      });

      assert.equal(published.casePackage.packageStatus, "published");
      assert.equal(published.casePackage.releaseReview?.decision, reviewStatus);
      assert.equal(published.reviewStatus, reviewStatus);
      assert.ok(existsSync(published.outputPath));
      assert.ok(existsSync(published.reviewRecordPath));
      assert.throws(
        () => publishManifestCaseCandidate({
          casePackage,
          review,
          reviewStatus,
          outputDirectory,
        }),
        /already exists/u,
      );
    }
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test("Phase 6 validates CasePackage v2 through the supported-package contract", () => {
  const bundle = structuredClone(loadPhase6CaseBundles()[0]!);
  assert.equal(bundle.casePackage.schemaVersion, "case-package-v2-rc1");
  const issues = validatePhase6CaseBundle(bundle).structuralIssues.join("; ");
  assert.doesNotMatch(issues, /schemaVersion must equal case-package-v1|patientIdentity is not allowed|releaseReview is not allowed/u);
});

test("Manifest publication rejects a caller status that disagrees with the review", () => {
  const outputDirectory = mkdtempSync(join(tmpdir(), "ahamed-e2-status-binding-"));
  try {
    assert.throws(
      () => publishManifestCaseCandidate({
        casePackage: createCaseV2Fixture(),
        reviewStatus: "approved",
        outputDirectory,
      }),
      /reviewStatus does not match/u,
    );
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test("Manifest publication never treats another case review as stale", () => {
  const outputDirectory = mkdtempSync(join(tmpdir(), "ahamed-e2-review-identity-"));
  try {
    const casePackage = createCaseV2Fixture();
    const review: AiCaseCrossReviewV3 = {
      schemaVersion: "ai-case-cross-review-v3",
      caseId: "internal.other-case",
      caseVersion: casePackage.caseVersion,
      contentHash: casePackage.provenance.contentHash,
      decision: "not_run",
      validations: [],
      findings: ["review belongs to another case"],
    };
    assert.throws(
      () => publishManifestCaseCandidate({
        casePackage,
        review,
        reviewStatus: "stale",
        outputDirectory,
      }),
      /does not match the case identity/u,
    );
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test("Manifest publication cleanup never removes a sidecar created by another writer", () => {
  const outputDirectory = mkdtempSync(join(tmpdir(), "ahamed-e2-race-"));
  const casePackage = createCaseV2Fixture();
  let foreignSidecar = "";
  try {
    assert.throws(
      () => publishManifestCaseCandidate({
        casePackage,
        reviewStatus: "not_run",
        outputDirectory,
        fileOperations: {
          writeFile(path, content) {
            writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
          },
          rename(source, destination) {
            if (destination.endsWith(".ai-review.json")) {
              foreignSidecar = destination;
              writeFileSync(destination, "foreign-writer\n", { encoding: "utf8", flag: "wx" });
              throw new Error("injected rename race");
            }
            renameSync(source, destination);
          },
          remove(path) {
            rmSync(path, { force: true });
          },
        },
      }),
      /injected rename race/u,
    );
    assert.equal(readFileSync(foreignSidecar, "utf8"), "foreign-writer\n");
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
});

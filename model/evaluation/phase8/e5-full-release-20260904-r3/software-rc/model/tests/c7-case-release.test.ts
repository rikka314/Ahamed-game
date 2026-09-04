import assert from "node:assert/strict";
import test from "node:test";

import {
  buildC7ReportedCaseManifest,
  buildC7PublishedCaseManifest,
  listC7CaseManifestBindings,
  toAiCaseCrossValidationV1,
} from "../src/release/c7-case-release.js";
import type { Phase8CaseValidationV2 } from "../src/release/phase8-release.js";
import { loadCaseManifestV2 } from "../src/cases/case-manifest.js";

function validation(): Phase8CaseValidationV2 {
  return {
    schemaVersion: "ai-case-cross-validation-v2",
    caseId: "internal_c01",
    caseVersion: "1.0.0-draft.1",
    contentHash: `sha256:${"a".repeat(64)}`,
    decision: "approved",
    validations: ["clinical_safety", "diagnostic_quality"].map(
      (role, index) => ({
        validatorId: `validator.${index + 1}`,
        role: role as "clinical_safety" | "diagnostic_quality",
        modelId: "gpt-test",
        promptVersion: `${role.replace("_", "-")}-case-validation-v2`,
        validationRunId: `run.${index + 1}`,
        isolation: {
          independentInvocation: true,
          counterpartOutputVisible: false,
        },
        decision: "approved" as const,
        validatedAt: "2026-08-28T12:00:00.000Z",
        checks: {
          clinicalConsistency: "pass" as const,
          diagnosisSolvability: "pass" as const,
          redFlagExclusions: "pass" as const,
          rubricConsistency: "pass" as const,
          regressionCoverage: "pass" as const,
          hiddenTruthSafety: "pass" as const,
        },
        findings: ["approved"],
      }),
    ),
  };
}

test("C7 converts blind v2 evidence to the frozen v1 case-package release binding without losing role findings", () => {
  const converted = toAiCaseCrossValidationV1(validation());
  assert.equal(converted.schemaVersion, "ai-case-cross-validation-v1");
  assert.equal(converted.validations.length, 2);
  assert.deepEqual(
    converted.validations.map(({ role }) => role),
    ["clinical_safety", "diagnostic_quality"],
  );
  assert.equal("validationRunId" in converted.validations[0]!, false);
  assert.equal("isolation" in converted.validations[0]!, false);
});

test("C7 builds a new five-case manifest without mutating the superseded manifest", () => {
  const candidate = {
    manifestVersion: "case-manifest-v1-rc1",
    draftCases: Array.from({ length: 5 }, (_, index) => ({
      publicCaseId: `case_${index + 1}`,
      caseVersion: "1.0.0-draft.1",
      path: `draft/case-${index + 1}.json`,
      contentHash: `sha256:${String(index + 1).repeat(64)}`,
    })),
    publishedCases: [],
  };
  const result = buildC7PublishedCaseManifest({
    candidateManifest: candidate,
    releasePolicy: {
      policyVersion: "model-release-policy-v1",
      expectedCaseCount: 5,
    },
    publishedCases: candidate.draftCases.map((entry) => ({
      ...entry,
      path: `published/dialogue-rc/${entry.publicCaseId}.json`,
      validationRecordPath:
        `published/dialogue-rc/${entry.publicCaseId}.ai-validation.json`,
    })),
  });

  assert.equal(result.publishedCases.length, 5);
  assert.equal(candidate.publishedCases.length, 0);
  assert.ok(
    result.publishedCases.every(
      ({ releaseValidationMethod }) =>
        releaseValidationMethod === "ai_cross_validation",
    ),
  );
});

test("C7 case manifest publication count comes from release policy", () => {
  const candidate = {
    manifestVersion: "case-manifest-v1-rc1",
    draftCases: [{
      publicCaseId: "case_1",
      caseVersion: "1.0.0-draft.1",
      path: "draft/case-1.json",
      contentHash: `sha256:${"1".repeat(64)}`,
    }],
    publishedCases: [],
  };
  const result = buildC7PublishedCaseManifest({
    candidateManifest: candidate,
    releasePolicy: {
      policyVersion: "model-release-policy-v1",
      expectedCaseCount: 1,
    },
    publishedCases: [{
      ...candidate.draftCases[0]!,
      path: "published/dialogue-rc/case_1.json",
      validationRecordPath: "published/dialogue-rc/case_1.ai-validation.json",
    }],
  });
  assert.equal(result.publishedCases.length, 1);
});

test("C7 v2 manifest records rejected, not-run, and stale publication reviews without blocking", () => {
  const candidateManifest = loadCaseManifestV2(
    "cases/manifest.phase6-compat.v2-rc9.json",
  );
  const statuses = [
    "rejected",
    "not_run",
    "stale",
    "approved",
    "revision_recommended",
  ] as const;
  const result = buildC7ReportedCaseManifest({
    candidateManifest,
    artifacts: candidateManifest.cases.map((entry, index) => ({
      publicCaseId: entry.publicCaseId,
      caseVersion: entry.caseVersion,
      contentHash: entry.contentHash,
      casePackageSchemaVersion: entry.casePackageSchemaVersion,
      packageStatus: "published" as const,
      reviewStatus: statuses[index % statuses.length]!,
      path: `published/e2/${entry.publicCaseId}.json`,
      reviewRecordPath: `published/e2/${entry.publicCaseId}.ai-review.json`,
      findings: statuses[index % statuses.length] === "approved"
        ? []
        : ["review finding"],
    })),
  });

  assert.equal(result.reviewPolicy, "non_blocking");
  assert.equal(result.reviewSummary.status, "rejected");
  assert.equal(result.reviewSummary.findingsCount, 24);
  assert.equal(result.reviewSummary.staleCount, 6);
  assert.equal(result.reviewSummary.notRunCount, 6);
  assert.deepEqual(
    result.cases.map(({ reviewStatus }) => reviewStatus),
    candidateManifest.cases.map((_, index) => statuses[index % statuses.length]),
  );
  const bindings = listC7CaseManifestBindings(result);
  assert.equal(bindings.length, 30);
  assert.equal(bindings[0]!.reviewStatus, "rejected");
  assert.equal(bindings[0]!.packageStatus, "published");
  assert.match(bindings[0]!.validationRecordPath!, /\.ai-review\.json$/u);
});

test("C7 v2 manifest exposes a missing review without requiring a sidecar path", () => {
  const candidateManifest = loadCaseManifestV2(
    "cases/manifest.phase6-compat.v2-rc9.json",
  );
  const result = buildC7ReportedCaseManifest({
    candidateManifest,
    artifacts: candidateManifest.cases.map((entry, index) => ({
      publicCaseId: entry.publicCaseId,
      caseVersion: entry.caseVersion,
      contentHash: entry.contentHash,
      casePackageSchemaVersion: entry.casePackageSchemaVersion,
      packageStatus: "published" as const,
      reviewStatus: index === 0 ? "missing" as const : "stale" as const,
      path: `published/e2/${entry.publicCaseId}.json`,
      ...(index === 0
        ? {}
        : { reviewRecordPath: `published/e2/${entry.publicCaseId}.ai-review.json` }),
      findings: ["review finding"],
    })),
  });

  const bindings = listC7CaseManifestBindings(result);
  assert.equal(result.reviewSummary.status, "missing");
  assert.equal(result.reviewSummary.findingsCount, 30);
  assert.equal(result.reviewSummary.staleCount, 29);
  assert.equal(bindings[0]!.reviewStatus, "missing");
  assert.equal(bindings[0]!.validationRecordPath, undefined);
});

test("C7 v2 manifest rejects contradictory review status and sidecar bindings", () => {
  const candidateManifest = loadCaseManifestV2(
    "cases/manifest.phase6-compat.v2-rc9.json",
  );
  candidateManifest.cases[0]!.reviewStatus = "missing";
  assert.throws(
    () => listC7CaseManifestBindings(candidateManifest),
    /missing.*review.*record|manifest is invalid/iu,
  );

  const missingWithSidecar = candidateManifest.cases.map((entry, index) => ({
    publicCaseId: entry.publicCaseId,
    caseVersion: entry.caseVersion,
    contentHash: entry.contentHash,
    casePackageSchemaVersion: entry.casePackageSchemaVersion,
    packageStatus: "published" as const,
    reviewStatus: index === 0 ? "missing" as const : "stale" as const,
    path: `published/e2/${entry.publicCaseId}.json`,
    reviewRecordPath: `published/e2/${entry.publicCaseId}.ai-review.json`,
    findings: ["review finding"],
  }));
  assert.throws(
    () => buildC7ReportedCaseManifest({
      candidateManifest: loadCaseManifestV2(
        "cases/manifest.phase6-compat.v2-rc9.json",
      ),
      artifacts: missingWithSidecar,
    }),
    /missing.*review.*record/iu,
  );
});

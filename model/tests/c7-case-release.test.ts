import assert from "node:assert/strict";
import test from "node:test";

import {
  buildC7PublishedCaseManifest,
  toAiCaseCrossValidationV1,
} from "../src/release/c7-case-release.js";
import type { Phase8CaseValidationV2 } from "../src/release/phase8-release.js";

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

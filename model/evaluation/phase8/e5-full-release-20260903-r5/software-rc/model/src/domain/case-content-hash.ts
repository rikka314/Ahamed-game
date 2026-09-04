import { createHash } from "node:crypto";

import type {
  CasePackage,
  CasePackageV2,
  SupportedCasePackage,
} from "./case-package.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function legacyContentHashPayload(casePackage: CasePackage): unknown {
  const value = structuredClone(casePackage);
  value.packageStatus = "draft";
  delete value.releaseValidation;
  delete value.provenance.contentHash;
  value.review = {
    status: "pending",
    author: value.review.author,
    ...(value.review.notes === undefined ? {} : { notes: value.review.notes }),
  };
  value.redFlagExclusionMatrix.entries =
    value.redFlagExclusionMatrix.entries.map((entry) => ({
      ...entry,
      reviewDecision: "pending",
    }));
  value.redFlagExclusionMatrix.review = { status: "pending" };
  return stableValue(value);
}

function v2ContentHashPayload(casePackage: CasePackageV2): unknown {
  const value = structuredClone(casePackage);
  value.packageStatus = "draft";
  delete value.releaseReview;
  delete (value.provenance as Partial<CasePackageV2["provenance"]>).contentHash;
  value.review = {
    status: "pending",
    author: value.review.author,
    ...(value.review.notes === undefined ? {} : { notes: value.review.notes }),
  };
  value.redFlagExclusionMatrix.entries =
    value.redFlagExclusionMatrix.entries.map((entry) => ({
      ...entry,
      reviewDecision: "pending",
    }));
  value.redFlagExclusionMatrix.review = { status: "pending" };
  return stableValue(value);
}

function contentHashPayload(casePackage: SupportedCasePackage): unknown {
  return casePackage.schemaVersion === "case-package-v2-rc1"
    ? v2ContentHashPayload(casePackage)
    : legacyContentHashPayload(casePackage);
}

export function computeCaseContentHash(
  casePackage: SupportedCasePackage,
): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(contentHashPayload(casePackage)))
    .digest("hex")}`;
}

export function computeMedicalContentDigest(
  casePackage: SupportedCasePackage,
): string {
  const redFlagExclusionMatrix = {
    matrixVersion: casePackage.redFlagExclusionMatrix.matrixVersion,
    caseId: casePackage.redFlagExclusionMatrix.caseId,
    caseVersion: casePackage.redFlagExclusionMatrix.caseVersion,
    policyVersion: casePackage.redFlagExclusionMatrix.policyVersion,
    entries: casePackage.redFlagExclusionMatrix.entries.map((entry) => ({
      ...entry,
      reviewDecision: "pending",
    })),
  };
  const payload = stableValue({
    evaluationVersion: casePackage.evaluationVersion,
    internalCaseId: casePackage.internalCaseId,
    publicCaseId: casePackage.publicCaseId,
    caseVersion: casePackage.caseVersion,
    locale: casePackage.locale,
    chiefComplaint: casePackage.playerVisible.chiefComplaint,
    patientFacts: casePackage.patientFacts,
    medicalTests: casePackage.medicalTests,
    answerKey: casePackage.answerKey,
    rubric: casePackage.rubric,
    redFlagExclusionMatrix,
  });
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")}`;
}

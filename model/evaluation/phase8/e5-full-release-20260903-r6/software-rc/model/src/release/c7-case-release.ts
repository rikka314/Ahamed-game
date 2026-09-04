import type {
  AiCaseCrossReviewV3,
  AiCaseCrossValidationV1,
} from "../domain/case-package.js";
import type {
  CaseManifestPackageStatus,
  CaseManifestReviewStatus,
  CaseManifestV2,
} from "../cases/case-manifest.js";
import { validateCaseManifestV2 } from "../cases/case-manifest.js";
import {
  assertPhase8CaseValidation,
  type Phase8CaseValidationV2,
} from "./phase8-release.js";

export interface C7CaseManifestEntry {
  publicCaseId: string;
  caseVersion: string;
  path: string;
  contentHash: string;
}

export interface C7PublishedCaseManifestEntry extends C7CaseManifestEntry {
  releaseValidationMethod: "ai_cross_validation";
  validationRecordPath: string;
}

export interface C7CaseManifestBinding extends C7CaseManifestEntry {
  validationRecordPath?: string;
  packageStatus: CaseManifestPackageStatus;
  reviewStatus: CaseManifestReviewStatus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function listC7CaseManifestBindings(
  value: unknown,
): C7CaseManifestBinding[] {
  if (!isRecord(value)) throw new Error("C7 case manifest must be an object");
  if (value["manifestVersion"] === "case-manifest-v2-rc1") {
    const report = validateCaseManifestV2(value);
    if (report.technicalIssues.length > 0) {
      throw new Error(`C7 v2 case manifest is invalid: ${report.technicalIssues.join("; ")}`);
    }
    const manifest = value as unknown as CaseManifestV2;
    return manifest.cases.map((entry) => {
      if (
        entry.reviewStatus === "missing" &&
        entry.reviewRecordPath !== undefined
      ) {
        throw new Error(`C7 missing review must not bind a review record: ${entry.publicCaseId}`);
      }
      if (
        entry.reviewStatus !== "missing" &&
        entry.reviewRecordPath === undefined
      ) {
        throw new Error(`C7 case review record is missing: ${entry.publicCaseId}`);
      }
      return {
        publicCaseId: entry.publicCaseId,
        caseVersion: entry.caseVersion,
        contentHash: entry.contentHash,
        path: entry.path,
        ...(entry.reviewRecordPath === undefined
          ? {}
          : { validationRecordPath: entry.reviewRecordPath }),
        packageStatus: entry.packageStatus,
        reviewStatus: entry.reviewStatus,
      };
    });
  }
  if (!Array.isArray(value["publishedCases"])) {
    throw new Error("C7 v1 case manifest must contain publishedCases");
  }
  return value["publishedCases"].map((entry, index) => {
    if (
      !isRecord(entry) ||
      typeof entry["publicCaseId"] !== "string" ||
      typeof entry["caseVersion"] !== "string" ||
      typeof entry["contentHash"] !== "string" ||
      typeof entry["path"] !== "string" ||
      typeof entry["validationRecordPath"] !== "string"
    ) {
      throw new Error(`C7 v1 case manifest entry ${index} is invalid`);
    }
    return {
      publicCaseId: entry["publicCaseId"],
      caseVersion: entry["caseVersion"],
      contentHash: entry["contentHash"],
      path: entry["path"],
      validationRecordPath: entry["validationRecordPath"],
      packageStatus: "published",
      reviewStatus: "approved",
    };
  });
}

export interface C7CandidateCaseManifest {
  manifestVersion: string;
  draftCases: C7CaseManifestEntry[];
  publishedCases: C7PublishedCaseManifestEntry[];
  [key: string]: unknown;
}

export function toAiCaseCrossValidationV1(
  validation: Phase8CaseValidationV2,
): AiCaseCrossValidationV1 {
  assertPhase8CaseValidation(validation, {
    caseId: validation.caseId,
    caseVersion: validation.caseVersion,
    contentHash: validation.contentHash,
  });
  return {
    schemaVersion: "ai-case-cross-validation-v1",
    caseId: validation.caseId,
    caseVersion: validation.caseVersion,
    contentHash: validation.contentHash,
    decision: validation.decision,
    validations: validation.validations.map((entry) => ({
      validatorId: entry.validatorId,
      role: entry.role,
      modelId: entry.modelId,
      promptVersion: entry.promptVersion,
      decision: entry.decision,
      validatedAt: entry.validatedAt,
      checks: structuredClone(entry.checks),
      findings: [...entry.findings],
    })),
  };
}

export function toAiCaseCrossReviewV3(
  validation: Phase8CaseValidationV2,
): AiCaseCrossReviewV3 {
  return {
    schemaVersion: "ai-case-cross-review-v3",
    caseId: validation.caseId,
    caseVersion: validation.caseVersion,
    contentHash: validation.contentHash,
    decision: validation.decision,
    validations: validation.validations.map((entry) => ({
      ...structuredClone(entry),
      isolation: {
        independentInvocation: true,
        counterpartOutputVisible: false,
      },
      runStatus: "completed",
    })),
    findings: validation.validations.flatMap(({ findings }) => findings),
  };
}

export interface C7ReportedCaseArtifact {
  publicCaseId: string;
  caseVersion: string;
  contentHash: string;
  casePackageSchemaVersion: "case-package-v1-rc1" | "case-package-v2-rc1";
  packageStatus: CaseManifestPackageStatus;
  reviewStatus: CaseManifestReviewStatus;
  path: string;
  reviewRecordPath?: string;
  findings: string[];
}

function aggregateReviewStatus(
  statuses: readonly CaseManifestReviewStatus[],
): CaseManifestReviewStatus {
  for (const status of [
    "rejected",
    "revision_recommended",
    "missing",
    "stale",
    "not_run",
    "approved",
  ] as const) {
    if (statuses.includes(status)) return status;
  }
  return "not_run";
}

export function buildC7ReportedCaseManifest(input: {
  candidateManifest: CaseManifestV2;
  artifacts: readonly C7ReportedCaseArtifact[];
}): CaseManifestV2 {
  if (
    input.artifacts.length !== input.candidateManifest.cases.length ||
    input.candidateManifest.cases.length !==
      input.candidateManifest.releasePolicy.expectedCaseCount
  ) {
    throw new Error("C7 reported manifest artifact count does not match release policy");
  }
  const artifactsById = new Map(
    input.artifacts.map((artifact) => [artifact.publicCaseId, artifact] as const),
  );
  if (artifactsById.size !== input.artifacts.length) {
    throw new Error("C7 reported manifest artifacts must have unique case IDs");
  }
  const cases = input.candidateManifest.cases.map((entry) => {
    const artifact = artifactsById.get(entry.publicCaseId);
    if (
      artifact?.reviewStatus === "missing" &&
      artifact.reviewRecordPath !== undefined
    ) {
      throw new Error(
        `C7 missing review must not bind a review record: ${entry.publicCaseId}`,
      );
    }
    if (
      artifact !== undefined &&
      artifact.reviewStatus !== "missing" &&
      artifact.reviewRecordPath === undefined
    ) {
      throw new Error(
        `C7 non-missing review requires a review record: ${entry.publicCaseId}`,
      );
    }
    if (
      artifact === undefined ||
      artifact.caseVersion !== entry.caseVersion ||
      artifact.contentHash !== entry.contentHash ||
      artifact.casePackageSchemaVersion !== entry.casePackageSchemaVersion ||
      !artifact.path.startsWith("published/") ||
      (artifact.reviewRecordPath !== undefined &&
        !artifact.reviewRecordPath.startsWith("published/"))
    ) {
      throw new Error(
        `C7 reported artifact does not match manifest case ${entry.publicCaseId}`,
      );
    }
    const reportedEntry = {
      ...structuredClone(entry),
      path: artifact.path,
      packageStatus: artifact.packageStatus,
      reviewStatus: artifact.reviewStatus,
    };
    if (artifact.reviewRecordPath === undefined) {
      delete reportedEntry.reviewRecordPath;
    } else {
      reportedEntry.reviewRecordPath = artifact.reviewRecordPath;
    }
    return reportedEntry;
  });
  const statuses = input.artifacts.map(({ reviewStatus }) => reviewStatus);
  return {
    ...structuredClone(input.candidateManifest),
    cases,
    reviewSummary: {
      status: aggregateReviewStatus(statuses),
      findingsCount: input.artifacts.reduce(
        (total, { findings }) => total + findings.length,
        0,
      ),
      staleCount: statuses.filter((status) => status === "stale").length,
      notRunCount: statuses.filter((status) => status === "not_run").length,
    },
  };
}

export function buildC7PublishedCaseManifest(input: {
  candidateManifest: C7CandidateCaseManifest;
  releasePolicy: {
    policyVersion: string;
    expectedCaseCount: number;
  };
  publishedCases: Array<
    C7CaseManifestEntry & { validationRecordPath: string }
  >;
}): C7CandidateCaseManifest {
  if (
    input.releasePolicy.policyVersion.trim().length === 0 ||
    !Number.isInteger(input.releasePolicy.expectedCaseCount) ||
    input.releasePolicy.expectedCaseCount < 1
  ) {
    throw new Error("C7 release policy is invalid");
  }
  if (
    input.candidateManifest.draftCases.length !==
      input.releasePolicy.expectedCaseCount ||
    input.candidateManifest.publishedCases.length !== 0 ||
    input.publishedCases.length !== input.releasePolicy.expectedCaseCount
  ) {
    throw new Error(
      `C7 publication requires ${input.releasePolicy.expectedCaseCount} draft candidates and no pre-existing published entries`,
    );
  }
  const draftById = new Map(
    input.candidateManifest.draftCases.map((entry) => [
      entry.publicCaseId,
      entry,
    ]),
  );
  const seen = new Set<string>();
  const publishedCases = input.publishedCases.map((entry) => {
    const draft = draftById.get(entry.publicCaseId);
    if (
      draft === undefined ||
      seen.has(entry.publicCaseId) ||
      draft.caseVersion !== entry.caseVersion ||
      draft.contentHash !== entry.contentHash ||
      !entry.path.startsWith("published/") ||
      !entry.validationRecordPath.startsWith("published/")
    ) {
      throw new Error("C7 published case binding does not match its draft candidate");
    }
    seen.add(entry.publicCaseId);
    return {
      publicCaseId: entry.publicCaseId,
      caseVersion: entry.caseVersion,
      path: entry.path,
      contentHash: entry.contentHash,
      releaseValidationMethod: "ai_cross_validation" as const,
      validationRecordPath: entry.validationRecordPath,
    };
  });
  return {
    ...structuredClone(input.candidateManifest),
    publishedCases,
  };
}

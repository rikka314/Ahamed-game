import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { computeCaseContentHash } from "../domain/case-content-hash.js";
import {
  assertAiCaseCrossReviewV3,
  assertAiCaseCrossValidationV1,
  assertSupportedCasePackage,
  type AiCaseCrossReviewV3,
  type AiCaseCrossValidationV1,
  type SupportedCasePackage,
} from "../domain/case-package.js";
import {
  assertCaseManifestV2JsonSchema,
  assertCasePackageJsonSchema,
} from "../domain/case-package-schema.js";

export const CASE_MANIFEST_VERSION_V2 = "case-manifest-v2-rc1" as const;
export const MODEL_RELEASE_POLICY_VERSION_V1 =
  "model-release-policy-v1" as const;

export type CaseManifestReviewStatus =
  | "approved"
  | "revision_recommended"
  | "rejected"
  | "not_run"
  | "missing"
  | "stale";

export type CaseManifestPackageStatus =
  | "fixture"
  | "draft"
  | "published"
  | "withdrawn";

export type CaseManifestDifficulty = "basic" | "advanced";

export interface CaseManifestQualityThresholds {
  patientGeneratedReplyRate: number;
  maximumControllerProviderCalls: number;
  maximumLocalFakeReplies: number;
  maximumDiagnosisLeaks: number;
  maximumUncompletedTestResultLeaks: number;
  minimumPersonaConsistencyRate: number;
  minimumContextFollowupAccuracy: number;
  minimumTestActionAccuracy: number;
  maximumSeriousFactErrors: number;
}

export interface CaseManifestReleasePolicy {
  policyVersion: typeof MODEL_RELEASE_POLICY_VERSION_V1;
  expectedCaseCount: number;
  requiredPersonas: Array<{
    personaTemplateId: string;
    count: number;
    minimumDiseaseDomains: number;
  }>;
  diseaseDomainQuotas: Array<{
    diseaseDomainId: string;
    count: number;
  }>;
  difficultyQuotas: {
    basic: number;
    advanced: number;
  };
  minimumRegressionTrajectoriesPerCase: number;
  minimumRealDialogueTurnsPerCase: number;
  requiredTestStates: Array<
    "not_completed" | "pending_confirmation" | "completed"
  >;
  qualityThresholds: CaseManifestQualityThresholds;
}

export interface CaseManifestEntryV2 {
  publicCaseId: string;
  patientRoleId: string;
  caseVersion: string;
  casePackageSchemaVersion: "case-package-v1-rc1" | "case-package-v2-rc1";
  path: string;
  regressionPath: string;
  evaluationCorpusPath: string;
  contentHash: string;
  packageStatus: CaseManifestPackageStatus;
  reviewStatus: CaseManifestReviewStatus;
  reviewRecordPath?: string;
  diseaseDomainId: string;
  difficulty: CaseManifestDifficulty;
  personaTemplateId: string;
}

export interface CaseManifestV2 {
  manifestVersion: typeof CASE_MANIFEST_VERSION_V2;
  casePackageSchemaVersion: "case-package-v2-rc1";
  allowedCasePackageSchemaVersions: Array<
    "case-package-v1-rc1" | "case-package-v2-rc1"
  >;
  provenanceSchemaVersion: "provenance-record-v2";
  aiReviewSchemaVersion: "ai-case-cross-review-v3";
  reviewPolicy: "non_blocking";
  releasePolicy: CaseManifestReleasePolicy;
  aiReviewPolicy: {
    schemaVersions: string[];
    requiredRoles: Array<"clinical_safety" | "diagnostic_quality">;
    independentInvocation: true;
    counterpartOutputVisible: false;
  };
  reviewSummary: {
    status: CaseManifestReviewStatus;
    findingsCount: number;
    staleCount: number;
    notRunCount: number;
  };
  redFlagPolicyVersion: string;
  patientPromptVersion: string;
  evaluationPolicyVersion: string;
  contentHashPolicyVersion: string;
  cases: CaseManifestEntryV2[];
}

export type CaseManifestFindingCode =
  | "CASE_COUNT_MISMATCH"
  | "DUPLICATE_PUBLIC_CASE_ID"
  | "DUPLICATE_PATIENT_ROLE_ID"
  | "DUPLICATE_ARTIFACT_PATH"
  | "CASE_SCHEMA_NOT_ALLOWED"
  | "DUPLICATE_PERSONA_QUOTA"
  | "DUPLICATE_DISEASE_DOMAIN_QUOTA"
  | "UNDECLARED_PERSONA"
  | "UNDECLARED_DISEASE_DOMAIN"
  | "QUOTA_TOTAL_MISMATCH"
  | "PERSONA_QUOTA_MISMATCH"
  | "PERSONA_DOMAIN_COVERAGE_INSUFFICIENT"
  | "DISEASE_DOMAIN_QUOTA_MISMATCH"
  | "DIFFICULTY_QUOTA_MISMATCH"
  | "REVIEW_SUMMARY_MISMATCH"
  | "AI_REVIEW_REVISION_RECOMMENDED"
  | "AI_REVIEW_REJECTED"
  | "AI_REVIEW_NOT_RUN"
  | "AI_REVIEW_MISSING"
  | "AI_REVIEW_STALE"
  | "RED_FLAG_POLICY_MISSING"
  | "MISSING_CASE_FILE"
  | "MISSING_REGRESSION_FILE"
  | "MISSING_EVALUATION_CORPUS_FILE"
  | "MISSING_REVIEW_RECORD"
  | "UNSAFE_ARTIFACT_PATH"
  | "CASE_FILE_INVALID"
  | "CASE_BINDING_MISMATCH"
  | "REVIEW_FILE_INVALID"
  | "REVIEW_BINDING_MISMATCH"
  | "CONTENT_HASH_MISMATCH";

export interface CaseManifestFinding {
  code: CaseManifestFindingCode;
  message: string;
  publicCaseId?: string;
}

export interface CaseManifestValidationReport {
  technicalIssues: string[];
  findings: CaseManifestFinding[];
  metrics: {
    caseCount: number;
    personaCount: number;
    diseaseDomainCount: number;
    basicCaseCount: number;
    advancedCaseCount: number;
  };
}

function emptyMetrics(): CaseManifestValidationReport["metrics"] {
  return {
    caseCount: 0,
    personaCount: 0,
    diseaseDomainCount: 0,
    basicCaseCount: 0,
    advancedCaseCount: 0,
  };
}

function counts<T>(values: readonly T[]): Map<T, number> {
  const result = new Map<T, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function addDuplicateFindings(
  values: readonly string[],
  code: Extract<
    CaseManifestFindingCode,
    | "DUPLICATE_PUBLIC_CASE_ID"
    | "DUPLICATE_PATIENT_ROLE_ID"
    | "DUPLICATE_ARTIFACT_PATH"
  >,
  findings: CaseManifestFinding[],
): void {
  for (const [value, count] of counts(values)) {
    if (count > 1) {
      findings.push({ code, message: `${value} appears ${count} times` });
    }
  }
}

export function validateCaseManifestV2(
  value: unknown,
  options: { knownRedFlagPolicyVersions?: readonly string[] } = {},
): CaseManifestValidationReport {
  try {
    assertCaseManifestV2JsonSchema(value);
  } catch (error) {
    return {
      technicalIssues: [error instanceof Error ? error.message : String(error)],
      findings: [],
      metrics: emptyMetrics(),
    };
  }

  const manifest = value as CaseManifestV2;
  const technicalIssues: string[] = [];
  const findings: CaseManifestFinding[] = [];
  const personaCounts = counts(
    manifest.cases.map(({ personaTemplateId }) => personaTemplateId),
  );
  const domainCounts = counts(
    manifest.cases.map(({ diseaseDomainId }) => diseaseDomainId),
  );
  const difficultyCounts = counts(
    manifest.cases.map(({ difficulty }) => difficulty),
  );

  if (manifest.cases.length !== manifest.releasePolicy.expectedCaseCount) {
    findings.push({
      code: "CASE_COUNT_MISMATCH",
      message:
        `expected ${manifest.releasePolicy.expectedCaseCount} cases, found ${manifest.cases.length}`,
    });
  }
  addDuplicateFindings(
    manifest.cases.map(({ publicCaseId }) => publicCaseId),
    "DUPLICATE_PUBLIC_CASE_ID",
    findings,
  );
  addDuplicateFindings(
    manifest.cases.map(({ patientRoleId }) => patientRoleId),
    "DUPLICATE_PATIENT_ROLE_ID",
    findings,
  );
  addDuplicateFindings(
    manifest.cases.flatMap(({ path, regressionPath }) => [path, regressionPath]),
    "DUPLICATE_ARTIFACT_PATH",
    findings,
  );

  const allowedSchemas = new Set(manifest.allowedCasePackageSchemaVersions);
  for (const entry of manifest.cases) {
    if (!allowedSchemas.has(entry.casePackageSchemaVersion)) {
      const finding: CaseManifestFinding = {
        code: "CASE_SCHEMA_NOT_ALLOWED",
        publicCaseId: entry.publicCaseId,
        message: `${entry.casePackageSchemaVersion} is not allowed by the manifest`,
      };
      findings.push(finding);
      technicalIssues.push(
        `${finding.code}:${entry.publicCaseId}:${finding.message}`,
      );
    }
  }

  const personaQuotaIds = manifest.releasePolicy.requiredPersonas.map(
    ({ personaTemplateId }) => personaTemplateId,
  );
  const domainQuotaIds = manifest.releasePolicy.diseaseDomainQuotas.map(
    ({ diseaseDomainId }) => diseaseDomainId,
  );
  for (const [personaTemplateId, count] of counts(personaQuotaIds)) {
    if (count > 1) findings.push({
      code: "DUPLICATE_PERSONA_QUOTA",
      message: `persona quota ${personaTemplateId} appears ${count} times`,
    });
  }
  for (const [diseaseDomainId, count] of counts(domainQuotaIds)) {
    if (count > 1) findings.push({
      code: "DUPLICATE_DISEASE_DOMAIN_QUOTA",
      message: `disease-domain quota ${diseaseDomainId} appears ${count} times`,
    });
  }
  const declaredPersonas = new Set(personaQuotaIds);
  const declaredDomains = new Set(domainQuotaIds);
  for (const entry of manifest.cases) {
    if (!declaredPersonas.has(entry.personaTemplateId)) findings.push({
      code: "UNDECLARED_PERSONA",
      publicCaseId: entry.publicCaseId,
      message: `persona ${entry.personaTemplateId} is not declared by release policy`,
    });
    if (!declaredDomains.has(entry.diseaseDomainId)) findings.push({
      code: "UNDECLARED_DISEASE_DOMAIN",
      publicCaseId: entry.publicCaseId,
      message: `disease domain ${entry.diseaseDomainId} is not declared by release policy`,
    });
  }
  const quotaTotals = {
    personas: manifest.releasePolicy.requiredPersonas.reduce(
      (sum, quota) => sum + quota.count,
      0,
    ),
    domains: manifest.releasePolicy.diseaseDomainQuotas.reduce(
      (sum, quota) => sum + quota.count,
      0,
    ),
    difficulty:
      manifest.releasePolicy.difficultyQuotas.basic +
      manifest.releasePolicy.difficultyQuotas.advanced,
  };
  for (const [catalog, total] of Object.entries(quotaTotals)) {
    if (total !== manifest.releasePolicy.expectedCaseCount) findings.push({
      code: "QUOTA_TOTAL_MISMATCH",
      message: `${catalog} quotas total ${total}, expected ${manifest.releasePolicy.expectedCaseCount}`,
    });
  }

  for (const persona of manifest.releasePolicy.requiredPersonas) {
    const actual = personaCounts.get(persona.personaTemplateId) ?? 0;
    if (actual !== persona.count) {
      findings.push({
        code: "PERSONA_QUOTA_MISMATCH",
        message:
          `persona ${persona.personaTemplateId} expected ${persona.count}, found ${actual}`,
      });
    }
    const domainCoverage = new Set(
      manifest.cases
        .filter(
          ({ personaTemplateId }) =>
            personaTemplateId === persona.personaTemplateId,
        )
        .map(({ diseaseDomainId }) => diseaseDomainId),
    ).size;
    if (domainCoverage < persona.minimumDiseaseDomains) {
      findings.push({
        code: "PERSONA_DOMAIN_COVERAGE_INSUFFICIENT",
        message:
          `persona ${persona.personaTemplateId} requires ${persona.minimumDiseaseDomains} domains, found ${domainCoverage}`,
      });
    }
  }

  for (const domain of manifest.releasePolicy.diseaseDomainQuotas) {
    const actual = domainCounts.get(domain.diseaseDomainId) ?? 0;
    if (actual !== domain.count) {
      findings.push({
        code: "DISEASE_DOMAIN_QUOTA_MISMATCH",
        message:
          `domain ${domain.diseaseDomainId} expected ${domain.count}, found ${actual}`,
      });
    }
  }

  for (const difficulty of ["basic", "advanced"] as const) {
    const expected = manifest.releasePolicy.difficultyQuotas[difficulty];
    const actual = difficultyCounts.get(difficulty) ?? 0;
    if (actual !== expected) {
      findings.push({
        code: "DIFFICULTY_QUOTA_MISMATCH",
        message: `difficulty ${difficulty} expected ${expected}, found ${actual}`,
      });
    }
  }

  const staleCount = manifest.cases.filter(
    ({ reviewStatus }) => reviewStatus === "stale",
  ).length;
  const notRunCount = manifest.cases.filter(
    ({ reviewStatus }) => reviewStatus === "not_run",
  ).length;
  const reviewStatuses = manifest.cases.map(({ reviewStatus }) => reviewStatus);
  const reviewFindingCode = {
    revision_recommended: "AI_REVIEW_REVISION_RECOMMENDED",
    rejected: "AI_REVIEW_REJECTED",
    not_run: "AI_REVIEW_NOT_RUN",
    missing: "AI_REVIEW_MISSING",
    stale: "AI_REVIEW_STALE",
  } as const;
  for (const entry of manifest.cases) {
    if (entry.reviewStatus !== "approved") {
      findings.push({
        code: reviewFindingCode[entry.reviewStatus],
        publicCaseId: entry.publicCaseId,
        message: `AI cross-review status is ${entry.reviewStatus}`,
      });
    }
  }
  const minimumReviewFindings = reviewStatuses.filter(
    (status) => status !== "approved",
  ).length;
  const expectedReviewStatus = ([
    "rejected",
    "revision_recommended",
    "missing",
    "stale",
    "not_run",
    "approved",
  ] as const).find((status) => reviewStatuses.includes(status)) ?? "not_run";
  if (
    staleCount !== manifest.reviewSummary.staleCount ||
    notRunCount !== manifest.reviewSummary.notRunCount ||
    manifest.reviewSummary.status !== expectedReviewStatus ||
    manifest.reviewSummary.findingsCount < minimumReviewFindings
  ) {
    findings.push({
      code: "REVIEW_SUMMARY_MISMATCH",
      message:
        `review summary expected status=${expectedReviewStatus}, at least ${minimumReviewFindings} findings, stale=${staleCount}, not_run=${notRunCount}; found status=${manifest.reviewSummary.status}, findings=${manifest.reviewSummary.findingsCount}, stale=${manifest.reviewSummary.staleCount}, not_run=${manifest.reviewSummary.notRunCount}`,
    });
  }

  const knownPolicyVersions = options.knownRedFlagPolicyVersions ?? [
    "red-flag-policy-manifest-v2",
  ];
  if (!knownPolicyVersions.includes(manifest.redFlagPolicyVersion)) {
    findings.push({
      code: "RED_FLAG_POLICY_MISSING",
      message: `red-flag policy ${manifest.redFlagPolicyVersion} is unavailable`,
    });
  }

  return {
    technicalIssues,
    findings,
    metrics: {
      caseCount: manifest.cases.length,
      personaCount: personaCounts.size,
      diseaseDomainCount: domainCounts.size,
      basicCaseCount: difficultyCounts.get("basic") ?? 0,
      advancedCaseCount: difficultyCounts.get("advanced") ?? 0,
    },
  };
}

export function loadCaseManifestV2(path: string): CaseManifestV2 {
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const report = validateCaseManifestV2(value);
  if (report.technicalIssues.length > 0) {
    throw new Error(
      `case manifest is technically invalid: ${report.technicalIssues.join("; ")}`,
    );
  }
  return value as CaseManifestV2;
}

function resolveManifestArtifact(
  casesDirectory: string,
  artifactPath: string,
): string | undefined {
  if (isAbsolute(artifactPath)) return undefined;
  const root = resolve(casesDirectory);
  const path = resolve(root, artifactPath);
  const relativePath = relative(root, path);
  if (
    relativePath.length === 0 ||
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    return undefined;
  }
  return path;
}

export function inspectCaseManifestArtifacts(
  manifest: CaseManifestV2,
  casesDirectory: string,
): Pick<CaseManifestValidationReport, "technicalIssues" | "findings"> {
  const findings: CaseManifestFinding[] = [];
  const technicalIssues: string[] = [];
  const addTechnicalFinding = (finding: CaseManifestFinding): void => {
    findings.push(finding);
    technicalIssues.push(
      `${finding.code}${finding.publicCaseId === undefined ? "" : `(${finding.publicCaseId})`}: ${finding.message}`,
    );
  };
  for (const entry of manifest.cases) {
    const casePath = resolveManifestArtifact(casesDirectory, entry.path);
    const regressionPath = resolveManifestArtifact(
      casesDirectory,
      entry.regressionPath,
    );
    const evaluationCorpusPath = resolveManifestArtifact(
      casesDirectory,
      entry.evaluationCorpusPath,
    );
    const reviewRecordPath = entry.reviewRecordPath === undefined
      ? undefined
      : resolveManifestArtifact(casesDirectory, entry.reviewRecordPath);
    if (
      casePath === undefined ||
      regressionPath === undefined ||
      evaluationCorpusPath === undefined ||
      (entry.reviewRecordPath !== undefined && reviewRecordPath === undefined)
    ) {
      addTechnicalFinding({
        code: "UNSAFE_ARTIFACT_PATH",
        publicCaseId: entry.publicCaseId,
        message: `manifest artifact path escapes cases directory`,
      });
      continue;
    }
    if (!existsSync(casePath)) {
      addTechnicalFinding({
        code: "MISSING_CASE_FILE",
        publicCaseId: entry.publicCaseId,
        message: `case file is missing: ${entry.path}`,
      });
      continue;
    }
    if (!existsSync(regressionPath)) {
      addTechnicalFinding({
        code: "MISSING_REGRESSION_FILE",
        publicCaseId: entry.publicCaseId,
        message: `regression file is missing: ${entry.regressionPath}`,
      });
    }
    if (!existsSync(evaluationCorpusPath)) {
      addTechnicalFinding({
        code: "MISSING_EVALUATION_CORPUS_FILE",
        publicCaseId: entry.publicCaseId,
        message: `evaluation corpus is missing: ${entry.evaluationCorpusPath}`,
      });
    }
    if (reviewRecordPath !== undefined && !existsSync(reviewRecordPath)) {
      addTechnicalFinding({
        code: "MISSING_REVIEW_RECORD",
        publicCaseId: entry.publicCaseId,
        message: `review record is missing: ${entry.reviewRecordPath}`,
      });
    }

    let casePackage: SupportedCasePackage;
    try {
      const value = JSON.parse(readFileSync(casePath, "utf8")) as unknown;
      assertCasePackageJsonSchema(value);
      assertSupportedCasePackage(value);
      casePackage = value;
    } catch (error) {
      addTechnicalFinding({
        code: "CASE_FILE_INVALID",
        publicCaseId: entry.publicCaseId,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const patientRoleId = casePackage.schemaVersion === "case-package-v2-rc1"
      ? casePackage.patientIdentity.patientRoleId
      : undefined;
    const bindingMismatch =
      casePackage.publicCaseId !== entry.publicCaseId ||
      casePackage.caseVersion !== entry.caseVersion ||
      casePackage.schemaVersion !== entry.casePackageSchemaVersion ||
      casePackage.packageStatus !== entry.packageStatus ||
      casePackage.patientPersona.personaTemplateId !== entry.personaTemplateId ||
      (patientRoleId !== undefined && patientRoleId !== entry.patientRoleId);
    if (bindingMismatch) {
      addTechnicalFinding({
        code: "CASE_BINDING_MISMATCH",
        publicCaseId: entry.publicCaseId,
        message: "case package does not match its manifest identity binding",
      });
    }
    if (
      casePackage.provenance.contentHash !== entry.contentHash ||
      computeCaseContentHash(casePackage) !== entry.contentHash
    ) {
      addTechnicalFinding({
        code: "CONTENT_HASH_MISMATCH",
        publicCaseId: entry.publicCaseId,
        message: "case package canonical hash does not match the manifest",
      });
    }

    if (entry.reviewStatus === "missing") {
      if (entry.reviewRecordPath !== undefined) {
        addTechnicalFinding({
          code: "REVIEW_BINDING_MISMATCH",
          publicCaseId: entry.publicCaseId,
          message: "missing review status must not bind a review record",
        });
      }
      continue;
    }
    if (reviewRecordPath === undefined || !existsSync(reviewRecordPath)) {
      if (entry.reviewRecordPath === undefined) {
        addTechnicalFinding({
          code: "MISSING_REVIEW_RECORD",
          publicCaseId: entry.publicCaseId,
          message: "non-missing review status requires a review record",
        });
      }
      continue;
    }
    try {
      const review = JSON.parse(readFileSync(reviewRecordPath, "utf8")) as unknown;
      const record = review as {
        schemaVersion?: string;
        caseId?: string;
        caseVersion?: string;
        contentHash?: string;
        decision?: string;
      };
      const ownBinding = {
        caseId: String(record.caseId ?? ""),
        caseVersion: String(record.caseVersion ?? ""),
        contentHash: String(record.contentHash ?? ""),
      };
      if (record.schemaVersion === "ai-case-cross-validation-v1") {
        assertAiCaseCrossValidationV1(review, ownBinding);
      } else if (record.schemaVersion === "ai-case-cross-review-v3") {
        assertAiCaseCrossReviewV3(review, ownBinding);
      } else {
        throw new Error(`unsupported review schema: ${String(record.schemaVersion)}`);
      }
      const identityMatches =
        record.caseId === casePackage.internalCaseId &&
        record.caseVersion === casePackage.caseVersion;
      const contentHashMatches =
        record.contentHash === casePackage.provenance.contentHash;
      const decisionMatches = entry.reviewStatus === "stale" ||
        record.decision === entry.reviewStatus;
      if (
        !identityMatches ||
        (entry.reviewStatus !== "stale" && !contentHashMatches) ||
        !decisionMatches
      ) {
        addTechnicalFinding({
          code: "REVIEW_BINDING_MISMATCH",
          publicCaseId: entry.publicCaseId,
          message: "review record does not match manifest status or case binding",
        });
      }
    } catch (error) {
      addTechnicalFinding({
        code: "REVIEW_FILE_INVALID",
        publicCaseId: entry.publicCaseId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { technicalIssues, findings };
}

export function resolveCaseManifestArtifactPath(
  casesDirectory: string,
  artifactPath: string,
): string {
  const path = resolveManifestArtifact(casesDirectory, artifactPath);
  if (path === undefined) {
    throw new Error(`manifest artifact path is unsafe: ${artifactPath}`);
  }
  return path;
}

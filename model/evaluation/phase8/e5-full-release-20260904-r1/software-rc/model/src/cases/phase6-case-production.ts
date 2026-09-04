import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  assertAiCaseCrossReviewV3,
  assertCasePackage,
  assertCasePackageV2,
  assertSupportedCasePackage,
  type AiCaseCrossReviewV3,
  type AiCaseCrossValidationV1,
  type CasePackage,
  type CasePackageV2,
  type SupportedCasePackage,
} from "../domain/case-package.js";
import { computeCaseContentHash } from "../domain/case-content-hash.js";
import { assertCasePackageJsonSchema } from "../domain/case-package-schema.js";
import { patientDialogueMetadataIssues } from "../domain/safe-patient-case-view.js";
import { evaluateMedicalSafetyV1 } from "../safety/medical-safety-policy-v1.js";
import {
  inspectCaseManifestArtifacts,
  loadCaseManifestV2,
  resolveCaseManifestArtifactPath,
  validateCaseManifestV2,
  type CaseManifestEntryV2,
  type CaseManifestReleasePolicy,
  type CaseManifestReviewStatus,
  type CaseManifestV2,
  type CaseManifestValidationReport,
} from "./case-manifest.js";
import {
  getRequiredRedFlagIds,
  loadRedFlagPolicyV2,
} from "./red-flag-policy.js";

export const PHASE6_TRAJECTORY_SCHEMA_VERSION =
  "case-regression-trajectories-v1" as const;

export type RegressionTrajectoryKind =
  | "success"
  | "failure"
  | "safety"
  | "unknown";

export interface RegressionAskStep {
  action: "ask";
  input: string;
  expectedFactIds: string[];
}

export interface RegressionTestStep {
  action: "test";
  testId: string;
}

export interface RegressionDiagnosisStep {
  action: "diagnose";
  primaryDiagnosis: string;
  differentials: string[];
}

export type RegressionStep =
  | RegressionAskStep
  | RegressionTestStep
  | RegressionDiagnosisStep;

export interface RegressionTrajectory {
  trajectoryId: string;
  kind: RegressionTrajectoryKind;
  steps: RegressionStep[];
  expected: {
    diagnosisMatch?: "exact" | "synonym" | "incorrect";
    safetyCode?: string;
    providerCalls?: number;
    rawTextWrites?: number;
    medicalTurns?: number;
  };
}

export interface CaseRegressionTrajectoriesV1 {
  schemaVersion: typeof PHASE6_TRAJECTORY_SCHEMA_VERSION;
  caseId: string;
  caseVersion: string;
  trajectories: RegressionTrajectory[];
}

export type { AiCaseCrossValidationV1 } from "../domain/case-package.js";
export { computeCaseContentHash } from "../domain/case-content-hash.js";

export interface Phase6CaseBundle {
  casePackage: SupportedCasePackage;
  trajectories: CaseRegressionTrajectoriesV1;
  aiCrossValidation?: AiCaseCrossValidationV1;
  aiCrossReview?: AiCaseCrossReviewV3;
  manifestEntry?: CaseManifestEntryV2;
}

export interface Phase6CaseValidationReport {
  structuralIssues: string[];
  publicationBlockers: Array<
    | "AI_CROSS_VALIDATION_MISSING"
    | "AI_CROSS_VALIDATION_INVALID"
  >;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseTrajectoryDocument(value: unknown): CaseRegressionTrajectoriesV1 {
  if (!isRecord(value)) throw new Error("trajectory document must be an object");
  if (value.schemaVersion !== PHASE6_TRAJECTORY_SCHEMA_VERSION) {
    throw new Error("trajectory schemaVersion is invalid");
  }
  if (!isNonEmptyString(value.caseId) || !isNonEmptyString(value.caseVersion)) {
    throw new Error("trajectory caseId and caseVersion are required");
  }
  if (!Array.isArray(value.trajectories)) {
    throw new Error("trajectory collection is required");
  }
  return value as unknown as CaseRegressionTrajectoriesV1;
}

export function loadPhase6CaseBundles(
  casesDirectory = "cases",
): Phase6CaseBundle[] {
  return loadPhase6CaseBundlesFromManifest({
    casesDirectory,
    manifestPath: join(
      casesDirectory,
      "manifest.phase6-compat.v2-rc2.json",
    ),
  }).bundles;
}

export function loadPhase6CaseBundlesFromManifest(input: {
  casesDirectory: string;
  manifest?: CaseManifestV2;
  manifestPath?: string;
}): {
  manifest: CaseManifestV2;
  bundles: Phase6CaseBundle[];
  report: CaseManifestValidationReport;
} {
  const manifest = input.manifest ?? loadCaseManifestV2(
    input.manifestPath ?? join(
      input.casesDirectory,
      "manifest.phase6-compat.v2-rc2.json",
    ),
  );
  const report = validateCaseManifestV2(manifest);
  if (report.technicalIssues.length > 0) {
    throw new Error(
      `case manifest is technically invalid: ${report.technicalIssues.join("; ")}`,
    );
  }
  const artifactReport = inspectCaseManifestArtifacts(
    manifest,
    input.casesDirectory,
  );
  if (artifactReport.technicalIssues.length > 0) {
    throw new Error(
      `case manifest artifacts are invalid: ${artifactReport.technicalIssues.join("; ")}`,
    );
  }

  const bundles = manifest.cases.map((entry) => {
    const casePath = resolveCaseManifestArtifactPath(
      input.casesDirectory,
      entry.path,
    );
    const trajectoryPath = resolveCaseManifestArtifactPath(
      input.casesDirectory,
      entry.regressionPath,
    );
    const parsedCase: unknown = JSON.parse(readFileSync(casePath, "utf8"));
    assertCasePackageJsonSchema(parsedCase);
    assertSupportedCasePackage(parsedCase);
    const parsedTrajectories: unknown = JSON.parse(
      readFileSync(trajectoryPath, "utf8"),
    );
    const validationPath = entry.reviewRecordPath === undefined
      ? undefined
      : resolveCaseManifestArtifactPath(
          input.casesDirectory,
          entry.reviewRecordPath,
        );
    return {
      casePackage: parsedCase,
      trajectories: parseTrajectoryDocument(parsedTrajectories),
      manifestEntry: structuredClone(entry),
       ...(validationPath !== undefined && existsSync(validationPath)
         ? parsedCase.schemaVersion === "case-package-v1-rc1"
           ? {
               aiCrossValidation: JSON.parse(
                 readFileSync(validationPath, "utf8"),
               ) as AiCaseCrossValidationV1,
             }
           : {
               aiCrossReview: JSON.parse(
                 readFileSync(validationPath, "utf8"),
               ) as AiCaseCrossReviewV3,
             }
         : {}),
    };
  });
  return {
    manifest,
    bundles,
    report: {
      ...report,
      findings: [...report.findings, ...artifactReport.findings],
    },
  };
}

function validateTrajectoryBundle(
  trajectories: CaseRegressionTrajectoriesV1,
  casePackage: SupportedCasePackage,
): string[] {
  const issues: string[] = [];
  if (trajectories.caseId !== casePackage.internalCaseId) {
    issues.push("trajectory caseId must match internalCaseId");
  }
  if (trajectories.caseVersion !== casePackage.caseVersion) {
    issues.push("trajectory caseVersion must match caseVersion");
  }
  const kinds = trajectories.trajectories.map(({ kind }) => kind);
  for (const requiredKind of ["success", "failure", "safety", "unknown"] as const) {
    if (kinds.filter((kind) => kind === requiredKind).length !== 1) {
      issues.push(`trajectory kind ${requiredKind} must appear exactly once`);
    }
  }
  const ids = new Set<string>();
  const targetTerms = new Set([
    casePackage.answerKey.targetDiagnosis,
    ...casePackage.answerKey.acceptedSynonyms,
  ]);
  for (const trajectory of trajectories.trajectories) {
    if (!ID_PATTERN.test(trajectory.trajectoryId)) {
      issues.push(`trajectory ${trajectory.trajectoryId} has an invalid ID`);
    } else if (ids.has(trajectory.trajectoryId)) {
      issues.push(`trajectory ${trajectory.trajectoryId} is duplicated`);
    } else {
      ids.add(trajectory.trajectoryId);
    }
    if (!Array.isArray(trajectory.steps) || trajectory.steps.length === 0) {
      issues.push(`trajectory ${trajectory.trajectoryId} has no steps`);
      continue;
    }
    const askedFactIds = new Set<string>();
    const orderedTestIds = new Set<string>();
    const diagnosisSteps: RegressionDiagnosisStep[] = [];
    for (const step of trajectory.steps) {
      if (step.action === "ask") {
        if (!isNonEmptyString(step.input) || !Array.isArray(step.expectedFactIds)) {
          issues.push(`trajectory ${trajectory.trajectoryId} has an invalid ask step`);
          continue;
        }
        for (const factId of step.expectedFactIds) {
          askedFactIds.add(factId);
          if (!Object.hasOwn(casePackage.patientFacts, factId)) {
            issues.push(`trajectory ${trajectory.trajectoryId} references unknown fact ${factId}`);
          }
        }
      } else if (step.action === "test") {
        orderedTestIds.add(step.testId);
        if (!Object.hasOwn(casePackage.medicalTests, step.testId)) {
          issues.push(`trajectory ${trajectory.trajectoryId} references unknown test ${step.testId}`);
        }
      } else if (step.action === "diagnose") {
        diagnosisSteps.push(step);
      } else {
        issues.push(`trajectory ${trajectory.trajectoryId} has an unknown step action`);
      }
    }
    if (trajectory.kind === "success") {
      for (const factId of casePackage.rubric.mustAskFactIds) {
        if (!askedFactIds.has(factId)) {
          issues.push(`success trajectory is missing must-ask fact ${factId}`);
        }
      }
      for (const [testId, classification] of Object.entries(
        casePackage.rubric.testClassifications,
      )) {
        if (classification === "required" && !orderedTestIds.has(testId)) {
          issues.push(`success trajectory is missing required test ${testId}`);
        }
      }
      if (
        diagnosisSteps.length !== 1 ||
        !targetTerms.has(diagnosisSteps[0]!.primaryDiagnosis) ||
        trajectory.expected.diagnosisMatch === "incorrect"
      ) {
        issues.push("success trajectory must submit the reviewed target diagnosis");
      }
    }
    if (trajectory.kind === "failure") {
      if (
        diagnosisSteps.length !== 1 ||
        targetTerms.has(diagnosisSteps[0]!.primaryDiagnosis) ||
        trajectory.expected.diagnosisMatch !== "incorrect"
      ) {
        issues.push("failure trajectory must submit an incorrect diagnosis");
      }
    }
    if (trajectory.kind === "unknown") {
      const hasUnknownFact = [...askedFactIds].some(
        (factId) => casePackage.patientFacts[factId]?.status === "unknown",
      );
      if (!hasUnknownFact) {
        issues.push("unknown trajectory must exercise an unknown fact");
      }
    }
    if (trajectory.kind === "safety") {
      const safetyInput = trajectory.steps.find(
        (step): step is RegressionAskStep => step.action === "ask",
      )?.input;
      const safetyDecision = safetyInput === undefined
        ? "ALLOW_GAME"
        : evaluateMedicalSafetyV1({
            text: safetyInput,
            context: "fictional_case_session",
          }).decision;
      const expectedSafetyCode =
        safetyDecision === "EXIT_SELF_HARM_CRISIS" ||
        safetyDecision === "EXIT_URGENT_RED_FLAG"
          ? "SAFETY_INTERRUPTED"
          : safetyDecision === "ALLOW_GAME"
            ? undefined
            : "SAFETY_REAL_HEALTH_INPUT";
      if (
        !isNonEmptyString(trajectory.expected.safetyCode) ||
        trajectory.expected.providerCalls !== 0 ||
        trajectory.expected.rawTextWrites !== 0 ||
        trajectory.expected.medicalTurns !== 0
      ) {
        issues.push("safety trajectory must require zero external and medical side effects");
      }
      if (
        expectedSafetyCode === undefined ||
        trajectory.expected.safetyCode !== expectedSafetyCode
      ) {
        issues.push("safety trajectory code must match MedicalSafetyPolicy v1");
      }
    }
  }
  return issues;
}

export function validatePhase6CaseBundle(
  bundle: Phase6CaseBundle,
  releasePolicy?: CaseManifestReleasePolicy,
): Phase6CaseValidationReport {
  const structuralIssues: string[] = [];
  const { casePackage } = bundle;
  try {
    assertCasePackageJsonSchema(casePackage);
    assertSupportedCasePackage(casePackage);
  } catch (error) {
    structuralIssues.push(error instanceof Error ? error.message : String(error));
  }
  if (casePackage.packageStatus !== "draft" && casePackage.packageStatus !== "published") {
    structuralIssues.push("Phase 6 case package must be draft or published");
  }
  if (casePackage.locale !== "zh-CN") structuralIssues.push("locale must be zh-CN");
  const facts = Object.values(casePackage.patientFacts);
  const countDisclosure = (disclosure: string) =>
    facts.filter((fact) => fact.disclosure === disclosure).length;
  const countStatus = (status: string) =>
    facts.filter((fact) => fact.status === status).length;
  if (countDisclosure("spontaneous") < 1) structuralIssues.push("at least one spontaneous fact is required");
  if (countDisclosure("if_asked") < 10) structuralIssues.push("at least ten if_asked facts are required");
  if (countDisclosure("test_only") < 1) structuralIssues.push("at least one test_only fact is required");
  if (countDisclosure("hidden") < 1) structuralIssues.push("at least one hidden fact is required");
  if (countStatus("present") < 2) structuralIssues.push("at least two present facts are required");
  if (countStatus("absent") < 2) structuralIssues.push("at least two absent facts are required");
  if (countStatus("unknown") < 1) structuralIssues.push("at least one unknown fact is required");
  const classifications = Object.values(casePackage.rubric.testClassifications);
  if (!classifications.includes("required")) structuralIssues.push("at least one required test is required");
  if (!classifications.includes("unnecessary")) structuralIssues.push("at least one unnecessary test is required");
  structuralIssues.push(...patientDialogueMetadataIssues(casePackage));
  const redFlagPolicy = loadRedFlagPolicyV2();
  const diseaseDomainId = bundle.manifestEntry?.diseaseDomainId;
  if (diseaseDomainId === undefined) {
    structuralIssues.push("manifest disease domain binding is required");
  }
  const redFlagIds = new Set(
    casePackage.redFlagExclusionMatrix.entries.map(({ redFlagId }) => redFlagId),
  );
  if (diseaseDomainId !== undefined) {
    let requiredRedFlagIds: string[] = [];
    try {
      requiredRedFlagIds = getRequiredRedFlagIds(
        redFlagPolicy,
        diseaseDomainId,
      );
    } catch (error) {
      structuralIssues.push(error instanceof Error ? error.message : String(error));
    }
    for (const redFlagId of requiredRedFlagIds) {
      if (!redFlagIds.has(redFlagId)) {
        structuralIssues.push(`missing red-flag matrix entry ${redFlagId}`);
      }
    }
  }
  const expectedHash = computeCaseContentHash(casePackage);
  if (casePackage.provenance.contentHash !== expectedHash) {
    structuralIssues.push("provenance.contentHash does not match the canonical case content");
  }
  structuralIssues.push(...validateTrajectoryBundle(bundle.trajectories, casePackage));
  if (
    releasePolicy !== undefined &&
    bundle.trajectories.trajectories.length <
      releasePolicy.minimumRegressionTrajectoriesPerCase
  ) {
    structuralIssues.push(
      `case requires at least ${releasePolicy.minimumRegressionTrajectoriesPerCase} regression trajectories`,
    );
  }

  const publicationBlockers: Phase6CaseValidationReport["publicationBlockers"] = [];
  const releaseValidation =
    casePackage.schemaVersion === "case-package-v1-rc1"
      ? bundle.aiCrossValidation ?? casePackage.releaseValidation
      : undefined;
  if (casePackage.schemaVersion === "case-package-v1-rc1") {
    if (releaseValidation === undefined) {
      publicationBlockers.push("AI_CROSS_VALIDATION_MISSING");
    } else if (
      validateAiCrossValidation(casePackage, releaseValidation).length > 0
    ) {
      publicationBlockers.push("AI_CROSS_VALIDATION_INVALID");
    }
  }
  return { structuralIssues, publicationBlockers };
}

function validateAiCrossValidation(
  sourceCasePackage: CasePackage,
  validation: AiCaseCrossValidationV1,
): string[] {
  const candidate = structuredClone(sourceCasePackage);
  candidate.packageStatus = "published";
  candidate.provenance.contentHash = computeCaseContentHash(candidate);
  candidate.releaseValidation = structuredClone(validation);
  try {
    assertCasePackageJsonSchema(candidate);
    assertCasePackage(candidate);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

export interface Phase6PublicationFileOperations {
  writeFile(path: string, content: string): void;
  rename(source: string, destination: string): void;
  remove(path: string): void;
}

const DEFAULT_PUBLICATION_FILE_OPERATIONS: Phase6PublicationFileOperations = {
  writeFile(path, content) {
    writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
  },
  rename(source, destination) {
    renameSync(source, destination);
  },
  remove(path) {
    rmSync(path, { force: true });
  },
};

function resolvePublicationArtifactPath(
  outputDirectory: string,
  fileName: string,
): string {
  const outputRoot = resolve(outputDirectory);
  const artifactPath = resolve(outputRoot, fileName);
  const relativePath = relative(outputRoot, artifactPath);
  if (
    relativePath.length === 0 ||
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    throw new Error("publication artifact path must stay within output directory");
  }
  return artifactPath;
}

export function publishAiValidatedCase(input: {
  bundle: Phase6CaseBundle;
  validation: AiCaseCrossValidationV1;
  outputDirectory: string;
  fileOperations?: Phase6PublicationFileOperations;
}): { casePackage: CasePackage; outputPath: string; validationRecordPath: string } {
  if (input.bundle.casePackage.schemaVersion !== "case-package-v1-rc1") {
    throw new Error(
      "legacy AI-validated publication only supports CasePackage v1; v2 uses non-blocking manifest publication",
    );
  }
  const legacyBundle = input.bundle as Phase6CaseBundle & {
    casePackage: CasePackage;
  };
  const report = validatePhase6CaseBundle({
    ...legacyBundle,
    aiCrossValidation: input.validation,
  });
  if (report.structuralIssues.length > 0) {
    throw new Error(`case bundle is not structurally ready: ${report.structuralIssues.join("; ")}`);
  }
  const validationIssues = validateAiCrossValidation(
    legacyBundle.casePackage,
    input.validation,
  );
  if (report.publicationBlockers.length > 0 || validationIssues.length > 0) {
    throw new Error(
      `AI cross-validation failed: ${validationIssues.join("; ") || report.publicationBlockers.join(", ")}`,
    );
  }

  const casePackage = structuredClone(legacyBundle.casePackage);
  const contentHash = computeCaseContentHash(casePackage);
  casePackage.packageStatus = "published";
  casePackage.provenance.contentHash = contentHash;
  casePackage.releaseValidation = structuredClone(input.validation);
  assertCasePackageJsonSchema(casePackage);
  assertCasePackage(casePackage);
  if (computeCaseContentHash(casePackage) !== contentHash) {
    throw new Error("published case content hash changed during AI validation materialization");
  }

  const outputDirectory = resolve(input.outputDirectory);
  mkdirSync(outputDirectory, { recursive: true });
  const portablePublicCaseId = encodeURIComponent(casePackage.publicCaseId);
  const baseName = `${portablePublicCaseId}--${casePackage.caseVersion}`;
  const outputPath = resolvePublicationArtifactPath(
    outputDirectory,
    `${baseName}.json`,
  );
  const validationRecordPath = resolvePublicationArtifactPath(
    outputDirectory,
    `${baseName}.ai-validation.json`,
  );
  const fileOperations =
    input.fileOperations ?? DEFAULT_PUBLICATION_FILE_OPERATIONS;
  const publicationLockPath = resolvePublicationArtifactPath(
    outputDirectory,
    `.${baseName}.publish.lock`,
  );
  try {
    writeFileSync(publicationLockPath, `${process.pid}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (isRecord(error) && error["code"] === "EEXIST") {
      throw new Error(`publication already in progress: ${baseName}`);
    }
    throw error;
  }

  try {
    if (existsSync(outputPath)) {
      throw new Error(`published case version already exists: ${baseName}`);
    }
    if (existsSync(validationRecordPath)) {
      throw new Error(`published validation version already exists: ${baseName}`);
    }
    const stagingId = randomUUID();
    const stagedCasePath = resolvePublicationArtifactPath(
      outputDirectory,
      `.${baseName}.${stagingId}.case.tmp`,
    );
    const stagedValidationPath = resolvePublicationArtifactPath(
      outputDirectory,
      `.${baseName}.${stagingId}.validation.tmp`,
    );

    let validationRenamed = false;
    try {
      fileOperations.writeFile(
        stagedCasePath,
        `${JSON.stringify(casePackage, null, 2)}\n`,
      );
      fileOperations.writeFile(
        stagedValidationPath,
        `${JSON.stringify(casePackage.releaseValidation, null, 2)}\n`,
      );
      fileOperations.rename(stagedValidationPath, validationRecordPath);
      validationRenamed = true;
      fileOperations.rename(stagedCasePath, outputPath);
    } catch (error) {
      fileOperations.remove(stagedCasePath);
      fileOperations.remove(stagedValidationPath);
      if (validationRenamed && !existsSync(outputPath) && existsSync(validationRecordPath)) {
        fileOperations.remove(validationRecordPath);
      }
      throw error;
    }
    return { casePackage, outputPath, validationRecordPath };
  } finally {
    rmSync(publicationLockPath, { force: true });
  }
}

export interface ManifestCasePublicationResult {
  casePackage: CasePackageV2;
  outputPath: string;
  reviewRecordPath: string;
  reviewStatus: CaseManifestReviewStatus;
  findings: string[];
}

function notRunReview(casePackage: CasePackageV2): AiCaseCrossReviewV3 {
  return {
    schemaVersion: "ai-case-cross-review-v3",
    caseId: casePackage.internalCaseId,
    caseVersion: casePackage.caseVersion,
    contentHash: casePackage.provenance.contentHash,
    decision: "not_run",
    validations: [],
    findings: ["AI cross-review was not run before candidate publication."],
  };
}

export function publishManifestCaseCandidate(input: {
  casePackage: CasePackageV2;
  review?: AiCaseCrossReviewV3 | undefined;
  reviewStatus: Exclude<CaseManifestReviewStatus, "missing">;
  outputDirectory: string;
  fileOperations?: Phase6PublicationFileOperations;
}): ManifestCasePublicationResult {
  const casePackage = structuredClone(input.casePackage);
  delete casePackage.releaseReview;
  casePackage.provenance.contentHash = computeCaseContentHash(casePackage);
  assertCasePackageJsonSchema(casePackage);
  assertCasePackageV2(casePackage);

  const review = structuredClone(input.review ?? notRunReview(casePackage));
  assertAiCaseCrossReviewV3(review, {
    caseId: review.caseId,
    caseVersion: review.caseVersion,
    contentHash: review.contentHash,
  });
  const reviewIdentityMatches =
    review.caseId === casePackage.internalCaseId &&
    review.caseVersion === casePackage.caseVersion;
  if (!reviewIdentityMatches) {
    throw new Error("review evidence does not match the case identity");
  }
  const reviewContentHashMatches =
    review.contentHash === casePackage.provenance.contentHash;
  const reviewStatus: Exclude<CaseManifestReviewStatus, "missing"> =
    reviewContentHashMatches ? review.decision : "stale";
  if (input.reviewStatus !== reviewStatus) {
    throw new Error(
      `reviewStatus does not match review evidence: expected ${reviewStatus}, received ${input.reviewStatus}`,
    );
  }
  casePackage.packageStatus = "published";
  if (reviewContentHashMatches) casePackage.releaseReview = review;
  assertCasePackageJsonSchema(casePackage);
  assertCasePackageV2(casePackage);
  if (computeCaseContentHash(casePackage) !== casePackage.provenance.contentHash) {
    throw new Error("published case content hash changed during review materialization");
  }

  const outputDirectory = resolve(input.outputDirectory);
  mkdirSync(outputDirectory, { recursive: true });
  const portablePublicCaseId = encodeURIComponent(casePackage.publicCaseId);
  const baseName = `${portablePublicCaseId}--${casePackage.caseVersion}`;
  const outputPath = resolvePublicationArtifactPath(
    outputDirectory,
    `${baseName}.json`,
  );
  const reviewRecordPath = resolvePublicationArtifactPath(
    outputDirectory,
    `${baseName}.ai-review.json`,
  );
  const publicationLockPath = resolvePublicationArtifactPath(
    outputDirectory,
    `.${baseName}.publish.lock`,
  );
  try {
    writeFileSync(publicationLockPath, `${process.pid}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (isRecord(error) && error["code"] === "EEXIST") {
      throw new Error(`publication already in progress: ${baseName}`);
    }
    throw error;
  }

  const fileOperations = input.fileOperations ?? DEFAULT_PUBLICATION_FILE_OPERATIONS;
  try {
    if (existsSync(outputPath) || existsSync(reviewRecordPath)) {
      throw new Error(`published case or review already exists: ${baseName}`);
    }
    const stagingId = randomUUID();
    const stagedCasePath = resolvePublicationArtifactPath(
      outputDirectory,
      `.${baseName}.${stagingId}.case.tmp`,
    );
    const stagedReviewPath = resolvePublicationArtifactPath(
      outputDirectory,
      `.${baseName}.${stagingId}.review.tmp`,
    );
    let reviewRenamed = false;
    try {
      fileOperations.writeFile(
        stagedCasePath,
        `${JSON.stringify(casePackage, null, 2)}\n`,
      );
      fileOperations.writeFile(
        stagedReviewPath,
        `${JSON.stringify(review, null, 2)}\n`,
      );
      fileOperations.rename(stagedReviewPath, reviewRecordPath);
      reviewRenamed = true;
      fileOperations.rename(stagedCasePath, outputPath);
    } catch (error) {
      fileOperations.remove(stagedCasePath);
      fileOperations.remove(stagedReviewPath);
      if (reviewRenamed && !existsSync(outputPath) && existsSync(reviewRecordPath)) {
        fileOperations.remove(reviewRecordPath);
      }
      throw error;
    }
  } finally {
    rmSync(publicationLockPath, { force: true });
  }

  return {
    casePackage,
    outputPath,
    reviewRecordPath,
    reviewStatus,
    findings: [
      ...(reviewStatus === "approved"
        ? []
        : [`AI_REVIEW_${reviewStatus.toUpperCase()}`]),
      ...review.findings,
    ],
  };
}

export function publishManifestReviewArtifacts(input: {
  casePackage: SupportedCasePackage;
  review: AiCaseCrossReviewV3;
  outputDirectory: string;
  fileOperations?: Phase6PublicationFileOperations;
}): {
  casePackage: SupportedCasePackage;
  candidatePath: string;
  reviewRecordPath: string;
  reviewStatus: Exclude<CaseManifestReviewStatus, "missing" | "stale">;
} {
  const casePackage = structuredClone(input.casePackage);
  assertCasePackageJsonSchema(casePackage);
  assertSupportedCasePackage(casePackage);
  const contentHash = casePackage.provenance.contentHash;
  if (contentHash === undefined) {
    throw new Error("case candidate content hash is required");
  }
  const review = structuredClone(input.review);
  assertAiCaseCrossReviewV3(review, {
    caseId: casePackage.internalCaseId,
    caseVersion: casePackage.caseVersion,
    contentHash,
  });
  const outputDirectory = resolve(input.outputDirectory);
  mkdirSync(outputDirectory, { recursive: true });
  const baseName = `${encodeURIComponent(casePackage.publicCaseId)}--${casePackage.caseVersion}`;
  const candidatePath = resolvePublicationArtifactPath(
    outputDirectory,
    `${baseName}.candidate.json`,
  );
  const reviewRecordPath = resolvePublicationArtifactPath(
    outputDirectory,
    `${baseName}.ai-review.json`,
  );
  const publicationLockPath = resolvePublicationArtifactPath(
    outputDirectory,
    `.${baseName}.publish.lock`,
  );
  try {
    writeFileSync(publicationLockPath, `${process.pid}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (isRecord(error) && error["code"] === "EEXIST") {
      throw new Error(`publication already in progress: ${baseName}`);
    }
    throw error;
  }
  const fileOperations = input.fileOperations ?? DEFAULT_PUBLICATION_FILE_OPERATIONS;
  try {
    if (existsSync(candidatePath) || existsSync(reviewRecordPath)) {
      throw new Error(`candidate case or review already exists: ${baseName}`);
    }
    const stagingId = randomUUID();
    const stagedCasePath = resolvePublicationArtifactPath(
      outputDirectory,
      `.${baseName}.${stagingId}.case.tmp`,
    );
    const stagedReviewPath = resolvePublicationArtifactPath(
      outputDirectory,
      `.${baseName}.${stagingId}.review.tmp`,
    );
    let reviewRenamed = false;
    try {
      fileOperations.writeFile(stagedCasePath, `${JSON.stringify(casePackage, null, 2)}\n`);
      fileOperations.writeFile(stagedReviewPath, `${JSON.stringify(review, null, 2)}\n`);
      fileOperations.rename(stagedReviewPath, reviewRecordPath);
      reviewRenamed = true;
      fileOperations.rename(stagedCasePath, candidatePath);
    } catch (error) {
      fileOperations.remove(stagedCasePath);
      fileOperations.remove(stagedReviewPath);
      if (reviewRenamed && !existsSync(candidatePath) && existsSync(reviewRecordPath)) {
        fileOperations.remove(reviewRecordPath);
      }
      throw error;
    }
  } finally {
    rmSync(publicationLockPath, { force: true });
  }
  return {
    casePackage,
    candidatePath,
    reviewRecordPath,
    reviewStatus: review.decision,
  };
}

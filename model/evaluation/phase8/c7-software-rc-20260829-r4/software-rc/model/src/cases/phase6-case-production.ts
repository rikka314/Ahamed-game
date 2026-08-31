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
  assertCasePackage,
  type AiCaseCrossValidationV1,
  type CasePackage,
} from "../domain/case-package.js";
import { computeCaseContentHash } from "../domain/case-content-hash.js";
import { assertCasePackageJsonSchema } from "../domain/case-package-schema.js";
import { patientDialogueMetadataIssues } from "../domain/safe-patient-case-view.js";
import { evaluateMedicalSafetyV1 } from "../safety/medical-safety-policy-v1.js";

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
  casePackage: CasePackage;
  trajectories: CaseRegressionTrajectoriesV1;
  aiCrossValidation?: AiCaseCrossValidationV1;
}

export interface Phase6CaseValidationReport {
  structuralIssues: string[];
  publicationBlockers: Array<
    | "AI_CROSS_VALIDATION_MISSING"
    | "AI_CROSS_VALIDATION_INVALID"
  >;
}

const PHASE6_CASE_FILES = [
  "c01-common-cold-v1.json",
  "c02-influenza-v1.json",
  "c03-acute-pharyngitis-v1.json",
  "c04-acute-bronchitis-v1.json",
  "c05-mild-cap-v1.json",
] as const;

const REQUIRED_RED_FLAG_IDS = [
  "redflag.dyspnea",
  "redflag.confusion",
  "redflag.chest_pain",
  "redflag.hemoptysis",
  "redflag.hypotension",
  "redflag.tachypnea",
  "redflag.hypoxemia",
  "redflag.inability_oral_intake",
  "redflag.high_risk_population",
] as const;

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
  return PHASE6_CASE_FILES.map((fileName) => {
    const casePath = join(casesDirectory, "draft", fileName);
    const trajectoryPath = join(
      casesDirectory,
      "regression",
      fileName.replace(/\.json$/u, ".trajectories.json"),
    );
    const parsedCase: unknown = JSON.parse(readFileSync(casePath, "utf8"));
    assertCasePackageJsonSchema(parsedCase);
    assertCasePackage(parsedCase);
    const parsedTrajectories: unknown = JSON.parse(
      readFileSync(trajectoryPath, "utf8"),
    );
    const validationPath = join(
      casesDirectory,
      "ai-validation",
      fileName.replace(/\.json$/u, ".ai-validation.json"),
    );
    return {
      casePackage: parsedCase,
      trajectories: parseTrajectoryDocument(parsedTrajectories),
      ...(existsSync(validationPath)
        ? {
            aiCrossValidation: JSON.parse(
              readFileSync(validationPath, "utf8"),
            ) as AiCaseCrossValidationV1,
          }
        : {}),
    };
  });
}

function validateTrajectoryBundle(
  trajectories: CaseRegressionTrajectoriesV1,
  casePackage: CasePackage,
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
): Phase6CaseValidationReport {
  const structuralIssues: string[] = [];
  const { casePackage } = bundle;
  try {
    assertCasePackageJsonSchema(casePackage);
    assertCasePackage(casePackage);
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
  const redFlagIds = new Set(
    casePackage.redFlagExclusionMatrix.entries.map(({ redFlagId }) => redFlagId),
  );
  for (const redFlagId of REQUIRED_RED_FLAG_IDS) {
    if (!redFlagIds.has(redFlagId)) structuralIssues.push(`missing red-flag matrix entry ${redFlagId}`);
  }
  const expectedHash = computeCaseContentHash(casePackage);
  if (casePackage.provenance.contentHash !== expectedHash) {
    structuralIssues.push("provenance.contentHash does not match the canonical case content");
  }
  structuralIssues.push(...validateTrajectoryBundle(bundle.trajectories, casePackage));

  const publicationBlockers: Phase6CaseValidationReport["publicationBlockers"] = [];
  const releaseValidation =
    bundle.aiCrossValidation ?? casePackage.releaseValidation;
  if (releaseValidation === undefined) {
    publicationBlockers.push("AI_CROSS_VALIDATION_MISSING");
  } else if (
    validateAiCrossValidation(casePackage, releaseValidation).length > 0
  ) {
    publicationBlockers.push("AI_CROSS_VALIDATION_INVALID");
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
  const report = validatePhase6CaseBundle({
    ...input.bundle,
    aiCrossValidation: input.validation,
  });
  if (report.structuralIssues.length > 0) {
    throw new Error(`case bundle is not structurally ready: ${report.structuralIssues.join("; ")}`);
  }
  const validationIssues = validateAiCrossValidation(
    input.bundle.casePackage,
    input.validation,
  );
  if (report.publicationBlockers.length > 0 || validationIssues.length > 0) {
    throw new Error(
      `AI cross-validation failed: ${validationIssues.join("; ") || report.publicationBlockers.join(", ")}`,
    );
  }

  const casePackage = structuredClone(input.bundle.casePackage);
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
      fileOperations.remove(validationRecordPath);
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
      fileOperations.rename(stagedCasePath, outputPath);
    } catch (error) {
      fileOperations.remove(stagedCasePath);
      fileOperations.remove(stagedValidationPath);
      if (!existsSync(outputPath) && existsSync(validationRecordPath)) {
        fileOperations.remove(validationRecordPath);
      }
      throw error;
    }
    return { casePackage, outputPath, validationRecordPath };
  } finally {
    rmSync(publicationLockPath, { force: true });
  }
}

import { SCORING_POLICY_VERSION_V1 } from "@ahamed/doctor-game-share";

import type { PatientPersonaTemplateId } from "./patient-persona.js";

export const CASE_PACKAGE_SCHEMA_VERSION = "case-package-v1-rc1" as const;
export const SCORING_POLICY_VERSION = SCORING_POLICY_VERSION_V1;
export const AI_CASE_CROSS_VALIDATION_SCHEMA_VERSION =
  "ai-case-cross-validation-v1" as const;

export type FactStatus = "present" | "absent" | "unknown";
export type FactDisclosure = "spontaneous" | "if_asked" | "test_only" | "hidden";
export type TestClassification = "required" | "useful" | "unnecessary";

export interface PatientFact {
  status: FactStatus;
  value: string;
  disclosure: FactDisclosure;
  questionMatchers: string[];
}

export interface MedicalTestDefinition {
  status: "unavailable" | "completed";
  displayName?: string;
  aliases?: string[];
  report?: string;
  assetId?: string;
  reasonCode?: string;
}

export interface DiagnosisConcept {
  conceptId: string;
  preferredTerm: string;
  acceptedSynonyms: string[];
}

export interface ScoringRubricV1 {
  mustAskFactIds: string[];
  acceptableDifferentialConceptIds: string[];
  requiredDifferentialCount: 2;
  testClassifications: Record<string, TestClassification>;
  recommendedTurnLimit: number;
  communicationRubricVersion: string;
  communicationCriterionIds: string[];
}

export interface ReleaseApprovalV1 {
  reviewerId: string;
  caseId: string;
  caseVersion: string;
  contentHash: string;
  checklistVersion: string;
  decision: "approved" | "rejected";
  signedAt: string;
  signatureMethod: string;
}

export interface CaseReviewRecordV1 {
  status: "fixture" | "pending" | "approved" | "rejected";
  author: string;
  releaseApproval?: ReleaseApprovalV1;
  notes?: string;
}

export type AiValidationRole = "clinical_safety" | "diagnostic_quality";
export type AiValidationCheckResult = "pass" | "fail";

export interface AiCaseValidationV1 {
  validatorId: string;
  role: AiValidationRole;
  modelId: string;
  promptVersion: string;
  decision: "approved" | "rejected";
  validatedAt: string;
  checks: {
    clinicalConsistency: AiValidationCheckResult;
    diagnosisSolvability: AiValidationCheckResult;
    redFlagExclusions: AiValidationCheckResult;
    rubricConsistency: AiValidationCheckResult;
    regressionCoverage: AiValidationCheckResult;
    hiddenTruthSafety: AiValidationCheckResult;
  };
  findings: string[];
}

export interface AiCaseCrossValidationV1 {
  schemaVersion: typeof AI_CASE_CROSS_VALIDATION_SCHEMA_VERSION;
  caseId: string;
  caseVersion: string;
  contentHash: string;
  decision: "approved" | "rejected";
  validations: AiCaseValidationV1[];
}

export interface ProvenanceRecordV1 {
  sourceType: "synthetic" | "licensed";
  sourceCitation: string;
  license: string;
  createdAt: string;
  contentHash?: string;
}

export interface RedFlagExclusionEntryV1 {
  redFlagId: string;
  canonicalName: string;
  applicable: boolean;
  requiredState: "absent";
  evidenceFactIds: string[];
  evidenceType: string;
  observedValue: string | number;
  unit?: string;
  criterionSourceId: string;
  criterionSourceVersion: string;
  reviewDecision: "pending" | "approved" | "rejected";
}

export interface RedFlagExclusionMatrixV1 {
  matrixVersion: "red-flag-exclusion-matrix-v1";
  caseId: string;
  caseVersion: string;
  policyVersion: string;
  entries: RedFlagExclusionEntryV1[];
  review: {
    status: "fixture" | "pending" | "approved" | "rejected";
    reviewerId?: string;
    reviewedAt?: string;
  };
}

export interface CasePackage {
  schemaVersion: typeof CASE_PACKAGE_SCHEMA_VERSION;
  evaluationVersion: typeof SCORING_POLICY_VERSION;
  packageStatus: "fixture" | "draft" | "published" | "withdrawn";
  internalCaseId: string;
  publicCaseId: string;
  caseVersion: string;
  locale: string;
  playerVisible: {
    patientDisplayName: string;
    chiefComplaint: string;
    ageBand?: string;
    genderDisplay?: string;
  };
  patientPersona: {
    languageStyle: string;
    personaTemplateId?: PatientPersonaTemplateId;
    personaTemplateVersion?: string;
    educationOrOccupation?: string;
    dailyLife?: string;
    interests?: string[];
    communicationTraits?: string[];
  };
  patientFacts: Record<string, PatientFact>;
  medicalTests: Record<string, MedicalTestDefinition>;
  answerKey: {
    targetConceptId: string;
    targetDiagnosis: string;
    acceptedSynonyms: string[];
    diagnosisConcepts: DiagnosisConcept[];
  };
  rubric: ScoringRubricV1;
  review: CaseReviewRecordV1;
  releaseValidation?: AiCaseCrossValidationV1;
  provenance: ProvenanceRecordV1;
  redFlagExclusionMatrix: RedFlagExclusionMatrixV1;
}

export class CasePackageValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid case package: ${issues.join("; ")}`);
    this.name = "CasePackageValidationError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTerm(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const CASE_VERSION_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

function isStableId(value: unknown): value is string {
  return isNonEmptyString(value) && ID_PATTERN.test(value);
}

function isDateTime(value: unknown): value is string {
  return isNonEmptyString(value) && DATE_TIME_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: string[],
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) issues.push(`${path}.${key} is not allowed`);
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

function validateRubric(
  rubric: Record<string, unknown>,
  patientFacts: unknown,
  medicalTests: unknown,
  conceptIds: Set<string>,
  issues: string[],
): void {
  rejectUnknownKeys(
    rubric,
    [
      "mustAskFactIds",
      "acceptableDifferentialConceptIds",
      "requiredDifferentialCount",
      "testClassifications",
      "recommendedTurnLimit",
      "communicationRubricVersion",
      "communicationCriterionIds",
    ],
    "rubric",
    issues,
  );
  const mustAskFactIds = rubric.mustAskFactIds;
  if (!isStringArray(mustAskFactIds) || mustAskFactIds.length === 0) {
    issues.push("rubric.mustAskFactIds must be a non-empty string array");
  } else {
    if (hasDuplicates(mustAskFactIds)) issues.push("rubric.mustAskFactIds must not contain duplicates");
    if (mustAskFactIds.some((factId) => !isStableId(factId))) issues.push("rubric.mustAskFactIds contains an invalid ID");
    if (isRecord(patientFacts)) {
      for (const factId of mustAskFactIds) {
        const fact = patientFacts[factId];
        if (!isRecord(fact) || (fact.disclosure !== "if_asked" && fact.disclosure !== "spontaneous")) {
          issues.push(`rubric mustAsk fact "${factId}" is not askable`);
        }
      }
    }
  }

  const differentialIds = rubric.acceptableDifferentialConceptIds;
  if (!isStringArray(differentialIds) || differentialIds.length < 2) {
    issues.push("rubric.acceptableDifferentialConceptIds must contain at least two concept IDs");
  } else {
    if (hasDuplicates(differentialIds)) issues.push("rubric.acceptableDifferentialConceptIds must not contain duplicates");
    if (differentialIds.some((conceptId) => !isStableId(conceptId))) issues.push("rubric.acceptableDifferentialConceptIds contains an invalid ID");
    for (const conceptId of differentialIds) {
      if (!conceptIds.has(conceptId)) issues.push(`rubric differential concept "${conceptId}" is not defined`);
    }
  }
  if (rubric.requiredDifferentialCount !== 2) issues.push("rubric.requiredDifferentialCount must equal 2");

  const classifications = rubric.testClassifications;
  if (!isRecord(classifications)) {
    issues.push("rubric.testClassifications must be an object");
  } else if (isRecord(medicalTests)) {
    for (const testId of Object.keys(medicalTests)) {
      const classification = classifications[testId];
      if (classification !== "required" && classification !== "useful" && classification !== "unnecessary") {
        issues.push(`rubric test "${testId}" must have exactly one classification`);
      }
    }
    for (const testId of Object.keys(classifications)) {
      if (!Object.hasOwn(medicalTests, testId)) issues.push(`rubric test "${testId}" does not exist`);
    }
  }

  if (typeof rubric.recommendedTurnLimit !== "number" || !Number.isInteger(rubric.recommendedTurnLimit) || rubric.recommendedTurnLimit < 1 || rubric.recommendedTurnLimit > 20) {
    issues.push("rubric.recommendedTurnLimit must be an integer from 1 to 20");
  }
  if (!isNonEmptyString(rubric.communicationRubricVersion)) issues.push("rubric.communicationRubricVersion is required");
  if (!isStringArray(rubric.communicationCriterionIds) || rubric.communicationCriterionIds.length === 0) {
    issues.push("rubric.communicationCriterionIds must be a non-empty string array");
  } else {
    if (hasDuplicates(rubric.communicationCriterionIds)) issues.push("rubric.communicationCriterionIds must not contain duplicates");
    if (rubric.communicationCriterionIds.some((criterionId) => !isStableId(criterionId))) issues.push("rubric.communicationCriterionIds contains an invalid ID");
  }
}

function validateReview(
  review: unknown,
  casePackage: Record<string, unknown>,
  provenance: unknown,
  issues: string[],
): void {
  if (!isRecord(review) || !("fixture pending approved rejected".split(" ") as unknown[]).includes(review.status)) {
    issues.push("review.status is invalid");
    return;
  }

  rejectUnknownKeys(review, ["status", "author", "releaseApproval", "notes"], "review", issues);
  if (!isNonEmptyString(review.author)) issues.push("review.author is required");
  if (review.notes !== undefined && typeof review.notes !== "string") issues.push("review.notes must be a string");

  const approval = review.releaseApproval;
  if (approval !== undefined) {
    if (!isRecord(approval)) {
      issues.push("review.releaseApproval must be an object");
    } else {
      rejectUnknownKeys(
        approval,
        ["reviewerId", "caseId", "caseVersion", "contentHash", "checklistVersion", "decision", "signedAt", "signatureMethod"],
        "review.releaseApproval",
        issues,
      );
      for (const field of ["reviewerId", "caseId", "checklistVersion"] as const) {
        if (!isStableId(approval[field])) issues.push(`review.releaseApproval.${field} must be a stable ID`);
      }
      for (const field of ["caseVersion", "signatureMethod"] as const) {
        if (!isNonEmptyString(approval[field])) issues.push(`review.releaseApproval.${field} is required`);
      }
      if (!CONTENT_HASH_PATTERN.test(String(approval.contentHash ?? ""))) issues.push("review.releaseApproval.contentHash must be sha256:<64 lowercase hex>");
      if (approval.decision !== "approved" && approval.decision !== "rejected") issues.push("review.releaseApproval.decision is invalid");
      if (!isDateTime(approval.signedAt)) issues.push("review.releaseApproval.signedAt must be a date-time");
      if (approval.caseId !== casePackage.internalCaseId) issues.push("review.releaseApproval.caseId must match internalCaseId");
      if (approval.caseVersion !== casePackage.caseVersion) issues.push("review.releaseApproval.caseVersion must match caseVersion");
      if (isRecord(provenance) && approval.contentHash !== provenance.contentHash) issues.push("review.releaseApproval.contentHash must match provenance.contentHash");
    }
  }

  if (review.status === "approved" && !isRecord(approval)) {
    issues.push("approved review requires releaseApproval");
  }

}

const AI_VALIDATION_CHECKS = [
  "clinicalConsistency",
  "diagnosisSolvability",
  "redFlagExclusions",
  "rubricConsistency",
  "regressionCoverage",
  "hiddenTruthSafety",
] as const;

function validateReleaseValidation(
  validation: unknown,
  casePackage: Record<string, unknown>,
  provenance: unknown,
  issues: string[],
): void {
  if (validation === undefined) {
    if (casePackage.packageStatus === "published") {
      issues.push("published cases require approved AI cross-validation");
    }
    return;
  }
  if (!isRecord(validation)) {
    issues.push("releaseValidation must be an object");
    return;
  }

  rejectUnknownKeys(
    validation,
    ["schemaVersion", "caseId", "caseVersion", "contentHash", "decision", "validations"],
    "releaseValidation",
    issues,
  );
  if (validation.schemaVersion !== AI_CASE_CROSS_VALIDATION_SCHEMA_VERSION) {
    issues.push(`releaseValidation.schemaVersion must equal ${AI_CASE_CROSS_VALIDATION_SCHEMA_VERSION}`);
  }
  if (!isStableId(validation.caseId)) {
    issues.push("releaseValidation.caseId must be a stable ID");
  } else if (validation.caseId !== casePackage.internalCaseId) {
    issues.push("releaseValidation.caseId must match internalCaseId");
  }
  if (!isNonEmptyString(validation.caseVersion)) {
    issues.push("releaseValidation.caseVersion is required");
  } else if (validation.caseVersion !== casePackage.caseVersion) {
    issues.push("releaseValidation.caseVersion must match caseVersion");
  }
  if (!CONTENT_HASH_PATTERN.test(String(validation.contentHash ?? ""))) {
    issues.push("releaseValidation.contentHash must be sha256:<64 lowercase hex>");
  } else if (
    isRecord(provenance) &&
    validation.contentHash !== provenance.contentHash
  ) {
    issues.push("releaseValidation.contentHash must match provenance.contentHash");
  }
  if (validation.decision !== "approved" && validation.decision !== "rejected") {
    issues.push("releaseValidation.decision is invalid");
  }

  const validatorIds = new Set<string>();
  const roles = new Set<string>();
  let allValidatorsApproved = true;
  if (!Array.isArray(validation.validations) || validation.validations.length < 2) {
    issues.push("releaseValidation.validations must contain at least two independent AI validators");
  } else {
    for (const [index, entry] of validation.validations.entries()) {
      const path = `releaseValidation.validations[${index}]`;
      if (!isRecord(entry)) {
        issues.push(`${path} must be an object`);
        allValidatorsApproved = false;
        continue;
      }
      rejectUnknownKeys(
        entry,
        ["validatorId", "role", "modelId", "promptVersion", "decision", "validatedAt", "checks", "findings"],
        path,
        issues,
      );
      if (!isStableId(entry.validatorId)) {
        issues.push(`${path}.validatorId must be a stable ID`);
      } else if (validatorIds.has(entry.validatorId)) {
        issues.push(`${path}.validatorId must be unique`);
      } else {
        validatorIds.add(entry.validatorId);
      }
      if (entry.role !== "clinical_safety" && entry.role !== "diagnostic_quality") {
        issues.push(`${path}.role is invalid`);
      } else {
        roles.add(entry.role);
      }
      for (const field of ["modelId", "promptVersion"] as const) {
        if (!isNonEmptyString(entry[field])) issues.push(`${path}.${field} is required`);
      }
      if (!isDateTime(entry.validatedAt)) {
        issues.push(`${path}.validatedAt must be a date-time`);
      }
      if (entry.decision !== "approved" && entry.decision !== "rejected") {
        issues.push(`${path}.decision is invalid`);
        allValidatorsApproved = false;
      } else if (entry.decision !== "approved") {
        allValidatorsApproved = false;
      }
      if (!isRecord(entry.checks)) {
        issues.push(`${path}.checks must be an object`);
        allValidatorsApproved = false;
      } else {
        rejectUnknownKeys(entry.checks, AI_VALIDATION_CHECKS, `${path}.checks`, issues);
        for (const check of AI_VALIDATION_CHECKS) {
          if (entry.checks[check] !== "pass" && entry.checks[check] !== "fail") {
            issues.push(`${path}.checks.${check} is invalid`);
            allValidatorsApproved = false;
          } else if (entry.checks[check] !== "pass") {
            allValidatorsApproved = false;
          }
        }
      }
      if (!Array.isArray(entry.findings) || !entry.findings.every(isNonEmptyString)) {
        issues.push(`${path}.findings must be a string array`);
      }
    }
  }
  if (!roles.has("clinical_safety") || !roles.has("diagnostic_quality")) {
    issues.push("releaseValidation must include clinical_safety and diagnostic_quality roles");
  }
  if (validation.decision === "approved" && !allValidatorsApproved) {
    issues.push("approved releaseValidation requires every validator and check to pass");
  }
  if (casePackage.packageStatus === "published" && validation.decision !== "approved") {
    issues.push("published cases require approved AI cross-validation");
  }
}

function validateProvenance(
  provenance: unknown,
  packageStatus: unknown,
  issues: string[],
): void {
  if (!isRecord(provenance)) {
    issues.push("provenance is required");
    return;
  }

  rejectUnknownKeys(provenance, ["sourceType", "sourceCitation", "license", "createdAt", "contentHash"], "provenance", issues);
  if (provenance.sourceType !== "synthetic" && provenance.sourceType !== "licensed") issues.push("provenance.sourceType is invalid");
  for (const field of ["sourceCitation", "license"] as const) {
    if (!isNonEmptyString(provenance[field])) issues.push(`provenance.${field} is required`);
  }
  if (!isDateTime(provenance.createdAt)) issues.push("provenance.createdAt must be a date-time");
  if (provenance.contentHash !== undefined && !CONTENT_HASH_PATTERN.test(String(provenance.contentHash))) {
    issues.push("provenance.contentHash must be sha256:<64 lowercase hex>");
  }
  if (packageStatus === "published" && !CONTENT_HASH_PATTERN.test(String(provenance.contentHash ?? ""))) {
    issues.push("published cases require provenance.contentHash");
  }
}

function validateRedFlagMatrix(
  matrix: unknown,
  casePackage: Record<string, unknown>,
  patientFacts: unknown,
  issues: string[],
): void {
  if (!isRecord(matrix)) {
    issues.push("redFlagExclusionMatrix is required");
    return;
  }

  rejectUnknownKeys(matrix, ["matrixVersion", "caseId", "caseVersion", "policyVersion", "entries", "review"], "redFlagExclusionMatrix", issues);
  if (matrix.matrixVersion !== "red-flag-exclusion-matrix-v1") issues.push("redFlagExclusionMatrix.matrixVersion is invalid");
  if (matrix.caseId !== casePackage.internalCaseId) issues.push("redFlagExclusionMatrix.caseId must match internalCaseId");
  if (matrix.caseVersion !== casePackage.caseVersion) issues.push("redFlagExclusionMatrix.caseVersion must match caseVersion");
  if (!isStableId(matrix.policyVersion)) issues.push("redFlagExclusionMatrix.policyVersion must be a stable ID");

  if (!Array.isArray(matrix.entries) || matrix.entries.length === 0) {
    issues.push("redFlagExclusionMatrix.entries must be non-empty");
  } else {
    const redFlagIds = new Set<string>();
    for (const [index, entry] of matrix.entries.entries()) {
      if (!isRecord(entry)) {
        issues.push(`redFlagExclusionMatrix.entries[${index}] must be an object`);
        continue;
      }
      const path = `redFlagExclusionMatrix.entries[${index}]`;
      rejectUnknownKeys(
        entry,
        ["redFlagId", "canonicalName", "applicable", "requiredState", "evidenceFactIds", "evidenceType", "observedValue", "unit", "criterionSourceId", "criterionSourceVersion", "reviewDecision"],
        path,
        issues,
      );
      if (!isStableId(entry.redFlagId)) issues.push(`${path}.redFlagId must be a stable ID`);
      else if (redFlagIds.has(entry.redFlagId)) issues.push(`${path}.redFlagId is duplicated`);
      else redFlagIds.add(entry.redFlagId);
      for (const field of ["canonicalName", "evidenceType", "criterionSourceVersion"] as const) {
        if (!isNonEmptyString(entry[field])) issues.push(`${path}.${field} is required`);
      }
      if (!isStableId(entry.criterionSourceId)) issues.push(`${path}.criterionSourceId must be a stable ID`);
      if (typeof entry.applicable !== "boolean") issues.push(`${path}.applicable must be boolean`);
      if (entry.requiredState !== "absent") issues.push(`${path}.requiredState must equal absent`);
      if (!isStringArray(entry.evidenceFactIds)) {
        issues.push(`${path}.evidenceFactIds must be a string array`);
      } else {
        if (hasDuplicates(entry.evidenceFactIds)) issues.push(`${path}.evidenceFactIds must not contain duplicates`);
        if (entry.evidenceFactIds.some((factId) => !isStableId(factId))) issues.push(`${path}.evidenceFactIds contains an invalid ID`);
        if (entry.applicable === true && entry.evidenceFactIds.length === 0) issues.push(`${path}.evidenceFactIds must be non-empty when applicable`);
        if (isRecord(patientFacts)) {
          for (const factId of entry.evidenceFactIds) {
            const fact = patientFacts[factId];
            if (!isRecord(fact) || fact.status !== "absent") issues.push(`${path}.evidence fact "${factId}" must exist and be absent`);
          }
        }
      }
      if (typeof entry.observedValue !== "string" && typeof entry.observedValue !== "number") issues.push(`${path}.observedValue must be a string or number`);
      if (entry.unit !== undefined && typeof entry.unit !== "string") issues.push(`${path}.unit must be a string`);
      if (entry.reviewDecision !== "pending" && entry.reviewDecision !== "approved" && entry.reviewDecision !== "rejected") issues.push(`${path}.reviewDecision is invalid`);
    }
  }

  if (!isRecord(matrix.review) || !("fixture pending approved rejected".split(" ") as unknown[]).includes(matrix.review.status)) {
    issues.push("redFlagExclusionMatrix.review.status is invalid");
  } else {
    rejectUnknownKeys(matrix.review, ["status", "reviewerId", "reviewedAt"], "redFlagExclusionMatrix.review", issues);
    if (matrix.review.reviewerId !== undefined && !isStableId(matrix.review.reviewerId)) issues.push("redFlagExclusionMatrix.review.reviewerId must be a stable ID");
    if (matrix.review.reviewedAt !== undefined && !isDateTime(matrix.review.reviewedAt)) issues.push("redFlagExclusionMatrix.review.reviewedAt must be a date-time");
  }
}

export function assertCasePackage(value: unknown): asserts value is CasePackage {
  const issues: string[] = [];
  if (!isRecord(value)) throw new CasePackageValidationError(["case package must be an object"]);

  const publicCaseId = value.publicCaseId;
  const answerKey = value.answerKey;
  const patientFacts = value.patientFacts;
  const medicalTests = value.medicalTests;
  const rubric = value.rubric;
  const review = value.review;
  const releaseValidation = value.releaseValidation;
  const provenance = value.provenance;
  const redFlagExclusionMatrix = value.redFlagExclusionMatrix;

  rejectUnknownKeys(
    value,
    [
      "schemaVersion",
      "evaluationVersion",
      "packageStatus",
      "internalCaseId",
      "publicCaseId",
      "caseVersion",
      "locale",
      "playerVisible",
      "patientPersona",
      "patientFacts",
      "medicalTests",
      "answerKey",
      "rubric",
      "review",
      "releaseValidation",
      "provenance",
      "redFlagExclusionMatrix",
    ],
    "casePackage",
    issues,
  );

  if (value.schemaVersion !== CASE_PACKAGE_SCHEMA_VERSION) issues.push(`schemaVersion must equal ${CASE_PACKAGE_SCHEMA_VERSION}`);
  if (value.evaluationVersion !== SCORING_POLICY_VERSION) issues.push(`evaluationVersion must equal ${SCORING_POLICY_VERSION}`);
  if (!("fixture draft published withdrawn".split(" ") as unknown[]).includes(value.packageStatus)) issues.push("packageStatus is invalid");
  if (!isStableId(value.internalCaseId)) issues.push("internalCaseId must be a stable ID");
  if (!isNonEmptyString(value.caseVersion)) {
    issues.push("caseVersion is required");
  } else if (
    value.caseVersion.length > 128 ||
    !CASE_VERSION_PATTERN.test(value.caseVersion)
  ) {
    issues.push("caseVersion must use a safe semantic version format");
  }
  if (!isNonEmptyString(value.locale)) issues.push("locale is required");
  if (!isRecord(value.playerVisible) || !isNonEmptyString(value.playerVisible.patientDisplayName) || !isNonEmptyString(value.playerVisible.chiefComplaint)) {
    issues.push("playerVisible requires patientDisplayName and chiefComplaint");
  } else {
    rejectUnknownKeys(value.playerVisible, ["patientDisplayName", "chiefComplaint", "ageBand", "genderDisplay"], "playerVisible", issues);
    for (const field of ["ageBand", "genderDisplay"] as const) {
      if (value.playerVisible[field] !== undefined && typeof value.playerVisible[field] !== "string") issues.push(`playerVisible.${field} must be a string`);
    }
  }
  if (!isRecord(value.patientPersona) || !isNonEmptyString(value.patientPersona.languageStyle)) issues.push("patientPersona.languageStyle is required");
  else {
    rejectUnknownKeys(
      value.patientPersona,
      [
        "languageStyle",
        "personaTemplateId",
        "personaTemplateVersion",
        "educationOrOccupation",
        "dailyLife",
        "interests",
        "communicationTraits",
      ],
      "patientPersona",
      issues,
    );
    for (const field of [
      "personaTemplateId",
      "personaTemplateVersion",
      "educationOrOccupation",
      "dailyLife",
    ] as const) {
      if (
        value.patientPersona[field] !== undefined &&
        !isNonEmptyString(value.patientPersona[field])
      ) {
        issues.push(`patientPersona.${field} must be a non-empty string`);
      }
    }
    for (const field of ["interests", "communicationTraits"] as const) {
      if (
        value.patientPersona[field] !== undefined &&
        !isStringArray(value.patientPersona[field])
      ) {
        issues.push(`patientPersona.${field} must be a string array`);
      }
    }
  }
  if (!isNonEmptyString(publicCaseId)) issues.push("publicCaseId is required");
  else if (!isStableId(publicCaseId)) issues.push("publicCaseId must be a stable ID");

  const conceptIds = new Set<string>();
  const diagnosisTerms = new Set<string>();
  if (!isRecord(answerKey) || !isNonEmptyString(answerKey.targetDiagnosis)) {
    issues.push("answerKey.targetDiagnosis is required");
  }
  if (isRecord(answerKey)) {
    rejectUnknownKeys(answerKey, ["targetConceptId", "targetDiagnosis", "acceptedSynonyms", "diagnosisConcepts"], "answerKey", issues);
    if (!isStableId(answerKey.targetConceptId)) issues.push("answerKey.targetConceptId is required and must be a stable ID");
    if (!isStringArray(answerKey.acceptedSynonyms) || answerKey.acceptedSynonyms.length === 0) {
      issues.push("answerKey.acceptedSynonyms must be a non-empty string array");
    } else if (hasDuplicates(answerKey.acceptedSynonyms.map(normalizeTerm))) {
      issues.push("answerKey.acceptedSynonyms must not contain duplicates");
    }
    if (isNonEmptyString(answerKey.targetDiagnosis)) {
      diagnosisTerms.add(normalizeTerm(answerKey.targetDiagnosis));
    }
    if (isStringArray(answerKey.acceptedSynonyms)) {
      for (const term of answerKey.acceptedSynonyms) {
        const normalized = normalizeTerm(term);
        if (normalized.length > 0) diagnosisTerms.add(normalized);
      }
    }
    if (isNonEmptyString(publicCaseId) && isNonEmptyString(answerKey.targetDiagnosis)) {
      const normalizedPublicCaseId = normalizeTerm(publicCaseId);
      const diagnosisTerms = [
        answerKey.targetDiagnosis,
        ...(isStringArray(answerKey.acceptedSynonyms) ? answerKey.acceptedSynonyms : []),
      ]
        .map(normalizeTerm)
        .filter((term) => term.length > 0);
      if (diagnosisTerms.some((term) => normalizedPublicCaseId.includes(term))) {
        issues.push("publicCaseId must not reveal the target diagnosis or an accepted synonym");
      }
    }
    if (!Array.isArray(answerKey.diagnosisConcepts) || answerKey.diagnosisConcepts.length < 3) {
      issues.push("answerKey.diagnosisConcepts must define target and differential concepts");
    } else {
      const termOwners = new Map<string, string>();
      for (const concept of answerKey.diagnosisConcepts) {
        if (!isRecord(concept) || !isStableId(concept.conceptId)) {
          issues.push("each diagnosis concept requires a conceptId");
          continue;
        }
        rejectUnknownKeys(concept, ["conceptId", "preferredTerm", "acceptedSynonyms"], `diagnosisConcept.${concept.conceptId}`, issues);
        if (conceptIds.has(concept.conceptId)) issues.push(`diagnosis concept "${concept.conceptId}" is duplicated`);
        conceptIds.add(concept.conceptId);
        if (!isNonEmptyString(concept.preferredTerm) || !isStringArray(concept.acceptedSynonyms)) {
          issues.push(`diagnosis concept "${concept.conceptId}" has invalid terms`);
          continue;
        }
        for (const term of [concept.preferredTerm, ...concept.acceptedSynonyms]) {
          const normalized = normalizeTerm(term);
          if (normalized.length > 0) diagnosisTerms.add(normalized);
          const owner = termOwners.get(normalized);
          if (owner !== undefined && owner !== concept.conceptId) issues.push(`diagnosis term "${term}" maps to more than one concept`);
          termOwners.set(normalized, concept.conceptId);
        }
      }
      if (isNonEmptyString(answerKey.targetConceptId) && !conceptIds.has(answerKey.targetConceptId)) issues.push("answerKey.targetConceptId is not defined in diagnosisConcepts");
      if (isNonEmptyString(answerKey.targetConceptId)) {
        const targetConcept = answerKey.diagnosisConcepts.find(
          (concept) => isRecord(concept) && concept.conceptId === answerKey.targetConceptId,
        );
        if (isRecord(targetConcept) && isNonEmptyString(targetConcept.preferredTerm) && isNonEmptyString(answerKey.targetDiagnosis)) {
          if (normalizeTerm(targetConcept.preferredTerm) !== normalizeTerm(answerKey.targetDiagnosis)) {
            issues.push("answerKey targetDiagnosis must match the target concept preferredTerm");
          }
          if (isStringArray(targetConcept.acceptedSynonyms) && isStringArray(answerKey.acceptedSynonyms)) {
            const targetSynonyms = [...targetConcept.acceptedSynonyms].map(normalizeTerm).sort();
            const answerSynonyms = [...answerKey.acceptedSynonyms].map(normalizeTerm).sort();
            if (JSON.stringify(targetSynonyms) !== JSON.stringify(answerSynonyms)) {
              issues.push("answerKey acceptedSynonyms must match the target concept synonyms");
            }
          }
        }
      }
    }
  }

  if (isRecord(value.playerVisible)) {
    for (const field of [
      "patientDisplayName",
      "chiefComplaint",
      "ageBand",
      "genderDisplay",
    ] as const) {
      const text = value.playerVisible[field];
      if (
        isNonEmptyString(text) &&
        [...diagnosisTerms].some((term) => normalizeTerm(text).includes(term))
      ) {
        issues.push(`playerVisible.${field} must not reveal a diagnosis term`);
      }
    }
  }

  for (const [field, text] of [
    ["publicCaseId", publicCaseId],
    ["caseVersion", value.caseVersion],
  ] as const) {
    if (
      isNonEmptyString(text) &&
      [...diagnosisTerms].some((term) => normalizeTerm(text).includes(term))
    ) {
      issues.push(`${field} must not reveal a diagnosis term`);
    }
  }

  if (!isRecord(patientFacts) || Object.keys(patientFacts).length === 0) {
    issues.push("patientFacts must be a non-empty object");
  } else {
    for (const [factId, fact] of Object.entries(patientFacts)) {
      if (!isRecord(fact)) {
        issues.push(`patient fact "${factId}" must be an object`);
        continue;
      }
      rejectUnknownKeys(fact, ["status", "value", "disclosure", "questionMatchers"], `patientFacts.${factId}`, issues);
      if (!("present absent unknown".split(" ") as unknown[]).includes(fact.status)) issues.push(`patient fact "${factId}" has an invalid status`);
      if (!isNonEmptyString(fact.value)) issues.push(`patient fact "${factId}" value must be a non-empty string`);
      if (!("spontaneous if_asked test_only hidden".split(" ") as unknown[]).includes(fact.disclosure)) issues.push(`patient fact "${factId}" has an invalid disclosure`);
      if (!isStringArray(fact.questionMatchers)) issues.push(`patient fact "${factId}" questionMatchers must be a string array`);
      if (
        (fact.disclosure === "spontaneous" || fact.disclosure === "if_asked") &&
        [...diagnosisTerms].some((term) => normalizeTerm(factId).includes(term))
      ) {
        issues.push(`patient fact "${factId}" ID must not reveal a diagnosis term`);
      }
      if (
        isNonEmptyString(fact.value) &&
        (fact.disclosure === "spontaneous" || fact.disclosure === "if_asked")
      ) {
        const normalizedValue = normalizeTerm(fact.value);
        if ([...diagnosisTerms].some((term) => normalizedValue.includes(term))) {
          issues.push(
            `patient fact "${factId}" must not reveal a diagnosis term`,
          );
        }
      }
    }
  }

  if (!isRecord(medicalTests) || Object.keys(medicalTests).length === 0) {
    issues.push("medicalTests must be a non-empty object");
  } else {
    for (const [testId, definition] of Object.entries(medicalTests)) {
      if (!isRecord(definition)) {
        issues.push(`medical test "${testId}" must be an object`);
        continue;
      }
      rejectUnknownKeys(definition, ["status", "displayName", "aliases", "report", "assetId", "reasonCode"], `medicalTests.${testId}`, issues);
      if (definition.status !== "unavailable" && definition.status !== "completed") issues.push(`medical test "${testId}" has an invalid status`);
      if (definition.status === "completed" && !isNonEmptyString(definition.report)) issues.push(`completed medical test "${testId}" requires a report`);
      for (const [field, text] of [
        ["testId", testId],
        ["report", definition.report],
        ["assetId", definition.assetId],
        ["reasonCode", definition.reasonCode],
      ] as const) {
        if (
          isNonEmptyString(text) &&
          [...diagnosisTerms].some((term) => normalizeTerm(text).includes(term))
        ) {
          issues.push(
            `medical test "${testId}" ${field} must not reveal a diagnosis term`,
          );
        }
      }
      for (const field of ["report", "assetId", "reasonCode"] as const) {
        if (definition[field] !== undefined && typeof definition[field] !== "string") issues.push(`medical test "${testId}" ${field} must be a string`);
      }
      if (definition.displayName !== undefined && !isNonEmptyString(definition.displayName)) {
        issues.push(`medical test "${testId}" displayName must be a non-empty string`);
      }
      if (definition.aliases !== undefined && !isStringArray(definition.aliases)) {
        issues.push(`medical test "${testId}" aliases must be a string array`);
      }
    }
  }

  if (!isRecord(rubric)) issues.push("rubric must be an object");
  else validateRubric(rubric, patientFacts, medicalTests, conceptIds, issues);

  validateProvenance(provenance, value.packageStatus, issues);
  validateReview(review, value, provenance, issues);
  validateReleaseValidation(releaseValidation, value, provenance, issues);
  validateRedFlagMatrix(redFlagExclusionMatrix, value, patientFacts, issues);

  if (issues.length > 0) throw new CasePackageValidationError(issues);
}

import { SCORING_POLICY_VERSION_V1 } from "@ahamed/doctor-game-share";

import { computeCaseContentHash } from "./case-content-hash.js";
import {
  isPatientPersonaTemplateId,
  PATIENT_PERSONA_TEMPLATE_VERSION_V1,
  PATIENT_PERSONA_TEMPLATE_VERSION_V2,
  type PatientPersonaTemplateIdV1,
  type PatientPersonaTemplateIdV2,
} from "./patient-persona.js";

export const CASE_PACKAGE_SCHEMA_VERSION_V1 = "case-package-v1-rc1" as const;
export const CASE_PACKAGE_SCHEMA_VERSION_V2 = "case-package-v2-rc1" as const;
/** Legacy alias retained for v1 consumers. */
export const CASE_PACKAGE_SCHEMA_VERSION = CASE_PACKAGE_SCHEMA_VERSION_V1;
export const SCORING_POLICY_VERSION = SCORING_POLICY_VERSION_V1;
export const AI_CASE_CROSS_VALIDATION_SCHEMA_VERSION =
  "ai-case-cross-validation-v1" as const;
export const AI_CASE_CROSS_REVIEW_SCHEMA_VERSION =
  "ai-case-cross-review-v3" as const;
export const PROVENANCE_RECORD_V2_SCHEMA_VERSION =
  "provenance-record-v2" as const;

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
    personaTemplateId?: PatientPersonaTemplateIdV1;
    personaTemplateVersion?: typeof PATIENT_PERSONA_TEMPLATE_VERSION_V1;
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

export type HealthLiteracyModifier = "low" | "typical" | "high";
export type RecallReliabilityModifier = "low" | "typical" | "high";
export type EmotionalIntensityModifier = "low" | "moderate" | "high";

export interface PatientPersonaModifiersV2 {
  healthLiteracy: HealthLiteracyModifier;
  recallReliability: RecallReliabilityModifier;
  emotionalIntensity: EmotionalIntensityModifier;
}

export interface PatientIdentityV2 {
  patientRoleId: string;
  patientDisplayName: string;
  ageBand?: string;
  genderDisplay?: string;
  educationOrOccupation: string;
  dailyLife: string;
  interests: string[];
}

export interface PatientPersonaV2 {
  personaTemplateId: PatientPersonaTemplateIdV2;
  personaTemplateVersion: typeof PATIENT_PERSONA_TEMPLATE_VERSION_V2;
  languageStyle: string;
  communicationTraits: string[];
  modifiers: PatientPersonaModifiersV2;
}

export type ProvenanceSourceRoleV2 =
  | "topic_selection"
  | "clinical_fact"
  | "terminology"
  | "synthetic_structure";

export interface ProvenanceSourceV2 {
  sourceId: string;
  sourceRole: ProvenanceSourceRoleV2;
  title: string;
  authorsOrOrganization: string;
  url?: string;
  versionOrPublicationDate: string;
  license: string;
  attributionRequirements: string;
  adaptationAllowed: boolean | null;
  commercialUseAllowed: boolean | null;
  retrievedAt: string;
  projectUsage: string;
  includesVerbatimExcerpt: boolean;
  verifiedCaseFields: string[];
  licenseAssessment: "cleared" | "restricted" | "uncertain" | "not_run";
  riskNotes: string[];
}

export interface ProvenanceRecordV2 {
  schemaVersion: typeof PROVENANCE_RECORD_V2_SCHEMA_VERSION;
  createdAt: string;
  contentHash: string;
  sources: ProvenanceSourceV2[];
}

export type AiCaseReviewDecisionV3 =
  | "approved"
  | "revision_recommended"
  | "rejected"
  | "not_run";

export interface AiCaseReviewValidationV3 {
  validatorId: string;
  role: AiValidationRole;
  modelId: string;
  promptVersion: string;
  validationRunId: string;
  isolation: {
    independentInvocation: true;
    counterpartOutputVisible: false;
  };
  runStatus: "completed" | "failed_to_run" | "skipped";
  decision: AiCaseReviewDecisionV3;
  validatedAt: string;
  checks?: AiCaseValidationV1["checks"];
  findings: string[];
}

export interface AiCaseCrossReviewV3 {
  schemaVersion: typeof AI_CASE_CROSS_REVIEW_SCHEMA_VERSION;
  caseId: string;
  caseVersion: string;
  contentHash: string;
  decision: AiCaseReviewDecisionV3;
  validations: AiCaseReviewValidationV3[];
  findings: string[];
}

export interface CasePackageV2 {
  schemaVersion: typeof CASE_PACKAGE_SCHEMA_VERSION_V2;
  evaluationVersion: typeof SCORING_POLICY_VERSION;
  packageStatus: "fixture" | "draft" | "published" | "withdrawn";
  internalCaseId: string;
  publicCaseId: string;
  caseVersion: string;
  locale: string;
  playerVisible: {
    chiefComplaint: string;
  };
  patientIdentity: PatientIdentityV2;
  patientPersona: PatientPersonaV2;
  patientFacts: Record<string, PatientFact>;
  medicalTests: Record<string, MedicalTestDefinition>;
  answerKey: CasePackage["answerKey"];
  rubric: ScoringRubricV1;
  review: CaseReviewRecordV1;
  releaseReview?: AiCaseCrossReviewV3;
  provenance: ProvenanceRecordV2;
  redFlagExclusionMatrix: RedFlagExclusionMatrixV1;
}

export type SupportedCasePackage = CasePackage | CasePackageV2;

export interface CasePackageV1MigrationOptions {
  patientRoleId: string;
  caseVersion: string;
  modifiers: PatientPersonaModifiersV2;
  provenanceSources: ProvenanceSourceV2[];
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

export function assertAiCaseCrossValidationV1(
  value: unknown,
  binding: { caseId: string; caseVersion: string; contentHash: string },
): asserts value is AiCaseCrossValidationV1 {
  const issues: string[] = [];
  validateReleaseValidation(
    value,
    {
      internalCaseId: binding.caseId,
      caseVersion: binding.caseVersion,
      packageStatus: "draft",
    },
    { contentHash: binding.contentHash },
    issues,
  );
  if (issues.length > 0) throw new CasePackageValidationError(issues);
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

const V2_SOURCE_ROLES = [
  "topic_selection",
  "clinical_fact",
  "terminology",
  "synthetic_structure",
] as const;
const V2_LICENSE_ASSESSMENTS = [
  "cleared",
  "restricted",
  "uncertain",
  "not_run",
] as const;
const V2_REVIEW_DECISIONS = [
  "approved",
  "revision_recommended",
  "rejected",
  "not_run",
] as const;
const V2_CLINICAL_BACKGROUND_PATTERN =
  /(?:胸痛|腹痛|头痛|疼痛|咳嗽|发热|出血|过敏|用药|服药|怀孕|妊娠|外伤|诊断为|患有|severe\s+chest\s+pain|diagnosed\s+with|takes?\s+medication|pregnan|allerg(?:y|ic)|new\s+symptom)/iu;

function validateV2Provenance(
  provenance: unknown,
  issues: string[],
): provenance is ProvenanceRecordV2 {
  if (!isRecord(provenance)) {
    issues.push("provenance is required");
    return false;
  }
  rejectUnknownKeys(
    provenance,
    ["schemaVersion", "createdAt", "contentHash", "sources"],
    "provenance",
    issues,
  );
  if (provenance.schemaVersion !== PROVENANCE_RECORD_V2_SCHEMA_VERSION) {
    issues.push(
      `provenance.schemaVersion must equal ${PROVENANCE_RECORD_V2_SCHEMA_VERSION}`,
    );
  }
  if (!isDateTime(provenance.createdAt)) {
    issues.push("provenance.createdAt must be a date-time");
  }
  if (!CONTENT_HASH_PATTERN.test(String(provenance.contentHash ?? ""))) {
    issues.push("provenance.contentHash must be sha256:<64 lowercase hex>");
  }
  if (!Array.isArray(provenance.sources) || provenance.sources.length === 0) {
    issues.push("provenance.sources must be a non-empty array");
    return false;
  }
  const sourceIds = new Set<string>();
  for (const [index, source] of provenance.sources.entries()) {
    const path = `provenance.sources[${index}]`;
    if (!isRecord(source)) {
      issues.push(`${path} must be an object`);
      continue;
    }
    rejectUnknownKeys(
      source,
      [
        "sourceId",
        "sourceRole",
        "title",
        "authorsOrOrganization",
        "url",
        "versionOrPublicationDate",
        "license",
        "attributionRequirements",
        "adaptationAllowed",
        "commercialUseAllowed",
        "retrievedAt",
        "projectUsage",
        "includesVerbatimExcerpt",
        "verifiedCaseFields",
        "licenseAssessment",
        "riskNotes",
      ],
      path,
      issues,
    );
    if (!isStableId(source.sourceId)) {
      issues.push(`${path}.sourceId must be a stable ID`);
    } else if (sourceIds.has(source.sourceId)) {
      issues.push(`${path}.sourceId must be unique`);
    } else {
      sourceIds.add(source.sourceId);
    }
    if (!(V2_SOURCE_ROLES as readonly unknown[]).includes(source.sourceRole)) {
      issues.push(`${path}.sourceRole is invalid`);
    }
    for (const field of [
      "title",
      "authorsOrOrganization",
      "versionOrPublicationDate",
      "license",
      "attributionRequirements",
      "projectUsage",
    ] as const) {
      if (!isNonEmptyString(source[field])) {
        issues.push(`${path}.${field} is required`);
      }
    }
    if (source.url !== undefined) {
      if (!isNonEmptyString(source.url)) {
        issues.push(`${path}.url must be a non-empty URL`);
      } else {
        try {
          const parsed = new URL(source.url);
          if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
            issues.push(`${path}.url must use HTTP or HTTPS`);
          }
        } catch {
          issues.push(`${path}.url must be an absolute URL`);
        }
      }
    }
    for (const field of ["adaptationAllowed", "commercialUseAllowed"] as const) {
      if (source[field] !== true && source[field] !== false && source[field] !== null) {
        issues.push(`${path}.${field} must be boolean or null`);
      }
    }
    if (!isDateTime(source.retrievedAt)) {
      issues.push(`${path}.retrievedAt must be a date-time`);
    }
    if (typeof source.includesVerbatimExcerpt !== "boolean") {
      issues.push(`${path}.includesVerbatimExcerpt must be boolean`);
    }
    if (
      !isStringArray(source.verifiedCaseFields) ||
      source.verifiedCaseFields.length === 0 ||
      hasDuplicates(source.verifiedCaseFields)
    ) {
      issues.push(`${path}.verifiedCaseFields must be non-empty and unique`);
    }
    if (
      !(V2_LICENSE_ASSESSMENTS as readonly unknown[]).includes(
        source.licenseAssessment,
      )
    ) {
      issues.push(`${path}.licenseAssessment is invalid`);
    }
    if (!isStringArray(source.riskNotes)) {
      issues.push(`${path}.riskNotes must be a string array`);
    }
  }
  return true;
}

function validateV2ReleaseReview(
  review: unknown,
  casePackage: Record<string, unknown>,
  provenance: unknown,
  issues: string[],
): void {
  if (review === undefined) return;
  if (!isRecord(review)) {
    issues.push("releaseReview must be an object");
    return;
  }
  rejectUnknownKeys(
    review,
    [
      "schemaVersion",
      "caseId",
      "caseVersion",
      "contentHash",
      "decision",
      "validations",
      "findings",
    ],
    "releaseReview",
    issues,
  );
  if (review.schemaVersion !== AI_CASE_CROSS_REVIEW_SCHEMA_VERSION) {
    issues.push(
      `releaseReview.schemaVersion must equal ${AI_CASE_CROSS_REVIEW_SCHEMA_VERSION}`,
    );
  }
  if (review.caseId !== casePackage.internalCaseId) {
    issues.push("releaseReview.caseId must match internalCaseId");
  }
  if (review.caseVersion !== casePackage.caseVersion) {
    issues.push("releaseReview.caseVersion must match caseVersion");
  }
  if (!CONTENT_HASH_PATTERN.test(String(review.contentHash ?? ""))) {
    issues.push("releaseReview.contentHash must be sha256:<64 lowercase hex>");
  } else if (
    isRecord(provenance) &&
    review.contentHash !== provenance.contentHash
  ) {
    issues.push("releaseReview.contentHash must match provenance.contentHash");
  }
  if (!(V2_REVIEW_DECISIONS as readonly unknown[]).includes(review.decision)) {
    issues.push("releaseReview.decision is invalid");
  }
  if (!isStringArray(review.findings)) {
    issues.push("releaseReview.findings must be a string array");
  }
  if (!Array.isArray(review.validations) || review.validations.length > 2) {
    issues.push("releaseReview.validations must contain at most two validators");
    return;
  }
  const validatorIds = new Set<string>();
  const roles = new Set<string>();
  let allCompletedAndApproved = review.validations.length === 2;
  let completedCount = 0;
  for (const [index, validation] of review.validations.entries()) {
    const path = `releaseReview.validations[${index}]`;
    if (!isRecord(validation)) {
      issues.push(`${path} must be an object`);
      allCompletedAndApproved = false;
      continue;
    }
    rejectUnknownKeys(
      validation,
      [
        "validatorId",
        "role",
        "modelId",
        "promptVersion",
        "validationRunId",
        "isolation",
        "runStatus",
        "decision",
        "validatedAt",
        "checks",
        "findings",
      ],
      path,
      issues,
    );
    if (!isStableId(validation.validatorId)) {
      issues.push(`${path}.validatorId must be a stable ID`);
    } else if (validatorIds.has(validation.validatorId)) {
      issues.push(`${path}.validatorId must be unique`);
    } else {
      validatorIds.add(validation.validatorId);
    }
    if (validation.role !== "clinical_safety" && validation.role !== "diagnostic_quality") {
      issues.push(`${path}.role is invalid`);
    } else if (roles.has(validation.role)) {
      issues.push(`${path}.role must be unique`);
    } else {
      roles.add(validation.role);
    }
    for (const field of ["modelId", "promptVersion"] as const) {
      if (!isNonEmptyString(validation[field])) {
        issues.push(`${path}.${field} is required`);
      }
    }
    if (!isStableId(validation.validationRunId)) {
      issues.push(`${path}.validationRunId must be a stable ID`);
    }
    if (
      !isRecord(validation.isolation) ||
      validation.isolation.independentInvocation !== true ||
      validation.isolation.counterpartOutputVisible !== false ||
      Object.keys(validation.isolation).some(
        (key) => !["independentInvocation", "counterpartOutputVisible"].includes(key),
      )
    ) {
      issues.push(`${path}.isolation must prove independent invocation`);
    }
    if (
      validation.runStatus !== "completed" &&
      validation.runStatus !== "failed_to_run" &&
      validation.runStatus !== "skipped"
    ) {
      issues.push(`${path}.runStatus is invalid`);
    }
    if (!(V2_REVIEW_DECISIONS as readonly unknown[]).includes(validation.decision)) {
      issues.push(`${path}.decision is invalid`);
    }
    if (!isDateTime(validation.validatedAt)) {
      issues.push(`${path}.validatedAt must be a date-time`);
    }
    if (!isStringArray(validation.findings)) {
      issues.push(`${path}.findings must be a string array`);
    }
    if (validation.runStatus === "completed") {
      completedCount += 1;
      if (validation.decision === "not_run") {
        issues.push(`${path}.decision cannot be not_run when completed`);
      }
      if (!isRecord(validation.checks)) {
        issues.push(`${path}.checks are required when completed`);
        allCompletedAndApproved = false;
      } else {
        rejectUnknownKeys(validation.checks, AI_VALIDATION_CHECKS, `${path}.checks`, issues);
        for (const check of AI_VALIDATION_CHECKS) {
          if (validation.checks[check] !== "pass" && validation.checks[check] !== "fail") {
            issues.push(`${path}.checks.${check} is invalid`);
            allCompletedAndApproved = false;
          } else if (validation.checks[check] !== "pass") {
            allCompletedAndApproved = false;
          }
        }
      }
      if (validation.decision !== "approved") {
        allCompletedAndApproved = false;
      }
    } else {
      allCompletedAndApproved = false;
      if (validation.decision !== "not_run") {
        issues.push(`${path}.decision must be not_run when execution did not complete`);
      }
      if (validation.checks !== undefined) {
        issues.push(`${path}.checks must be omitted when execution did not complete`);
      }
    }
  }
  if (review.decision === "approved" && !allCompletedAndApproved) {
    issues.push("approved releaseReview requires two completed passing validators");
  }
  if (review.decision !== "not_run" && completedCount === 0) {
    issues.push("non-not-run releaseReview requires at least one completed validation");
  }
  if (
    review.decision !== "not_run" &&
    completedCount !== review.validations.length
  ) {
    issues.push("non-not-run releaseReview may contain only completed validations");
  }
  if (review.decision === "not_run" && completedCount > 0) {
    issues.push("not_run releaseReview cannot contain completed validations");
  }
}

export function assertAiCaseCrossReviewV3(
  value: unknown,
  binding: { caseId: string; caseVersion: string; contentHash: string },
): asserts value is AiCaseCrossReviewV3 {
  const issues: string[] = [];
  validateV2ReleaseReview(
    value,
    { internalCaseId: binding.caseId, caseVersion: binding.caseVersion },
    { contentHash: binding.contentHash },
    issues,
  );
  if (value === undefined) issues.push("releaseReview is required");
  if (issues.length > 0) throw new CasePackageValidationError(issues);
}

function normalizedRestrictedValues(casePackage: Record<string, unknown>): string[] {
  const values: string[] = [];
  if (isRecord(casePackage.answerKey)) {
    for (const value of [
      casePackage.answerKey.targetDiagnosis,
      ...(isStringArray(casePackage.answerKey.acceptedSynonyms)
        ? casePackage.answerKey.acceptedSynonyms
        : []),
    ]) {
      if (isNonEmptyString(value)) values.push(normalizeTerm(value));
    }
  }
  if (isRecord(casePackage.patientFacts)) {
    for (const fact of Object.values(casePackage.patientFacts)) {
      if (isRecord(fact) && isNonEmptyString(fact.value)) {
        const normalized = normalizeTerm(fact.value);
        if (normalized.length >= 8) values.push(normalized);
      }
    }
  }
  if (isRecord(casePackage.medicalTests)) {
    for (const test of Object.values(casePackage.medicalTests)) {
      if (isRecord(test) && isNonEmptyString(test.report)) {
        const normalized = normalizeTerm(test.report);
        if (normalized.length >= 8) values.push(normalized);
      }
    }
  }
  return [...new Set(values)];
}

function containsRestrictedMedicalContent(
  text: string,
  restrictedValues: readonly string[],
): boolean {
  const normalized = normalizeTerm(text);
  return V2_CLINICAL_BACKGROUND_PATTERN.test(text) ||
    restrictedValues.some((value) => value.length > 0 && normalized.includes(value));
}

export function assertCasePackageV2(
  value: unknown,
): asserts value is CasePackageV2 {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new CasePackageValidationError(["case package must be an object"]);
  }
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
      "patientIdentity",
      "patientPersona",
      "patientFacts",
      "medicalTests",
      "answerKey",
      "rubric",
      "review",
      "releaseReview",
      "provenance",
      "redFlagExclusionMatrix",
    ],
    "casePackage",
    issues,
  );
  if (value.schemaVersion !== CASE_PACKAGE_SCHEMA_VERSION_V2) {
    issues.push(`schemaVersion must equal ${CASE_PACKAGE_SCHEMA_VERSION_V2}`);
  }
  if (!("fixture draft published withdrawn".split(" ") as unknown[]).includes(value.packageStatus)) {
    issues.push("packageStatus is invalid");
  }

  const identity = value.patientIdentity;
  const persona = value.patientPersona;
  const restrictedValues = normalizedRestrictedValues(value);
  if (!isRecord(identity)) {
    issues.push("patientIdentity is required");
  } else {
    rejectUnknownKeys(
      identity,
      [
        "patientRoleId",
        "patientDisplayName",
        "ageBand",
        "genderDisplay",
        "educationOrOccupation",
        "dailyLife",
        "interests",
      ],
      "patientIdentity",
      issues,
    );
    if (!isStableId(identity.patientRoleId)) {
      issues.push("patientIdentity.patientRoleId must be a stable ID");
    } else if (
      containsRestrictedMedicalContent(identity.patientRoleId, restrictedValues)
    ) {
      issues.push(
        "patientIdentity.patientRoleId must not reveal a diagnosis or clinical fact",
      );
    }
    for (const field of [
      "patientDisplayName",
      "educationOrOccupation",
      "dailyLife",
    ] as const) {
      if (!isNonEmptyString(identity[field])) {
        issues.push(`patientIdentity.${field} is required`);
      } else if (
        field !== "patientDisplayName" &&
        containsRestrictedMedicalContent(identity[field], restrictedValues)
      ) {
        issues.push(`patientIdentity.${field} must not introduce clinical facts`);
      }
    }
    for (const field of ["ageBand", "genderDisplay"] as const) {
      if (identity[field] !== undefined && !isNonEmptyString(identity[field])) {
        issues.push(`patientIdentity.${field} must be a non-empty string`);
      }
    }
    if (
      !isStringArray(identity.interests) ||
      identity.interests.length > 3 ||
      hasDuplicates(identity.interests)
    ) {
      issues.push("patientIdentity.interests must contain at most 3 unique strings");
    } else if (
      identity.interests.some((text) =>
        containsRestrictedMedicalContent(text, restrictedValues)
      )
    ) {
      issues.push("patientIdentity.interests must not introduce clinical facts");
    }
  }

  if (!isRecord(persona)) {
    issues.push("patientPersona is required");
  } else {
    rejectUnknownKeys(
      persona,
      [
        "personaTemplateId",
        "personaTemplateVersion",
        "languageStyle",
        "communicationTraits",
        "modifiers",
      ],
      "patientPersona",
      issues,
    );
    if (
      !isPatientPersonaTemplateId(
        persona.personaTemplateId,
        PATIENT_PERSONA_TEMPLATE_VERSION_V2,
      )
    ) {
      issues.push("patientPersona.personaTemplateId is invalid for Persona v2");
    }
    if (persona.personaTemplateVersion !== PATIENT_PERSONA_TEMPLATE_VERSION_V2) {
      issues.push(
        `patientPersona.personaTemplateVersion must equal ${PATIENT_PERSONA_TEMPLATE_VERSION_V2}`,
      );
    }
    if (!isNonEmptyString(persona.languageStyle)) {
      issues.push("patientPersona.languageStyle is required");
    } else if (containsRestrictedMedicalContent(persona.languageStyle, restrictedValues)) {
      issues.push("patientPersona.languageStyle must not contain clinical facts");
    }
    if (
      !isStringArray(persona.communicationTraits) ||
      hasDuplicates(persona.communicationTraits)
    ) {
      issues.push("patientPersona.communicationTraits must be unique strings");
    } else if (
      persona.communicationTraits.some((text) =>
        containsRestrictedMedicalContent(text, restrictedValues)
      )
    ) {
      issues.push("patientPersona.communicationTraits must not contain clinical facts");
    }
    if (!isRecord(persona.modifiers)) {
      issues.push("patientPersona.modifiers is required");
    } else {
      rejectUnknownKeys(
        persona.modifiers,
        ["healthLiteracy", "recallReliability", "emotionalIntensity"],
        "patientPersona.modifiers",
        issues,
      );
      if (!["low", "typical", "high"].includes(String(persona.modifiers.healthLiteracy))) {
        issues.push("patientPersona.modifiers.healthLiteracy is invalid");
      }
      if (!["low", "typical", "high"].includes(String(persona.modifiers.recallReliability))) {
        issues.push("patientPersona.modifiers.recallReliability is invalid");
      }
      if (!["low", "moderate", "high"].includes(String(persona.modifiers.emotionalIntensity))) {
        issues.push("patientPersona.modifiers.emotionalIntensity is invalid");
      }
    }
  }

  if (
    !isRecord(value.playerVisible) ||
    !isNonEmptyString(value.playerVisible.chiefComplaint)
  ) {
    issues.push("playerVisible.chiefComplaint is required");
  } else {
    rejectUnknownKeys(
      value.playerVisible,
      ["chiefComplaint"],
      "playerVisible",
      issues,
    );
  }

  validateV2Provenance(value.provenance, issues);
  validateReview(value.review, value, value.provenance, issues);
  validateV2ReleaseReview(
    value.releaseReview,
    value,
    value.provenance,
    issues,
  );
  if (
    isRecord(value.provenance) &&
    CONTENT_HASH_PATTERN.test(String(value.provenance.contentHash ?? ""))
  ) {
    const expectedContentHash = computeCaseContentHash(
      value as unknown as CasePackageV2,
    );
    if (value.provenance.contentHash !== expectedContentHash) {
      issues.push(
        "provenance.contentHash does not match the canonical v2 case content",
      );
    }
  }

  const compatibilityValue = {
    schemaVersion: CASE_PACKAGE_SCHEMA_VERSION_V1,
    evaluationVersion: value.evaluationVersion,
    packageStatus: "draft",
    internalCaseId: value.internalCaseId,
    publicCaseId: value.publicCaseId,
    caseVersion: value.caseVersion,
    locale: value.locale,
    playerVisible: {
      patientDisplayName: isRecord(identity)
        ? identity.patientDisplayName
        : "invalid",
      chiefComplaint: isRecord(value.playerVisible)
        ? value.playerVisible.chiefComplaint
        : "invalid",
      ...(isRecord(identity) && identity.ageBand !== undefined
        ? { ageBand: identity.ageBand }
        : {}),
      ...(isRecord(identity) && identity.genderDisplay !== undefined
        ? { genderDisplay: identity.genderDisplay }
        : {}),
    },
    patientPersona: {
      languageStyle: isRecord(persona) ? persona.languageStyle : "invalid",
      personaTemplateId: isRecord(persona) ? persona.personaTemplateId : "invalid",
      personaTemplateVersion: isRecord(persona)
        ? persona.personaTemplateVersion
        : "invalid",
      educationOrOccupation: isRecord(identity)
        ? identity.educationOrOccupation
        : "invalid",
      dailyLife: isRecord(identity) ? identity.dailyLife : "invalid",
      interests: isRecord(identity) ? identity.interests : [],
      communicationTraits: isRecord(persona)
        ? persona.communicationTraits
        : [],
    },
    patientFacts: value.patientFacts,
    medicalTests: value.medicalTests,
    answerKey: value.answerKey,
    rubric: value.rubric,
    review: isRecord(value.review)
      ? {
          status: value.review.status === "fixture" ? "fixture" : "pending",
          author: value.review.author,
          ...(typeof value.review.notes === "string"
            ? { notes: value.review.notes }
            : {}),
        }
      : value.review,
    provenance: {
      sourceType: "synthetic",
      sourceCitation: isRecord(value.provenance) && Array.isArray(value.provenance.sources)
        ? value.provenance.sources
            .filter(isRecord)
            .map((source) => String(source.title ?? ""))
            .join("; ") || "invalid"
        : "invalid",
      license: isRecord(value.provenance) && Array.isArray(value.provenance.sources)
        ? value.provenance.sources
            .filter(isRecord)
            .map((source) => String(source.license ?? ""))
            .join("; ") || "invalid"
        : "invalid",
      createdAt: isRecord(value.provenance)
        ? value.provenance.createdAt
        : "invalid",
      contentHash: isRecord(value.provenance)
        ? value.provenance.contentHash
        : "invalid",
    },
    redFlagExclusionMatrix: value.redFlagExclusionMatrix,
  };
  try {
    assertCasePackage(compatibilityValue);
  } catch (error) {
    if (error instanceof CasePackageValidationError) {
      issues.push(...error.issues.map((issue) => `v2 common field: ${issue}`));
    } else {
      throw error;
    }
  }

  if (issues.length > 0) throw new CasePackageValidationError(issues);
}

export function assertSupportedCasePackage(
  value: unknown,
): asserts value is SupportedCasePackage {
  if (!isRecord(value)) {
    throw new CasePackageValidationError(["case package must be an object"]);
  }
  if (value.schemaVersion === CASE_PACKAGE_SCHEMA_VERSION_V1) {
    assertCasePackage(value);
    return;
  }
  if (value.schemaVersion === CASE_PACKAGE_SCHEMA_VERSION_V2) {
    assertCasePackageV2(value);
    return;
  }
  throw new CasePackageValidationError([
    `unsupported schemaVersion: ${String(value.schemaVersion)}`,
  ]);
}

export function migrateCasePackageV1ToV2(
  value: CasePackage,
  options: CasePackageV1MigrationOptions,
): CasePackageV2 {
  assertCasePackage(value);
  if (options.caseVersion === value.caseVersion) {
    throw new CasePackageValidationError([
      "migration caseVersion must create a new version different from the v1 source",
    ]);
  }
  if (
    !isPatientPersonaTemplateId(
      value.patientPersona.personaTemplateId,
      PATIENT_PERSONA_TEMPLATE_VERSION_V1,
    ) ||
    value.patientPersona.personaTemplateVersion !==
      PATIENT_PERSONA_TEMPLATE_VERSION_V1 ||
    !isNonEmptyString(value.patientPersona.educationOrOccupation) ||
    !isNonEmptyString(value.patientPersona.dailyLife) ||
    !isStringArray(value.patientPersona.interests) ||
    !isStringArray(value.patientPersona.communicationTraits)
  ) {
    throw new CasePackageValidationError([
      "legacy case must have complete Persona v1 dialogue metadata before migration",
    ]);
  }
  const migrated: CasePackageV2 = {
    schemaVersion: CASE_PACKAGE_SCHEMA_VERSION_V2,
    evaluationVersion: value.evaluationVersion,
    packageStatus: value.packageStatus === "fixture" ? "fixture" : "draft",
    internalCaseId: value.internalCaseId,
    publicCaseId: value.publicCaseId,
    caseVersion: options.caseVersion,
    locale: value.locale,
    playerVisible: {
      chiefComplaint: value.playerVisible.chiefComplaint,
    },
    patientIdentity: {
      patientRoleId: options.patientRoleId,
      patientDisplayName: value.playerVisible.patientDisplayName,
      ...(value.playerVisible.ageBand === undefined
        ? {}
        : { ageBand: value.playerVisible.ageBand }),
      ...(value.playerVisible.genderDisplay === undefined
        ? {}
        : { genderDisplay: value.playerVisible.genderDisplay }),
      educationOrOccupation: value.patientPersona.educationOrOccupation,
      dailyLife: value.patientPersona.dailyLife,
      interests: [...value.patientPersona.interests],
    },
    patientPersona: {
      personaTemplateId: value.patientPersona.personaTemplateId,
      personaTemplateVersion: PATIENT_PERSONA_TEMPLATE_VERSION_V2,
      languageStyle: value.patientPersona.languageStyle,
      communicationTraits: [...value.patientPersona.communicationTraits],
      modifiers: structuredClone(options.modifiers),
    },
    patientFacts: structuredClone(value.patientFacts),
    medicalTests: structuredClone(value.medicalTests),
    answerKey: structuredClone(value.answerKey),
    rubric: structuredClone(value.rubric),
    review: {
      status: value.review.status === "fixture" ? "fixture" : "pending",
      author: value.review.author,
      ...(value.review.notes === undefined ? {} : { notes: value.review.notes }),
    },
    provenance: {
      schemaVersion: PROVENANCE_RECORD_V2_SCHEMA_VERSION,
      createdAt: value.provenance.createdAt,
      contentHash: `sha256:${"0".repeat(64)}`,
      sources: structuredClone(options.provenanceSources),
    },
    redFlagExclusionMatrix: {
      ...structuredClone(value.redFlagExclusionMatrix),
      caseVersion: options.caseVersion,
      entries: value.redFlagExclusionMatrix.entries.map((entry) => ({
        ...structuredClone(entry),
        reviewDecision: "pending",
      })),
      review: { status: value.packageStatus === "fixture" ? "fixture" : "pending" },
    },
  };
  migrated.provenance.contentHash = computeCaseContentHash(migrated);
  assertCasePackageV2(migrated);
  return migrated;
}

export type FactStatus = "present" | "absent" | "unknown";

export type FactDisclosure =
  | "spontaneous"
  | "if_asked"
  | "test_only"
  | "hidden";

export interface PatientFact {
  status: FactStatus;
  value: string;
  disclosure: FactDisclosure;
  questionMatchers: string[];
}

export interface MedicalTestDefinition {
  status: "unavailable" | "completed";
  report?: string;
  assetId?: string;
  reasonCode?: string;
}

export interface CasePackage {
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
  };
  patientFacts: Record<string, PatientFact>;
  medicalTests: Record<string, MedicalTestDefinition>;
  answerKey: {
    targetDiagnosis: string;
    acceptedSynonyms: string[];
    acceptableDifferentials: string[];
  };
  rubric: {
    mustAskFactIds: string[];
    importantTestIds: string[];
    recommendedTurnLimit: number;
  };
  review: {
    status: "fixture" | "approved";
    source: string;
    reviewedBy?: string;
    reviewedAt?: string;
  };
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
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function assertCasePackage(value: unknown): asserts value is CasePackage {
  const issues: string[] = [];

  if (!isRecord(value)) {
    throw new CasePackageValidationError(["case package must be an object"]);
  }

  const publicCaseId = value.publicCaseId;
  const answerKey = value.answerKey;
  const patientFacts = value.patientFacts;
  const medicalTests = value.medicalTests;
  const rubric = value.rubric;
  const review = value.review;

  if (typeof value.internalCaseId !== "string" || value.internalCaseId.length === 0) {
    issues.push("internalCaseId is required");
  }

  if (typeof value.caseVersion !== "string" || value.caseVersion.length === 0) {
    issues.push("caseVersion is required");
  }

  if (typeof value.locale !== "string" || value.locale.length === 0) {
    issues.push("locale is required");
  }

  if (
    !isRecord(value.playerVisible) ||
    typeof value.playerVisible.patientDisplayName !== "string" ||
    typeof value.playerVisible.chiefComplaint !== "string"
  ) {
    issues.push("playerVisible requires patientDisplayName and chiefComplaint");
  }

  if (
    !isRecord(value.patientPersona) ||
    typeof value.patientPersona.languageStyle !== "string"
  ) {
    issues.push("patientPersona.languageStyle is required");
  }

  if (typeof publicCaseId !== "string" || publicCaseId.length === 0) {
    issues.push("publicCaseId is required");
  }

  if (!isRecord(answerKey) || typeof answerKey.targetDiagnosis !== "string") {
    issues.push("answerKey.targetDiagnosis is required");
  } else if (
    typeof publicCaseId === "string" &&
    normalizeTerm(publicCaseId).includes(normalizeTerm(answerKey.targetDiagnosis))
  ) {
    issues.push("publicCaseId must not reveal the target diagnosis");
  }
  if (isRecord(answerKey)) {
    if (!isStringArray(answerKey.acceptedSynonyms)) {
      issues.push("answerKey.acceptedSynonyms must be a string array");
    }
    if (!isStringArray(answerKey.acceptableDifferentials)) {
      issues.push("answerKey.acceptableDifferentials must be a string array");
    }
  }

  if (!isRecord(patientFacts)) {
    issues.push("patientFacts must be an object");
  } else {
    for (const [factId, fact] of Object.entries(patientFacts)) {
      if (!isRecord(fact)) {
        issues.push(`patient fact "${factId}" must be an object`);
        continue;
      }
      if (!(["present", "absent", "unknown"] as unknown[]).includes(fact.status)) {
        issues.push(`patient fact "${factId}" has an invalid status`);
      }
      if (typeof fact.value !== "string") {
        issues.push(`patient fact "${factId}" value must be a string`);
      }
      if (
        !(["spontaneous", "if_asked", "test_only", "hidden"] as unknown[]).includes(
          fact.disclosure,
        )
      ) {
        issues.push(`patient fact "${factId}" has an invalid disclosure`);
      }
      if (!isStringArray(fact.questionMatchers)) {
        issues.push(
          `patient fact "${factId}" questionMatchers must be a string array`,
        );
      }
    }
  }

  if (!isRecord(medicalTests)) {
    issues.push("medicalTests must be an object");
  } else {
    for (const [testId, definition] of Object.entries(medicalTests)) {
      if (!isRecord(definition)) {
        issues.push(`medical test "${testId}" must be an object`);
        continue;
      }
      if (definition.status !== "unavailable" && definition.status !== "completed") {
        issues.push(`medical test "${testId}" has an invalid status`);
      }
      if (definition.status === "completed" && typeof definition.report !== "string") {
        issues.push(`completed medical test "${testId}" requires a report`);
      }
      for (const field of ["report", "assetId", "reasonCode"] as const) {
        if (definition[field] !== undefined && typeof definition[field] !== "string") {
          issues.push(`medical test "${testId}" ${field} must be a string`);
        }
      }
    }
  }

  if (!isRecord(rubric)) {
    issues.push("rubric must be an object");
  } else {
    const mustAskFactIds = rubric.mustAskFactIds;
    const importantTestIds = rubric.importantTestIds;

    if (!Array.isArray(mustAskFactIds)) {
      issues.push("rubric.mustAskFactIds must be an array");
    } else if (isRecord(patientFacts)) {
      for (const factId of mustAskFactIds) {
        const fact = typeof factId === "string" ? patientFacts[factId] : undefined;
        if (
          !isRecord(fact) ||
          (fact.disclosure !== "if_asked" &&
            fact.disclosure !== "spontaneous")
        ) {
          issues.push(`rubric mustAsk fact "${String(factId)}" is not askable`);
        }
      }
    }

    if (!Array.isArray(importantTestIds)) {
      issues.push("rubric.importantTestIds must be an array");
    } else if (isRecord(medicalTests)) {
      for (const testId of importantTestIds) {
        if (typeof testId !== "string" || !isRecord(medicalTests[testId])) {
          issues.push(`rubric test "${String(testId)}" does not exist`);
        }
      }
    }

    if (
      typeof rubric.recommendedTurnLimit !== "number" ||
      !Number.isInteger(rubric.recommendedTurnLimit) ||
      rubric.recommendedTurnLimit <= 0
    ) {
      issues.push("rubric.recommendedTurnLimit must be a positive integer");
    }
  }

  if (
    !isRecord(review) ||
    (review.status !== "fixture" && review.status !== "approved")
  ) {
    issues.push("review.status must be fixture or approved");
  } else if (typeof review.source !== "string" || review.source.length === 0) {
    issues.push("review.source is required");
  }

  if (issues.length > 0) {
    throw new CasePackageValidationError(issues);
  }
}

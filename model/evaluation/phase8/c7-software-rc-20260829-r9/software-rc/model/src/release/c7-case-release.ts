import type { AiCaseCrossValidationV1 } from "../domain/case-package.js";
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

export function buildC7PublishedCaseManifest(input: {
  candidateManifest: C7CandidateCaseManifest;
  publishedCases: Array<
    C7CaseManifestEntry & { validationRecordPath: string }
  >;
}): C7CandidateCaseManifest {
  if (
    input.candidateManifest.draftCases.length !== 5 ||
    input.candidateManifest.publishedCases.length !== 0 ||
    input.publishedCases.length !== 5
  ) {
    throw new Error(
      "C7 publication requires five draft candidates and no pre-existing published entries",
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

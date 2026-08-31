import {
  SCORING_CONTRACT_V1,
  SCORING_POLICY_VERSION_V1,
} from "@ahamed/doctor-game-share";

import type { CasePackage } from "../domain/case-package.js";
import { mapDiagnosisToConcept, mapDifferentialsToUniqueConcepts } from "./diagnosis-matcher.js";

export type CommunicationScore = 0 | 50 | 100;

export type CommunicationAssessment =
  | {
      status: "available";
      score: CommunicationScore;
      supportingTurnIds: string[];
      rubricCriterionIds: string[];
    }
  | {
      status: "unavailable";
      failureCode: string;
    };

export interface ScoringPolicyInput {
  casePackage: CasePackage;
  primaryDiagnosis: string;
  differentials: string[];
  disclosedFactIds: string[];
  completedTestIds: string[];
  medicalTurnCount: number;
  repeatTurnCount: number;
  otherTurnCount: number;
  sessionTurnIds: string[];
  communication: CommunicationAssessment;
}

export interface ScoringEvidence {
  evidenceId: string;
  component: keyof ScoringComponents;
  outcome: "met" | "partial" | "missed" | "penalty" | "unavailable";
  supportingTurnIds?: string[];
  supportingTestIds?: string[];
  rubricCriterionIds?: string[];
}

export interface ScoringComponents {
  diagnosis: number;
  historyCoverage: number;
  differentialReasoning: number;
  testSelection: number;
  efficiency: number;
  communication: number | null;
}

export interface ScoringPolicyResult {
  evaluationVersion: typeof SCORING_POLICY_VERSION_V1;
  components: ScoringComponents;
  total: number | null;
  communicationStatus: "available" | "unavailable";
  communicationFailureCode?: string;
  diagnosisMatch: "exact" | "synonym" | "needs_review";
  needsReviewTerms: string[];
  evidence: ScoringEvidence[];
}

export class ScoringPolicyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoringPolicyInputError";
  }
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function unique(values: string[]): Set<string> {
  return new Set(values);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw new ScoringPolicyInputError(`${name} must be a non-negative integer`);
}

function assertUniqueNonEmpty(values: string[], name: string): void {
  if (
    values.some((value) => typeof value !== "string" || value.trim().length === 0) ||
    new Set(values).size !== values.length
  ) {
    throw new ScoringPolicyInputError(`${name} must contain unique non-empty IDs`);
  }
}

function validatePolicyInputs(input: ScoringPolicyInput): void {
  const { casePackage, primaryDiagnosis, differentials } = input;
  const { rubric } = casePackage;
  if (primaryDiagnosis.trim().length === 0) {
    throw new ScoringPolicyInputError("primaryDiagnosis is required");
  }
  if (differentials.some((value) => value.trim().length === 0)) {
    throw new ScoringPolicyInputError("differentials must be non-empty terms");
  }
  assertUniqueNonEmpty(input.sessionTurnIds, "sessionTurnIds");
  assertUniqueNonEmpty(rubric.mustAskFactIds, "mustAskFactIds");
  assertUniqueNonEmpty(
    rubric.acceptableDifferentialConceptIds,
    "acceptableDifferentialConceptIds",
  );
  assertUniqueNonEmpty(
    rubric.communicationCriterionIds,
    "communicationCriterionIds",
  );
  if (
    rubric.mustAskFactIds.length === 0 ||
    rubric.communicationCriterionIds.length === 0
  ) {
    throw new ScoringPolicyInputError(
      "ScoringPolicy v1 requires history and communication rubric criteria",
    );
  }
  if (
    rubric.requiredDifferentialCount !== 2 ||
    rubric.acceptableDifferentialConceptIds.length < 2
  ) {
    throw new ScoringPolicyInputError(
      "ScoringPolicy v1 requires two acceptable differential concepts",
    );
  }
  if (
    !Number.isInteger(rubric.recommendedTurnLimit) ||
    rubric.recommendedTurnLimit < 1 ||
    rubric.recommendedTurnLimit > 20
  ) {
    throw new ScoringPolicyInputError(
      "recommendedTurnLimit must be an integer from 1 to 20",
    );
  }

  const knownFactIds = new Set(Object.keys(casePackage.patientFacts));
  const knownTestIds = new Set(Object.keys(casePackage.medicalTests));
  const knownConceptIds = new Set(
    casePackage.answerKey.diagnosisConcepts.map(({ conceptId }) => conceptId),
  );
  if (!knownConceptIds.has(casePackage.answerKey.targetConceptId)) {
    throw new ScoringPolicyInputError("targetConceptId is not in the diagnosis terminology");
  }
  if (rubric.mustAskFactIds.some((factId) => !knownFactIds.has(factId))) {
    throw new ScoringPolicyInputError("mustAskFactIds contains an unknown factId");
  }
  if (
    rubric.acceptableDifferentialConceptIds.some(
      (conceptId) => !knownConceptIds.has(conceptId),
    )
  ) {
    throw new ScoringPolicyInputError(
      "acceptableDifferentialConceptIds contains an unknown conceptId",
    );
  }
  const classifiedTestIds = Object.keys(rubric.testClassifications);
  if (
    classifiedTestIds.length !== knownTestIds.size ||
    classifiedTestIds.some((testId) => !knownTestIds.has(testId))
  ) {
    throw new ScoringPolicyInputError(
      "testClassifications must cover every medical test exactly once",
    );
  }
  if (input.disclosedFactIds.some((factId) => !knownFactIds.has(factId))) {
    throw new ScoringPolicyInputError("disclosedFactIds contains an unknown factId");
  }
  if (input.completedTestIds.some((testId) => !knownTestIds.has(testId))) {
    throw new ScoringPolicyInputError("completedTestIds contains an unknown testId");
  }
}

function validateCommunication(input: ScoringPolicyInput): void {
  if (input.communication.status === "unavailable") {
    if (input.communication.failureCode.trim().length === 0) throw new ScoringPolicyInputError("communication failureCode is required");
    return;
  }
  if (![0, 50, 100].includes(input.communication.score)) throw new ScoringPolicyInputError("communication score must be 0, 50, or 100");
  const knownTurns = unique(input.sessionTurnIds);
  const knownCriteria = unique(input.casePackage.rubric.communicationCriterionIds);
  if (input.communication.supportingTurnIds.length === 0 || input.communication.rubricCriterionIds.length === 0) {
    throw new ScoringPolicyInputError("communication evidence is required");
  }
  if (
    input.communication.score === 100 &&
    unique(input.communication.rubricCriterionIds).size < 2
  ) {
    throw new ScoringPolicyInputError(
      "communication score 100 requires at least two distinct rubric criteria",
    );
  }
  if (input.communication.supportingTurnIds.some((turnId) => !knownTurns.has(turnId))) throw new ScoringPolicyInputError("communication evidence contains an unknown turnId");
  if (input.communication.rubricCriterionIds.some((criterionId) => !knownCriteria.has(criterionId))) throw new ScoringPolicyInputError("communication evidence contains an unknown rubric criterion");
}

export function scoreWithPolicyV1(input: ScoringPolicyInput): ScoringPolicyResult {
  assertNonNegativeInteger(input.medicalTurnCount, "medicalTurnCount");
  assertNonNegativeInteger(input.repeatTurnCount, "repeatTurnCount");
  assertNonNegativeInteger(input.otherTurnCount, "otherTurnCount");
  validatePolicyInputs(input);
  validateCommunication(input);

  const rubric = input.casePackage.rubric;
  const disclosed = unique(input.disclosedFactIds);
  const completedTests = unique(input.completedTestIds);
  const primary = mapDiagnosisToConcept(input.primaryDiagnosis, input.casePackage);
  const differentials = mapDifferentialsToUniqueConcepts(input.differentials, input.casePackage, primary.conceptId);
  const acceptedDifferentials = unique(rubric.acceptableDifferentialConceptIds);
  const matchedDifferentials = differentials.conceptIds.filter((conceptId) => acceptedDifferentials.has(conceptId));
  const requiredTests = Object.entries(rubric.testClassifications).filter(([, classification]) => classification === "required").map(([testId]) => testId);
  const unnecessaryTests = Object.entries(rubric.testClassifications).filter(([, classification]) => classification === "unnecessary").map(([testId]) => testId);
  const completedRequired = requiredTests.filter((testId) => completedTests.has(testId));
  const completedUnnecessary = unnecessaryTests.filter((testId) => completedTests.has(testId));
  const historyMatched = rubric.mustAskFactIds.filter((factId) => disclosed.has(factId));
  const excess = Math.max(0, input.medicalTurnCount - rubric.recommendedTurnLimit);

  const components: ScoringComponents = {
    diagnosis: primary.conceptId === input.casePackage.answerKey.targetConceptId ? 100 : 0,
    historyCoverage: Math.round((100 * historyMatched.length) / rubric.mustAskFactIds.length),
    differentialReasoning: Math.round((100 * Math.min(matchedDifferentials.length, 2)) / 2),
    testSelection: Math.round(clamp((requiredTests.length === 0 ? 100 : (100 * completedRequired.length) / requiredTests.length) - 20 * completedUnnecessary.length)),
    efficiency: clamp(100 - 10 * excess - 10 * input.repeatTurnCount - 5 * input.otherTurnCount),
    communication: input.communication.status === "available" ? input.communication.score : null,
  };

  const evidence: ScoringEvidence[] = [
    {
      evidenceId: components.diagnosis === 100 ? "diagnosis.target.met" : "diagnosis.target.missed",
      component: "diagnosis",
      outcome: components.diagnosis === 100 ? "met" : "missed",
    },
    ...rubric.mustAskFactIds.map((factId): ScoringEvidence => ({
      evidenceId: `history.${factId}.${disclosed.has(factId) ? "met" : "missed"}`,
      component: "historyCoverage",
      outcome: disclosed.has(factId) ? "met" : "missed",
    })),
    ...rubric.acceptableDifferentialConceptIds.map((conceptId): ScoringEvidence => ({
      evidenceId: `differential.${conceptId}.${matchedDifferentials.includes(conceptId) ? "met" : "missed"}`,
      component: "differentialReasoning",
      outcome: matchedDifferentials.includes(conceptId) ? "met" : "missed",
    })),
    ...requiredTests.map((testId): ScoringEvidence => ({
      evidenceId: `test.required.${testId}.${completedTests.has(testId) ? "met" : "missed"}`,
      component: "testSelection",
      outcome: completedTests.has(testId) ? "met" : "missed",
      supportingTestIds: completedTests.has(testId) ? [testId] : [],
    })),
    ...completedUnnecessary.map((testId): ScoringEvidence => ({
      evidenceId: `test.unnecessary.${testId}.penalty`,
      component: "testSelection",
      outcome: "penalty",
      supportingTestIds: [testId],
    })),
    { evidenceId: `efficiency.excess.${excess}`, component: "efficiency", outcome: excess === 0 ? "met" : "penalty" },
    { evidenceId: `efficiency.repeat.${input.repeatTurnCount}`, component: "efficiency", outcome: input.repeatTurnCount === 0 ? "met" : "penalty" },
    { evidenceId: `efficiency.other.${input.otherTurnCount}`, component: "efficiency", outcome: input.otherTurnCount === 0 ? "met" : "penalty" },
    input.communication.status === "available"
      ? {
          evidenceId: `communication.score.${input.communication.score}`,
          component: "communication",
          outcome: input.communication.score === 100
            ? "met"
            : input.communication.score === 50
              ? "partial"
              : "missed",
          supportingTurnIds: [...unique(input.communication.supportingTurnIds)],
          rubricCriterionIds: [...unique(input.communication.rubricCriterionIds)],
        }
      : {
          evidenceId: `communication.unavailable.${input.communication.failureCode}`,
          component: "communication",
          outcome: "unavailable",
        },
  ];

  const total = components.communication === null
    ? null
    : Math.round(
        components.diagnosis * SCORING_CONTRACT_V1.weights.diagnosis +
          components.historyCoverage * SCORING_CONTRACT_V1.weights.historyCoverage +
          components.differentialReasoning * SCORING_CONTRACT_V1.weights.differentialReasoning +
          components.testSelection * SCORING_CONTRACT_V1.weights.testSelection +
          components.efficiency * SCORING_CONTRACT_V1.weights.efficiency +
          components.communication * SCORING_CONTRACT_V1.weights.communication,
      );

  return {
    evaluationVersion: SCORING_POLICY_VERSION_V1,
    components,
    total,
    communicationStatus: input.communication.status,
    ...(input.communication.status === "unavailable" ? { communicationFailureCode: input.communication.failureCode } : {}),
    diagnosisMatch: primary.matchType === "preferred" ? "exact" : primary.matchType,
    needsReviewTerms: [...(primary.matchType === "needs_review" ? [input.primaryDiagnosis] : []), ...differentials.needsReview],
    evidence,
  };
}

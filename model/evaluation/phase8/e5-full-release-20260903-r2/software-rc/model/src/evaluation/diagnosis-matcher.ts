import type { SupportedCasePackage } from "../domain/case-package.js";

export interface DiagnosisMatch {
  input: string;
  conceptId?: string;
  matchType: "preferred" | "synonym" | "needs_review";
}

export function normalizeDiagnosisTerm(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
}

export function mapDiagnosisToConcept(
  value: string,
  casePackage: SupportedCasePackage,
): DiagnosisMatch {
  const normalized = normalizeDiagnosisTerm(value);
  for (const concept of casePackage.answerKey.diagnosisConcepts) {
    if (normalizeDiagnosisTerm(concept.preferredTerm) === normalized) {
      return { input: value, conceptId: concept.conceptId, matchType: "preferred" };
    }
    if (concept.acceptedSynonyms.some((term) => normalizeDiagnosisTerm(term) === normalized)) {
      return { input: value, conceptId: concept.conceptId, matchType: "synonym" };
    }
  }
  return { input: value, matchType: "needs_review" };
}

export function mapDifferentialsToUniqueConcepts(
  values: string[],
  casePackage: SupportedCasePackage,
  primaryConceptId?: string,
): { conceptIds: string[]; needsReview: string[] } {
  const conceptIds = new Set<string>();
  const needsReview: string[] = [];
  for (const value of values) {
    const match = mapDiagnosisToConcept(value, casePackage);
    if (match.conceptId === undefined) {
      needsReview.push(value);
    } else if (match.conceptId !== primaryConceptId) {
      conceptIds.add(match.conceptId);
    }
  }
  return { conceptIds: [...conceptIds], needsReview };
}

import type {
  EvaluationEvidence,
  EvaluationInput,
  MedicalEvaluation,
} from "../providers/model-provider.js";

function normalizeTerm(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function percentage(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 100;
  }
  return Math.round((numerator / denominator) * 100);
}

export function evaluateDeterministically(
  input: EvaluationInput,
): MedicalEvaluation {
  const normalizedDiagnosis = normalizeTerm(input.primaryDiagnosis);
  const target = normalizeTerm(input.casePackage.answerKey.targetDiagnosis);
  const synonymIndex = input.casePackage.answerKey.acceptedSynonyms.map(
    normalizeTerm,
  );
  const exact = normalizedDiagnosis === target;
  const synonym = synonymIndex.includes(normalizedDiagnosis);
  const diagnosisCorrect = exact || synonym;
  const disclosed = new Set(input.disclosedFactIds);
  const completedTests = new Set(input.completedTestIds);
  const askedCount = input.casePackage.rubric.mustAskFactIds.filter((factId) =>
    disclosed.has(factId),
  ).length;
  const completedImportantTests =
    input.casePackage.rubric.importantTestIds.filter((testId) =>
      completedTests.has(testId),
    ).length;
  const acceptableDifferentials = new Set(
    input.casePackage.answerKey.acceptableDifferentials.map(normalizeTerm),
  );
  const differentialMatched = input.differentials.some((diagnosis) =>
    acceptableDifferentials.has(normalizeTerm(diagnosis)),
  );
  const scores = {
    diagnosis: diagnosisCorrect ? 100 : 0,
    historyCoverage: percentage(
      askedCount,
      input.casePackage.rubric.mustAskFactIds.length,
    ),
    differentialReasoning: differentialMatched ? 100 : 0,
    testSelection: percentage(
      completedImportantTests,
      input.casePackage.rubric.importantTestIds.length,
    ),
    efficiency:
      input.turnIds.length <= input.casePackage.rubric.recommendedTurnLimit
        ? 100
        : 50,
    communication: 100,
    total: 0,
  };
  scores.total = Math.round(
    scores.diagnosis * 0.45 +
      scores.historyCoverage * 0.25 +
      scores.differentialReasoning * 0.1 +
      scores.testSelection * 0.1 +
      scores.efficiency * 0.05 +
      scores.communication * 0.05,
  );

  const evidence: EvaluationEvidence[] = [
    {
      criterionId: "diagnosis.primary",
      outcome: diagnosisCorrect ? "met" : "missed",
      explanation: diagnosisCorrect
        ? "The submitted diagnosis matched the fixture answer key."
        : "The submitted diagnosis did not match the fixture answer key.",
    },
    ...input.casePackage.rubric.mustAskFactIds.map((factId) => ({
      criterionId: `history.${factId}`,
      outcome: disclosed.has(factId) ? ("met" as const) : ("missed" as const),
      explanation: disclosed.has(factId)
        ? "The fact was disclosed during the interview."
        : "The fact was not disclosed during the interview.",
    })),
    ...input.casePackage.rubric.importantTestIds.map((testId) => ({
      criterionId: `test.${testId}`,
      outcome: completedTests.has(testId)
        ? ("met" as const)
        : ("missed" as const),
      explanation: completedTests.has(testId)
        ? "The recommended fixture test was completed."
        : "The recommended fixture test was not completed.",
      supportingTestIds: completedTests.has(testId) ? [testId] : [],
    })),
  ];

  return {
    diagnosis: {
      correct: diagnosisCorrect,
      ...(diagnosisCorrect
        ? { matchType: exact ? ("exact" as const) : ("synonym" as const) }
        : {}),
      explanation: diagnosisCorrect
        ? "The diagnosis matches the reviewed case answer key."
        : "The diagnosis does not match the reviewed case answer key.",
    },
    scores,
    evidence,
    summary: "Development-only deterministic evaluation completed.",
    evaluationVersion: "deterministic-fixture-v1",
  };
}

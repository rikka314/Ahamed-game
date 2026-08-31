import type { EvaluationEvidence, EvaluationInput, MedicalEvaluation } from "../providers/model-provider.js";
import {
  scoreWithPolicyV1,
  type CommunicationAssessment,
} from "./scoring-policy-v1.js";
import {
  publicDiagnosisExplanationV1,
  publicEvaluationSummaryV1,
} from "./public-evaluation-projection.js";

export function evaluateDeterministically(
  input: EvaluationInput,
  communication: CommunicationAssessment,
): MedicalEvaluation {
  const result = scoreWithPolicyV1({
    casePackage: input.casePackage,
    primaryDiagnosis: input.primaryDiagnosis,
    differentials: input.differentials,
    disclosedFactIds: input.disclosedFactIds,
    completedTestIds: input.completedTestIds,
    medicalTurnCount: input.medicalTurnCount ?? input.turnIds.length,
    repeatTurnCount: input.repeatTurnCount ?? 0,
    otherTurnCount: input.otherTurnCount ?? 0,
    sessionTurnIds: input.turnIds,
    communication,
  });
  const evidence: EvaluationEvidence[] = result.evidence.map((item) => ({
    criterionId: item.evidenceId,
    outcome: item.outcome === "penalty"
      ? "partial"
      : item.outcome === "unavailable"
        ? "not_applicable"
        : item.outcome,
    explanation: item.evidenceId,
    ...(item.supportingTurnIds === undefined ? {} : { supportingTurnIds: item.supportingTurnIds }),
    ...(item.supportingTestIds === undefined ? {} : { supportingTestIds: item.supportingTestIds }),
  }));
  return {
    diagnosis: {
      correct: result.components.diagnosis === 100,
      ...(result.diagnosisMatch === "needs_review" ? {} : { matchType: result.diagnosisMatch }),
      explanation: publicDiagnosisExplanationV1(
        result.components.diagnosis === 100,
      ),
    },
    scores: { ...result.components, total: result.total },
    evidence,
    summary: publicEvaluationSummaryV1(result.components.communication),
    evaluationVersion: result.evaluationVersion,
  };
}

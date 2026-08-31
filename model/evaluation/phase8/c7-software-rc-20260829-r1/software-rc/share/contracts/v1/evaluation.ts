import type { CaseVersionV1, CriterionIdV1, EvaluationIdV1, SessionIdV1, TestIdV1, TurnIdV1 } from "./ids.js";

export const CRITERION_OUTCOMES_V1 = ["met", "partial", "missed", "not_applicable"] as const;
export type CriterionOutcomeV1 = (typeof CRITERION_OUTCOMES_V1)[number];
export const DIAGNOSIS_MATCH_TYPES_V1 = ["exact", "synonym", "parent", "child", "semantic"] as const;
export type DiagnosisMatchTypeV1 = (typeof DIAGNOSIS_MATCH_TYPES_V1)[number];
export const SCORING_POLICY_VERSION_V1 = "scoring-policy-v1" as const;

export type EvaluationScoresV1 = {
  diagnosis: number;
  historyCoverage: number;
  differentialReasoning: number;
  testSelection: number;
  efficiency: number;
  communication: number;
  total: number;
};
export type EvaluationEvidenceV1 = {
  criterionId: CriterionIdV1;
  outcome: CriterionOutcomeV1;
  explanation: string;
  supportingTurnIds?: TurnIdV1[];
  supportingTestIds?: TestIdV1[];
};
export type EvaluationResultV1 = {
  contractVersion: "1";
  evaluationId: EvaluationIdV1;
  sessionId: SessionIdV1;
  caseVersion: CaseVersionV1;
  diagnosis: { correct: boolean; matchedConceptId?: string; matchType?: DiagnosisMatchTypeV1; explanation: string };
  scores: EvaluationScoresV1;
  evidence: EvaluationEvidenceV1[];
  summary: string;
  completedAt: string;
  evaluationVersion: typeof SCORING_POLICY_VERSION_V1;
};
export type RewardInputV1 = {
  evaluationId: EvaluationIdV1;
  sessionId: SessionIdV1;
  scoreTotal: number;
  diagnosisCorrect: boolean;
  criterionOutcomes: Array<{ criterionId: CriterionIdV1; outcome: CriterionOutcomeV1 }>;
};

export const SCORING_CONTRACT_V1 = {
  evaluationVersion: SCORING_POLICY_VERSION_V1,
  range: { minimum: 0, maximum: 100 },
  rounding: "half_up_to_integer",
  weights: {
    diagnosis: 0.45,
    historyCoverage: 0.25,
    differentialReasoning: 0.1,
    testSelection: 0.1,
    efficiency: 0.05,
    communication: 0.05,
  },
} as const;

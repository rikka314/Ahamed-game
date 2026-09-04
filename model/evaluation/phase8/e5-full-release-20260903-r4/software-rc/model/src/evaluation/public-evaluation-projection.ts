import { SCORING_POLICY_VERSION_V1 } from "@ahamed/doctor-game-share";

import type {
  EvaluationEvidence,
  MedicalEvaluation,
  ReviewEvaluationProjectionV1,
} from "../providers/model-provider.js";

type ScoreComponent =
  | "diagnosis"
  | "historyCoverage"
  | "differentialReasoning"
  | "testSelection"
  | "efficiency"
  | "communication";

const PUBLIC_COMPONENTS: ReadonlyArray<{
  scoreKey: ScoreComponent;
  criterionId: string;
  labelZh: string;
}> = [
  {
    scoreKey: "diagnosis",
    criterionId: "criterion.diagnosis",
    labelZh: "诊断",
  },
  {
    scoreKey: "historyCoverage",
    criterionId: "criterion.history",
    labelZh: "病史覆盖",
  },
  {
    scoreKey: "differentialReasoning",
    criterionId: "criterion.differential",
    labelZh: "鉴别诊断",
  },
  {
    scoreKey: "testSelection",
    criterionId: "criterion.test_selection",
    labelZh: "检查选择",
  },
  {
    scoreKey: "efficiency",
    criterionId: "criterion.efficiency",
    labelZh: "问诊效率",
  },
  {
    scoreKey: "communication",
    criterionId: "criterion.communication",
    labelZh: "沟通表达",
  },
];

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function outcomeForScore(
  score: number | null,
): EvaluationEvidence["outcome"] {
  if (score === null) return "not_applicable";
  if (score === 100) return "met";
  if (score === 0) return "missed";
  return "partial";
}

function explanationForOutcome(
  labelZh: string,
  outcome: EvaluationEvidence["outcome"],
): string {
  if (outcome === "met") {
    return `${labelZh}分项已达到本次病例的公开评价标准。`;
  }
  if (outcome === "partial") {
    return `${labelZh}分项部分达到本次病例的公开评价标准。`;
  }
  if (outcome === "missed") {
    return `${labelZh}分项未达到本次病例的公开评价标准。`;
  }
  return `${labelZh}分项当前不可用。`;
}

export function projectPublicEvaluationEvidenceV1(input: {
  scores: MedicalEvaluation["scores"];
  evidence: readonly EvaluationEvidence[];
}): EvaluationEvidence[] {
  const supportingTurnIds = unique(
    input.evidence.flatMap((item) => item.supportingTurnIds ?? []),
  );
  const supportingTestIds = unique(
    input.evidence.flatMap((item) => item.supportingTestIds ?? []),
  );

  return PUBLIC_COMPONENTS.map(({ scoreKey, criterionId, labelZh }) => {
    const outcome = outcomeForScore(input.scores[scoreKey]);
    return {
      criterionId,
      outcome,
      explanation: explanationForOutcome(labelZh, outcome),
      ...(scoreKey === "communication" && supportingTurnIds.length > 0
        ? { supportingTurnIds }
        : {}),
      ...(scoreKey === "testSelection" && supportingTestIds.length > 0
        ? { supportingTestIds }
        : {}),
    };
  });
}

export function projectReviewEvaluationV1(input: {
  scores: Pick<
    MedicalEvaluation["scores"],
    | "diagnosis"
    | "historyCoverage"
    | "differentialReasoning"
    | "testSelection"
    | "efficiency"
  >;
}): ReviewEvaluationProjectionV1 {
  const scores = {
    diagnosis: input.scores.diagnosis,
    historyCoverage: input.scores.historyCoverage,
    differentialReasoning: input.scores.differentialReasoning,
    testSelection: input.scores.testSelection,
    efficiency: input.scores.efficiency,
  };
  const evidence = projectPublicEvaluationEvidenceV1({
    scores: { ...scores, communication: null, total: null },
    evidence: [],
  }).filter(({ criterionId }) => criterionId !== "criterion.communication");
  return {
    scores,
    evidence,
    evaluationVersion: SCORING_POLICY_VERSION_V1,
  };
}

export function publicDiagnosisExplanationV1(correct: boolean): string {
  return correct
    ? "主要诊断与本病例经审核的允许术语一致。"
    : "主要诊断未匹配本病例经审核的允许术语。";
}

export function publicEvaluationSummaryV1(
  communicationScore: number | null,
): string {
  if (communicationScore === 100) {
    return "本次复盘：确定性评分已完成；沟通表达清晰、结构完整，达到当前公开评价标准。";
  }
  if (communicationScore === 50) {
    return "本次复盘：确定性评分已完成；沟通表达部分达到当前公开评价标准，仍有改进空间。";
  }
  if (communicationScore === 0) {
    return "本次复盘：确定性评分已完成；沟通表达未达到当前公开评价标准。";
  }
  return "本次复盘：确定性评分已完成；沟通复核暂不可用，因此未生成最终总分。";
}

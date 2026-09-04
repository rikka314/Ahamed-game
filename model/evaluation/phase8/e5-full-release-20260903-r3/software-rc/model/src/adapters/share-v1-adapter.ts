import type {
  CancelSessionResponseV1,
  CaseIdV1,
  CaseVersionV1,
  ClientCaseProjectionV1,
  CreateSessionResponseV1,
  CriterionIdV1,
  EvaluationResultV1,
  EvaluationIdV1,
  FactIdV1,
  NpcIdV1,
  PatientRoleIdV1,
  SessionIdV1,
  SharedErrorCodeV1,
  SharedErrorV1,
  TestIdV1,
  TestResultV1,
  TurnIdV1,
  TurnCompletedV1,
} from "@ahamed/doctor-game-share";
import {
  projectCaseSummaryV1,
  PUBLIC_ID_PATTERN_V1,
  SCORING_POLICY_VERSION_V1,
} from "@ahamed/doctor-game-share";

import {
  ModelServiceError,
  type ModelServiceErrorCode,
} from "../domain/errors.js";
import type {
  EvaluationCompleted,
  PublicSessionProjection,
  PublicSessionView,
  PublicTestResult,
  TurnCompleted,
} from "../application/model-service.js";
import {
  projectPublicEvaluationEvidenceV1,
  publicDiagnosisExplanationV1,
  publicEvaluationSummaryV1,
} from "../evaluation/public-evaluation-projection.js";

const ERROR_CODE_MAP: Readonly<
  Record<ModelServiceErrorCode, SharedErrorCodeV1>
> = {
  CASE_NOT_FOUND: "INVALID_REQUEST",
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  SESSION_CANCELLED: "SESSION_CANCELLED",
  INVALID_REQUEST: "INVALID_REQUEST",
  INVALID_SESSION_STATE: "INVALID_SESSION_STATE",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  OPERATION_IN_PROGRESS: "OPERATION_IN_PROGRESS",
  OPERATION_RECOVERY_REQUIRED: "OPERATION_RECOVERY_REQUIRED",
  TURN_LIMIT_REACHED: "TURN_LIMIT_REACHED",
  TEST_NOT_AVAILABLE: "TEST_NOT_AVAILABLE",
  MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",
  MODEL_OUTPUT_REJECTED: "MODEL_UNAVAILABLE",
  EVALUATION_UNAVAILABLE: "EVALUATION_UNAVAILABLE",
  SAFETY_PROMPT_INJECTION: "SAFETY_PROMPT_INJECTION",
  SAFETY_REAL_HEALTH_INPUT: "SAFETY_REAL_HEALTH_INPUT",
  SAFETY_INTERRUPTED: "SAFETY_INTERRUPTED",
};

const ERROR_MESSAGES_ZH: Readonly<Record<SharedErrorCodeV1, string>> = {
  INVALID_REQUEST: "请求参数无效。",
  UNSUPPORTED_CONTRACT_VERSION: "当前契约版本不受支持。",
  SESSION_NOT_FOUND: "未找到该会话，或该会话不属于当前用户。",
  SESSION_EXPIRED: "会话已过期，请开始新的病例。",
  SESSION_CANCELLED: "会话已取消。",
  INVALID_SESSION_STATE: "当前会话状态不允许执行此操作。",
  DUPLICATE_REQUEST: "该请求已经处理。",
  IDEMPOTENCY_CONFLICT: "请求标识已被不同内容使用。",
  OPERATION_IN_PROGRESS: "操作仍在处理中，请稍后查询。",
  OPERATION_RECOVERY_REQUIRED: "操作需要受控恢复，请联系内部运维人员。",
  TURN_LIMIT_REACHED: "已达到问诊回合上限，请提交诊断。",
  TEST_NOT_AVAILABLE: "当前病例不支持该检查。",
  TEST_ALREADY_COMPLETED: "该检查已经完成。",
  DIAGNOSIS_ALREADY_SUBMITTED: "诊断已经提交。",
  MODEL_TIMEOUT: "模型响应超时，请稍后重试。",
  MODEL_UNAVAILABLE: "模型暂时不可用，未生成患者回复。",
  EVALUATION_UNAVAILABLE: "评分暂时不可用，未生成最终总分。",
  STREAM_INTERRUPTED: "响应中断，请查询当前会话状态。",
  SAFETY_REAL_HEALTH_INPUT:
    "本工具只处理虚构病例，不能评估真实个人健康情况；如有现实健康问题，请联系正规医疗机构。",
  SAFETY_PROMPT_INJECTION: "该输入超出虚构病例问诊边界。",
  SAFETY_INTERRUPTED: "安全策略已中止本次病例交互。",
  INTERNAL_ERROR: "内部错误；本次操作未产生可见结果。",
};

const publicIdPattern = new RegExp(PUBLIC_ID_PATTERN_V1, "u");

function asOpaqueId<T extends string>(value: string, field: string): T {
  if (!publicIdPattern.test(value)) {
    throw new TypeError(`${field} is not a valid share v1 ID.`);
  }
  return value as T;
}

export function toClientCaseProjectionV1(
  projection: PublicSessionProjection,
): ClientCaseProjectionV1 {
  return {
    contractVersion: "1",
    sessionId: asOpaqueId<SessionIdV1>(projection.sessionId, "sessionId"),
    caseVersion: asOpaqueId<CaseVersionV1>(
      projection.caseVersion,
      "caseVersion",
    ),
    initialPresentation: projection.initialPresentation,
    disclosedFacts: projection.disclosedFacts.map((fact) => ({
      factId: asOpaqueId<FactIdV1>(fact.factId, "factId"),
      displayText: fact.displayText,
      disclosedAtTurn: fact.disclosedAtTurn,
    })),
    completedTests: projection.completedTests.map(toTestResultV1),
    turnCount: projection.turnCount,
    turnLimit: projection.turnLimit,
    sessionPhase: projection.sessionPhase,
  };
}

export function toCreateSessionResponseV1(input: {
  session: PublicSessionView;
  projection: PublicSessionProjection;
}): CreateSessionResponseV1 {
  return {
    session: projectCaseSummaryV1({
      contractVersion: "1",
      sessionId: asOpaqueId<SessionIdV1>(
        input.session.sessionId,
        "sessionId",
      ),
      caseId: asOpaqueId<CaseIdV1>(input.session.caseId, "caseId"),
      caseVersion: asOpaqueId<CaseVersionV1>(
        input.session.caseVersion,
        "caseVersion",
      ),
      patientNpcId: asOpaqueId<NpcIdV1>(
        input.session.patientNpcId,
        "patientNpcId",
      ),
      patientRoleId: asOpaqueId<PatientRoleIdV1>(
        input.session.patientRoleId,
        "patientRoleId",
      ),
      chiefComplaint: input.session.chiefComplaint,
      patientDisplay: { ...input.session.patientDisplay },
      allowedActions: [...input.session.allowedActions],
      sessionPhase: input.session.sessionPhase,
    }),
    projection: toClientCaseProjectionV1(input.projection),
  };
}

export function toTurnCompletedV1(input: TurnCompleted): TurnCompletedV1 {
  return {
    sessionId: asOpaqueId<SessionIdV1>(input.sessionId, "sessionId"),
    turnId: asOpaqueId<TurnIdV1>(input.turnId, "turnId"),
    reply: input.reply,
    disclosedFactIds: input.disclosedFactIds.map((factId) =>
      asOpaqueId<FactIdV1>(factId, "factId"),
    ),
    effects: input.effects.map((effect) => {
      if (effect.type === "test_unavailable") {
        return {
          type: "test_unavailable" as const,
          testId: asOpaqueId<TestIdV1>(effect.testId, "testId"),
          reasonCode: effect.reasonCode,
        };
      }
      const result = toTestResultV1(effect.result);
      if (result.status !== "completed") {
        throw new TypeError(
          "A test_completed turn effect must contain a completed result.",
        );
      }
      return {
        type: "test_completed" as const,
        result: { ...result, status: "completed" as const },
      };
    }),
    turnNumber: input.turnNumber,
    sessionPhase: input.sessionPhase,
  };
}

export function toTestResultV1(input: PublicTestResult): TestResultV1 {
  return {
    testId: asOpaqueId<TestIdV1>(input.testId, "testId"),
    status: input.status,
    ...(input.report === undefined ? {} : { report: input.report }),
    ...(input.assetId === undefined ? {} : { assetId: input.assetId }),
    ...(input.reasonCode === undefined
      ? {}
      : { reasonCode: input.reasonCode }),
  };
}

export function toEvaluationResultV1(
  input: EvaluationCompleted,
): EvaluationResultV1 {
  if (input.evaluationVersion !== SCORING_POLICY_VERSION_V1) {
    throw new TypeError("evaluationVersion does not match share v1.");
  }
  const publicEvidence = projectPublicEvaluationEvidenceV1(input);
  return {
    contractVersion: "1",
    evaluationId: asOpaqueId<EvaluationIdV1>(
      `evaluation.${input.sessionId}`,
      "evaluationId",
    ),
    sessionId: asOpaqueId<SessionIdV1>(input.sessionId, "sessionId"),
    caseVersion: asOpaqueId<CaseVersionV1>(
      input.caseVersion,
      "caseVersion",
    ),
    diagnosis: {
      correct: input.diagnosis.correct,
      ...(input.diagnosis.matchType === undefined
        ? {}
        : { matchType: input.diagnosis.matchType }),
      explanation: publicDiagnosisExplanationV1(input.diagnosis.correct),
    },
    scores: { ...input.scores },
    evidence: publicEvidence.map((item) => ({
      criterionId: asOpaqueId<CriterionIdV1>(
        item.criterionId,
        "criterionId",
      ),
      outcome: item.outcome,
      explanation: item.explanation,
      ...(item.supportingTurnIds === undefined
        ? {}
        : {
            supportingTurnIds: item.supportingTurnIds.map((turnId) =>
              asOpaqueId<TurnIdV1>(turnId, "turnId"),
            ),
          }),
      ...(item.supportingTestIds === undefined
        ? {}
        : {
            supportingTestIds: item.supportingTestIds.map((testId) =>
              asOpaqueId<TestIdV1>(testId, "testId"),
            ),
          }),
    })),
    summary: publicEvaluationSummaryV1(input.scores.communication),
    completedAt: input.completedAt,
    evaluationVersion: SCORING_POLICY_VERSION_V1,
  };
}

export function toCancelSessionResponseV1(input: {
  sessionId: string;
  sessionPhase: "cancelled";
  cancelledAt: string;
}): CancelSessionResponseV1 {
  return {
    sessionId: asOpaqueId<SessionIdV1>(input.sessionId, "sessionId"),
    sessionPhase: input.sessionPhase,
    cancelledAt: input.cancelledAt,
  };
}

export function toSharedErrorV1(error: unknown): SharedErrorV1 {
  if (!(error instanceof ModelServiceError)) {
    return {
      code: "INTERNAL_ERROR",
      message: ERROR_MESSAGES_ZH.INTERNAL_ERROR,
      retryable: false,
    };
  }
  const code = ERROR_CODE_MAP[error.code];
  return {
    code,
    message: code === "SAFETY_INTERRUPTED" || code === "SAFETY_REAL_HEALTH_INPUT"
      ? error.message
      : ERROR_MESSAGES_ZH[code],
    retryable: error.retryable,
  };
}

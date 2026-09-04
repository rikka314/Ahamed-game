import "server-only";

import { createHash } from "node:crypto";

import type {
  EvaluationResultV1,
  TurnCompletedV1,
} from "@ahamed/doctor-game-share";
import {
  toEvaluationResultV1,
  toTurnCompletedV1,
  type DiagnosisEvaluationRequestStatus,
  type EvaluationCompleted,
  type TurnCompleted,
} from "@ahamed/doctor-game-model";

const MAX_AUTOMATIC_EVALUATION_ATTEMPTS = 3;

export class AutomaticEvaluationLimitError extends Error {
  constructor(options: { cause?: unknown } = {}) {
    super("诊断评分已达到自动重试上限，请开始新的病例。", options);
    this.name = "AutomaticEvaluationLimitError";
  }
}

interface ClinicTurnService {
  askPatient(input: {
    sessionId: string;
    clientTurnId: string;
    text: string;
  }): Promise<TurnCompleted>;
  submitDiagnosis(input: {
    sessionId: string;
    clientRequestId: string;
    primaryDiagnosis: string;
    differentials: string[];
  }): Promise<EvaluationCompleted>;
  getDiagnosisEvaluationRequestStatus(
    sessionId: string,
    clientRequestId: string,
    idempotencyScopeId?: string,
  ): DiagnosisEvaluationRequestStatus;
}

export interface ClinicTurnResponse {
  turn?: TurnCompletedV1;
  evaluation?: EvaluationResultV1;
}

function automaticDiagnosisRequestId(
  turnId: string,
  evaluationAttempt: number,
): string {
  const digest = createHash("sha256")
    .update(`${turnId}:${evaluationAttempt}`, "utf8")
    .digest("hex");
  return `web.auto-diagnosis.${digest}`;
}

function errorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export async function completeClinicTurn(
  service: ClinicTurnService,
  input: {
    sessionId: string;
    clientTurnId: string;
    text: string;
    idempotencyScopeId: string;
  },
  beforeEvaluation?: () => void,
): Promise<ClinicTurnResponse> {
  const turn = await service.askPatient(input);
  const response: ClinicTurnResponse = {
    turn: toTurnCompletedV1(turn),
  };
  if (!turn.diagnosisSubmission) return response;

  let evaluationAttempt: number | undefined;
  let clientRequestId: string | undefined;
  for (
    let candidateAttempt = 0;
    candidateAttempt < MAX_AUTOMATIC_EVALUATION_ATTEMPTS;
    candidateAttempt += 1
  ) {
    const candidateRequestId = automaticDiagnosisRequestId(
      turn.turnId,
      candidateAttempt,
    );
    const status = service.getDiagnosisEvaluationRequestStatus(
      input.sessionId,
      candidateRequestId,
      input.idempotencyScopeId,
    );
    if (status !== "failed") {
      evaluationAttempt = candidateAttempt;
      clientRequestId = candidateRequestId;
      break;
    }
  }
  if (evaluationAttempt === undefined || clientRequestId === undefined) {
    throw new AutomaticEvaluationLimitError();
  }

  beforeEvaluation?.();
  try {
    const evaluation = await service.submitDiagnosis({
      sessionId: input.sessionId,
      clientRequestId,
      primaryDiagnosis: turn.diagnosisSubmission.primaryDiagnosis,
      differentials: turn.diagnosisSubmission.differentials,
    });
    return {
      ...response,
      evaluation: toEvaluationResultV1(evaluation),
    };
  } catch (error) {
    if (
      ["OPERATION_IN_PROGRESS", "OPERATION_RECOVERY_REQUIRED"].includes(
        errorCode(error) ?? "",
      )
    ) {
      throw error;
    }
    const latestStatus = service.getDiagnosisEvaluationRequestStatus(
      input.sessionId,
      clientRequestId,
      input.idempotencyScopeId,
    );
    if (
      evaluationAttempt === MAX_AUTOMATIC_EVALUATION_ATTEMPTS - 1 &&
      latestStatus === "failed"
    ) {
      throw new AutomaticEvaluationLimitError({ cause: error });
    }
    throw error;
  }
}

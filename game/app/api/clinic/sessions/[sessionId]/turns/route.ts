import { toEvaluationResultV1 } from "@ahamed/doctor-game-model";
import { NextRequest } from "next/server";

import {
  assertClinicWriteOrigin,
  ClinicHttpError,
  clinicErrorResponse,
  clinicJsonResponse,
  clinicProfileId,
  missingClinicProfileResponse,
  readJsonObject,
} from "@/src/server/clinic-http";
import { getClinicRuntime } from "@/src/server/clinic-runtime";
import { enforceClinicRateLimit } from "@/src/server/clinic-rate-limit";
import {
  AutomaticEvaluationLimitError,
  completeClinicTurn,
} from "@/src/server/clinic-turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const profileId = clinicProfileId(request);
  if (profileId === undefined) {
    return missingClinicProfileResponse();
  }
  try {
    assertClinicWriteOrigin(request);
    const { sessionId } = await context.params;
    const body = await readJsonObject(request);
    if (
      typeof body["clientTurnId"] !== "string" ||
      typeof body["text"] !== "string"
    ) {
      throw new ClinicHttpError(
        400,
        "INVALID_REQUEST",
        "clientTurnId 和 text 无效。",
      );
    }
    const runtime = getClinicRuntime();
    const snapshot = runtime.service.getSessionSnapshot(sessionId, profileId);
    if (snapshot.session.sessionPhase === "completed") {
      return clinicJsonResponse({
        evaluation: toEvaluationResultV1(
          runtime.service.getResult(sessionId, profileId),
        ),
      });
    }
    if (snapshot.session.sessionPhase === "evaluating") {
      throw new ClinicHttpError(
        409,
        "OPERATION_IN_PROGRESS",
        "诊断评分仍在处理中，请稍后重试确认结果。",
        true,
      );
    }
    enforceClinicRateLimit(request, "turn", profileId);
    try {
      const result = await completeClinicTurn(
        runtime.service,
        {
          sessionId,
          clientTurnId: body["clientTurnId"],
          text: body["text"],
          idempotencyScopeId: profileId,
        },
        () => enforceClinicRateLimit(request, "diagnosis", profileId),
      );
      return clinicJsonResponse(result);
    } catch (turnError) {
      let latestSnapshot: typeof snapshot;
      try {
        latestSnapshot = runtime.service.getSessionSnapshot(sessionId, profileId);
      } catch {
        throw turnError;
      }
      if (latestSnapshot.session.sessionPhase === "completed") {
        return clinicJsonResponse({
          evaluation: toEvaluationResultV1(
            runtime.service.getResult(sessionId, profileId),
          ),
        });
      }
      if (latestSnapshot.session.sessionPhase === "evaluating") {
        throw new ClinicHttpError(
          409,
          "OPERATION_IN_PROGRESS",
          "诊断评分仍在处理中，请稍后重试确认结果。",
          true,
        );
      }
      if (
        latestSnapshot.session.sessionPhase === "diagnosis_submitted" &&
        !(turnError instanceof ClinicHttpError && turnError.status === 429)
      ) {
        if (turnError instanceof AutomaticEvaluationLimitError) {
          throw new ClinicHttpError(
            503,
            "EVALUATION_UNAVAILABLE",
            turnError.message,
            false,
          );
        }
        throw new ClinicHttpError(
          503,
          "EVALUATION_UNAVAILABLE",
          "诊断已经识别，但评分暂时不可用。请重试原句继续结算。",
          true,
        );
      }
      throw turnError;
    }
  } catch (error) {
    return clinicErrorResponse(error);
  }
}

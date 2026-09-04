import { toCreateSessionResponseV1 } from "@ahamed/doctor-game-model";
import { NextRequest } from "next/server";

import {
  assertClinicWriteOrigin,
  ClinicHttpError,
  clinicErrorResponse,
  clinicJsonResponse,
  clinicProfileId,
  newClinicProfileId,
  readJsonObject,
  setClinicProfileCookie,
} from "@/src/server/clinic-http";
import { getClinicRuntime } from "@/src/server/clinic-runtime";
import { enforceClinicRateLimit } from "@/src/server/clinic-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertClinicWriteOrigin(request);
    const existingProfileId = clinicProfileId(request);
    const body = await readJsonObject(request);
    if (
      typeof body["clientRequestId"] !== "string" ||
      typeof body["publicCaseId"] !== "string"
    ) {
      throw new ClinicHttpError(
        400,
        "INVALID_REQUEST",
        "clientRequestId 和 publicCaseId 为必填字段。",
      );
    }
    enforceClinicRateLimit(request, "create", existingProfileId);
    const profileId = existingProfileId ?? newClinicProfileId();
    const created = await getClinicRuntime().service.createSession({
      clientRequestId: body["clientRequestId"],
      idempotencyScopeId: profileId,
      publicCaseId: body["publicCaseId"],
      patientNpcId: "npc.web-consultation-room",
    });
    const response = clinicJsonResponse(toCreateSessionResponseV1(created));
    if (existingProfileId === undefined) {
      setClinicProfileCookie(response, profileId);
    }
    return response;
  } catch (error) {
    return clinicErrorResponse(error);
  }
}

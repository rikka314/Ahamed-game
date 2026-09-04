import { toCreateSessionResponseV1 } from "@ahamed/doctor-game-model";
import { NextRequest } from "next/server";

import {
  clinicErrorResponse,
  clinicJsonResponse,
  clinicProfileId,
  missingClinicProfileResponse,
} from "@/src/server/clinic-http";
import { getClinicRuntime } from "@/src/server/clinic-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const profileId = clinicProfileId(request);
  if (profileId === undefined) return missingClinicProfileResponse();
  try {
    const { sessionId } = await context.params;
    const snapshot = getClinicRuntime().service.getSessionSnapshot(
      sessionId,
      profileId,
    );
    return clinicJsonResponse(toCreateSessionResponseV1(snapshot));
  } catch (error) {
    return clinicErrorResponse(error);
  }
}

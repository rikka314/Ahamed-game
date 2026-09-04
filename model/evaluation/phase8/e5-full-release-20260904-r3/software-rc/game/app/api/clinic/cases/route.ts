import { NextRequest } from "next/server";

import {
  clinicErrorResponse,
  clinicJsonResponse,
  clinicProfileId,
  newClinicProfileId,
  setClinicProfileCookie,
} from "@/src/server/clinic-http";
import { getClinicPublicCases } from "@/src/server/clinic-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  try {
    const response = clinicJsonResponse({ cases: getClinicPublicCases() });
    if (clinicProfileId(request) === undefined) {
      setClinicProfileCookie(response, newClinicProfileId());
    }
    return response;
  } catch (error) {
    return clinicErrorResponse(error);
  }
}

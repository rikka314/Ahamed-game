import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClinicPublicCases: vi.fn(),
  getClinicRuntime: vi.fn(),
}));

vi.mock("@/src/server/clinic-runtime", () => ({
  getClinicPublicCases: mocks.getClinicPublicCases,
  getClinicRuntime: mocks.getClinicRuntime,
}));

import { GET as getCases } from "@/app/api/clinic/cases/route";
import { POST as createSession } from "@/app/api/clinic/sessions/route";

const publicCase = {
  publicCaseId: "case.public-cookie-001",
  caseVersion: "case-v1",
  patientRoleId: "patient-role.public-cookie-001",
  displayName: "林同学",
  chiefComplaint: "咳嗽两天",
  ageBand: "青年",
  genderDisplay: "女",
};

const createdSession = {
  session: {
    contractVersion: "1",
    sessionId: "session.web-cookie-001",
    caseId: publicCase.publicCaseId,
    caseVersion: publicCase.caseVersion,
    patientNpcId: "npc.web-consultation-room",
    patientRoleId: publicCase.patientRoleId,
    chiefComplaint: publicCase.chiefComplaint,
    patientDisplay: {
      displayName: publicCase.displayName,
      ageBand: publicCase.ageBand,
      genderDisplay: publicCase.genderDisplay,
    },
    allowedActions: ["ask_patient"],
    sessionPhase: "active",
  },
  projection: {
    sessionId: "session.web-cookie-001",
    caseVersion: publicCase.caseVersion,
    initialPresentation: "医生，我咳嗽两天了。",
    disclosedFacts: [],
    completedTests: [],
    turnCount: 0,
    turnLimit: 20,
    sessionPhase: "active",
  },
};

function sessionRequest(cookie: string): NextRequest {
  return new NextRequest("http://localhost/api/clinic/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      Host: "localhost",
      Origin: "http://localhost",
    },
    body: JSON.stringify({
      clientRequestId: "web.create.cookie-replay-001",
      publicCaseId: publicCase.publicCaseId,
    }),
  });
}

describe("clinic profile bootstrap and create replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClinicPublicCases.mockReturnValue([publicCase]);
  });

  it("reuses the profile cookie scope for an idempotent create replay", async () => {
    const sessions = new Map<string, typeof createdSession>();
    const create = vi.fn(async (input: {
      clientRequestId: string;
      idempotencyScopeId: string;
    }) => {
      const key = `${input.idempotencyScopeId}:${input.clientRequestId}`;
      const existing = sessions.get(key);
      if (existing) return existing;
      sessions.set(key, createdSession);
      return createdSession;
    });
    mocks.getClinicRuntime.mockReturnValue({
      service: { createSession: create },
    });

    const casesResponse = getCases(
      new NextRequest("http://localhost/api/clinic/cases"),
    );
    const cookie = casesResponse.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toMatch(/^ahamed-clinic-profile=web\.profile\./u);
    expect(casesResponse.headers.get("set-cookie")).toContain("HttpOnly");
    expect(casesResponse.headers.get("set-cookie")).toContain("SameSite=strict");

    const first = await createSession(sessionRequest(cookie!));
    const replay = await createSession(sessionRequest(cookie!));
    const firstBody = await first.json();
    const replayBody = await replay.json();

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(firstBody.session.sessionId).toBe("session.web-cookie-001");
    expect(replayBody.session.sessionId).toBe(firstBody.session.sessionId);
    expect(sessions.size).toBe(1);
    expect(create.mock.calls[0]?.[0].idempotencyScopeId)
      .toBe(cookie!.split("=", 2)[1]);
    expect(create.mock.calls[1]?.[0].idempotencyScopeId)
      .toBe(create.mock.calls[0]?.[0].idempotencyScopeId);
  });
});

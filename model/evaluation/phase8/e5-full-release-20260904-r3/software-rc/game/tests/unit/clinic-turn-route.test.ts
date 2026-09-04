import type { EvaluationCompleted } from "@ahamed/doctor-game-model";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeClinicTurn: vi.fn(),
  enforceClinicRateLimit: vi.fn(),
  getClinicRuntime: vi.fn(),
}));

vi.mock("@/src/server/clinic-turn", () => ({
  AutomaticEvaluationLimitError: class AutomaticEvaluationLimitError extends Error {},
  completeClinicTurn: mocks.completeClinicTurn,
}));
vi.mock("@/src/server/clinic-rate-limit", () => ({
  enforceClinicRateLimit: mocks.enforceClinicRateLimit,
}));
vi.mock("@/src/server/clinic-runtime", () => ({
  getClinicRuntime: mocks.getClinicRuntime,
}));

import { POST } from "@/app/api/clinic/sessions/[sessionId]/turns/route";
import { AutomaticEvaluationLimitError } from "@/src/server/clinic-turn";

const profileId = "web.profile.123e4567-e89b-42d3-a456-426614174000";
const evaluation: EvaluationCompleted = {
  sessionId: "session.web-001",
  caseVersion: "case-v1",
  sessionPhase: "completed",
  completedAt: "2026-09-04T04:00:00.000Z",
  diagnosis: {
    correct: true,
    matchType: "exact",
    explanation: "private explanation",
  },
  scores: {
    diagnosis: 100,
    historyCoverage: 80,
    differentialReasoning: 70,
    testSelection: 60,
    efficiency: 90,
    communication: 100,
    total: 89,
  },
  evidence: [],
  summary: "private summary",
  evaluationVersion: "scoring-policy-v1",
};

function turnRequest(): NextRequest {
  return new NextRequest(
    "http://localhost/api/clinic/sessions/session.web-001/turns",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `ahamed-clinic-profile=${profileId}`,
        Host: "localhost",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        clientTurnId: "web.turn.001",
        text: "最终诊断是上呼吸道感染。",
      }),
    },
  );
}

const context = {
  params: Promise.resolve({ sessionId: "session.web-001" }),
};

function snapshot(sessionPhase: string) {
  return { session: { sessionPhase } };
}

describe("clinic turn route recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("binds automatic evaluation state lookup to the owning web profile", async () => {
    const service = {
      getSessionSnapshot: vi.fn().mockReturnValue(snapshot("active")),
      getResult: vi.fn(),
    };
    mocks.getClinicRuntime.mockReturnValue({ service });
    mocks.completeClinicTurn.mockResolvedValueOnce({});

    const response = await POST(turnRequest(), context);

    expect(response.status).toBe(200);
    expect(mocks.completeClinicTurn).toHaveBeenCalledWith(
      service,
      {
        sessionId: "session.web-001",
        clientTurnId: "web.turn.001",
        text: "最终诊断是上呼吸道感染。",
        idempotencyScopeId: profileId,
      },
      expect.any(Function),
    );
  });

  it("keeps the same operation while evaluation is already running", async () => {
    const service = {
      getSessionSnapshot: vi.fn().mockReturnValue(snapshot("evaluating")),
      getResult: vi.fn(),
    };
    mocks.getClinicRuntime.mockReturnValue({ service });

    const response = await POST(turnRequest(), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "OPERATION_IN_PROGRESS",
      retryable: true,
    });
    expect(mocks.completeClinicTurn).not.toHaveBeenCalled();
  });

  it("returns the completed score when the first HTTP result was lost", async () => {
    const service = {
      getSessionSnapshot: vi.fn()
        .mockReturnValueOnce(snapshot("active"))
        .mockReturnValueOnce(snapshot("completed")),
      getResult: vi.fn().mockReturnValue(evaluation),
    };
    mocks.getClinicRuntime.mockReturnValue({ service });
    mocks.completeClinicTurn.mockRejectedValueOnce(
      new Error("terminal replay after completion"),
    );

    const response = await POST(turnRequest(), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      evaluation: { scores: { total: 89 } },
    });
  });

  it("normalizes failures after diagnosis commit as evaluation failures", async () => {
    const service = {
      getSessionSnapshot: vi.fn()
        .mockReturnValueOnce(snapshot("active"))
        .mockReturnValueOnce(snapshot("diagnosis_submitted")),
      getResult: vi.fn(),
    };
    mocks.getClinicRuntime.mockReturnValue({ service });
    mocks.completeClinicTurn.mockRejectedValueOnce(
      new Error("MODEL_OUTPUT_REJECTED"),
    );

    const response = await POST(turnRequest(), context);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "EVALUATION_UNAVAILABLE",
      retryable: true,
    });
  });

  it("returns a non-retryable result after the server-owned limit", async () => {
    const service = {
      getSessionSnapshot: vi.fn()
        .mockReturnValueOnce(snapshot("active"))
        .mockReturnValueOnce(snapshot("diagnosis_submitted")),
      getResult: vi.fn(),
    };
    mocks.getClinicRuntime.mockReturnValue({ service });
    mocks.completeClinicTurn.mockRejectedValueOnce(
      new AutomaticEvaluationLimitError(),
    );

    const response = await POST(turnRequest(), context);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "EVALUATION_UNAVAILABLE",
      retryable: false,
    });
  });
});

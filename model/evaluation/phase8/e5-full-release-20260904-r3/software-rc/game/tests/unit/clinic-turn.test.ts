import type {
  DiagnosisEvaluationRequestStatus,
  EvaluationCompleted,
  TurnCompleted,
} from "@ahamed/doctor-game-model";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  AutomaticEvaluationLimitError,
  completeClinicTurn,
} from "@/src/server/clinic-turn";

const baseTurn: TurnCompleted = {
  sessionId: "session.web-001",
  turnId: "turn.web-001",
  reply: "请继续问吧。",
  disclosedFactIds: [],
  effects: [],
  turnNumber: 1,
  sessionPhase: "active",
};

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

function evaluationRequestId(turnId: string, attempt: number): string {
  return `web.auto-diagnosis.${createHash("sha256").update(`${turnId}:${attempt}`).digest("hex")}`;
}

function turnInput(turn: TurnCompleted, suffix: string) {
  return {
    sessionId: turn.sessionId,
    clientTurnId: `web.turn.${suffix}`,
    text: "最终诊断是上呼吸道感染。",
    idempotencyScopeId: "web.profile.test",
  };
}

describe("completeClinicTurn", () => {
  it("returns an ordinary patient turn without starting evaluation", async () => {
    const askPatient = vi.fn().mockResolvedValue(baseTurn);
    const submitDiagnosis = vi.fn();
    const getDiagnosisEvaluationRequestStatus = vi.fn();
    const beforeEvaluation = vi.fn();

    const result = await completeClinicTurn(
      { askPatient, submitDiagnosis, getDiagnosisEvaluationRequestStatus },
      { ...turnInput(baseTurn, "001"), text: "哪里不舒服？" },
      beforeEvaluation,
    );

    expect(result.turn?.reply).toBe(baseTurn.reply);
    expect(result.evaluation).toBeUndefined();
    expect(submitDiagnosis).not.toHaveBeenCalled();
    expect(getDiagnosisEvaluationRequestStatus).not.toHaveBeenCalled();
    expect(beforeEvaluation).not.toHaveBeenCalled();
  });

  it("submits a model-detected diagnosis and returns its public score", async () => {
    const diagnosedTurn: TurnCompleted = {
      ...baseTurn,
      diagnosisSubmission: {
        primaryDiagnosis: "上呼吸道感染",
        differentials: ["流感"],
      },
    };
    const askPatient = vi.fn().mockResolvedValue(diagnosedTurn);
    const submitDiagnosis = vi.fn().mockResolvedValue(evaluation);
    const getDiagnosisEvaluationRequestStatus = vi.fn()
      .mockReturnValue("not_found");
    const beforeEvaluation = vi.fn();

    const result = await completeClinicTurn(
      { askPatient, submitDiagnosis, getDiagnosisEvaluationRequestStatus },
      {
        ...turnInput(diagnosedTurn, "002"),
        text: "我的最终诊断是上呼吸道感染，鉴别流感。",
      },
      beforeEvaluation,
    );

    expect(beforeEvaluation).toHaveBeenCalledOnce();
    expect(submitDiagnosis).toHaveBeenCalledWith({
      sessionId: diagnosedTurn.sessionId,
      clientRequestId: evaluationRequestId(diagnosedTurn.turnId, 0),
      primaryDiagnosis: "上呼吸道感染",
      differentials: ["流感"],
    });
    expect(result.evaluation?.scores.total).toBe(89);
    expect(result.evaluation?.diagnosis.explanation).not.toContain("private");
  });

  it("rotates only the server-owned evaluation key after a confirmed failure", async () => {
    const diagnosedTurn: TurnCompleted = {
      ...baseTurn,
      diagnosisSubmission: {
        primaryDiagnosis: "上呼吸道感染",
        differentials: [],
      },
    };
    const askPatient = vi.fn().mockResolvedValue(diagnosedTurn);
    const statuses = new Map<string, DiagnosisEvaluationRequestStatus>();
    const getDiagnosisEvaluationRequestStatus = vi.fn(
      (_sessionId: string, requestId: string) =>
        statuses.get(requestId) ?? "not_found",
    );
    const submitDiagnosis = vi.fn(async (request: { clientRequestId: string }) => {
      if (submitDiagnosis.mock.calls.length === 1) {
        statuses.set(request.clientRequestId, "failed");
        throw new Error("evaluation failed");
      }
      return evaluation;
    });
    const input = turnInput(diagnosedTurn, "retry");

    await expect(completeClinicTurn(
      { askPatient, submitDiagnosis, getDiagnosisEvaluationRequestStatus },
      input,
    )).rejects.toThrow("evaluation failed");
    await completeClinicTurn(
      { askPatient, submitDiagnosis, getDiagnosisEvaluationRequestStatus },
      input,
    );

    expect(submitDiagnosis.mock.calls.map(([request]) => request.clientRequestId))
      .toEqual([0, 1].map((attempt) =>
        evaluationRequestId(diagnosedTurn.turnId, attempt)
      ));
  });

  it("stops without another provider call after three confirmed failures", async () => {
    const diagnosedTurn: TurnCompleted = {
      ...baseTurn,
      turnId: "turn.web.retry-limit",
      diagnosisSubmission: {
        primaryDiagnosis: "上呼吸道感染",
        differentials: [],
      },
    };
    const askPatient = vi.fn().mockResolvedValue(diagnosedTurn);
    const submitDiagnosis = vi.fn();
    const getDiagnosisEvaluationRequestStatus = vi.fn()
      .mockReturnValue("failed");

    await expect(completeClinicTurn(
      { askPatient, submitDiagnosis, getDiagnosisEvaluationRequestStatus },
      turnInput(diagnosedTurn, "retry-limit"),
    ))
      .rejects.toBeInstanceOf(AutomaticEvaluationLimitError);
    expect(submitDiagnosis).not.toHaveBeenCalled();
    expect(getDiagnosisEvaluationRequestStatus).toHaveBeenCalledTimes(3);
  });

  it("reports the limit as soon as the third evaluation is confirmed failed", async () => {
    const diagnosedTurn: TurnCompleted = {
      ...baseTurn,
      turnId: "turn.web.final-failure",
      diagnosisSubmission: {
        primaryDiagnosis: "上呼吸道感染",
        differentials: [],
      },
    };
    const failedIds = new Set([
      evaluationRequestId(diagnosedTurn.turnId, 0),
      evaluationRequestId(diagnosedTurn.turnId, 1),
    ]);
    const askPatient = vi.fn().mockResolvedValue(diagnosedTurn);
    const getDiagnosisEvaluationRequestStatus = vi.fn(
      (_sessionId: string, requestId: string) =>
        failedIds.has(requestId) ? "failed" : "not_found",
    );
    const submitDiagnosis = vi.fn(async (request: { clientRequestId: string }) => {
      failedIds.add(request.clientRequestId);
      throw new Error("final evaluation failure");
    });

    await expect(completeClinicTurn(
      { askPatient, submitDiagnosis, getDiagnosisEvaluationRequestStatus },
      turnInput(diagnosedTurn, "final-failure"),
    )).rejects.toBeInstanceOf(AutomaticEvaluationLimitError);
    expect(submitDiagnosis).toHaveBeenCalledOnce();
    expect(submitDiagnosis).toHaveBeenCalledWith(expect.objectContaining({
      clientRequestId: evaluationRequestId(diagnosedTurn.turnId, 2),
    }));
  });

  it.each(["OPERATION_IN_PROGRESS", "OPERATION_RECOVERY_REQUIRED"])(
    "does not advance the evaluation key for %s",
    async (code) => {
      const diagnosedTurn: TurnCompleted = {
        ...baseTurn,
        turnId: `turn.web.${code.toLowerCase()}`,
        diagnosisSubmission: {
          primaryDiagnosis: "上呼吸道感染",
          differentials: [],
        },
      };
      const unresolvedError = Object.assign(new Error("still running"), {
        code,
      });
      const askPatient = vi.fn().mockResolvedValue(diagnosedTurn);
      const statuses = new Map<string, DiagnosisEvaluationRequestStatus>();
      const getDiagnosisEvaluationRequestStatus = vi.fn(
        (_sessionId: string, requestId: string) =>
          statuses.get(requestId) ?? "not_found",
      );
      const submitDiagnosis = vi.fn()
        .mockImplementationOnce((request: { clientRequestId: string }) => {
          statuses.set(
            request.clientRequestId,
            code === "OPERATION_IN_PROGRESS"
              ? "in_progress"
              : "recovery_required",
          );
          throw unresolvedError;
        })
        .mockResolvedValueOnce(evaluation);
      const input = turnInput(diagnosedTurn, "in-progress");

      await expect(completeClinicTurn(
        { askPatient, submitDiagnosis, getDiagnosisEvaluationRequestStatus },
        input,
      ))
        .rejects.toBe(unresolvedError);
      await completeClinicTurn(
        { askPatient, submitDiagnosis, getDiagnosisEvaluationRequestStatus },
        input,
      );

      const expectedRequestId = evaluationRequestId(diagnosedTurn.turnId, 0);
      expect(submitDiagnosis.mock.calls.map(([request]) => request.clientRequestId))
        .toEqual([expectedRequestId, expectedRequestId]);
    },
  );
});

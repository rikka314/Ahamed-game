import type { EvaluationResultV1 } from "./evaluation.js";
import type { SharedErrorV1 } from "./errors.js";
import type { ClientTurnIdV1, EventIdV1, SessionIdV1, TestIdV1, TraceIdV1 } from "./ids.js";
import type { SafetyDecisionV1, SessionPhaseV1 } from "./sessions.js";
import type { TestResultV1 } from "./tests.js";
import type { TurnAcceptedV1, TurnCompletedV1 } from "./turns.js";

export const EVENT_TYPES_V1 = [
  "session.created", "session.state_changed", "turn.accepted", "action.classified", "patient.reply.delta",
  "patient.reply.completed", "test.accepted", "test.completed", "diagnosis.accepted", "evaluation.progress",
  "evaluation.completed", "safety.interrupted", "request.error",
] as const;
export type EventTypeV1 = (typeof EVENT_TYPES_V1)[number];

export type StreamEventEnvelopeV1<TType extends EventTypeV1, TPayload> = {
  contractVersion: "1";
  eventVersion: "1";
  eventId: EventIdV1;
  eventType: TType;
  sessionId: SessionIdV1;
  clientTurnId?: ClientTurnIdV1;
  sequence: number;
  emittedAt: string;
  traceId?: TraceIdV1;
  payload: TPayload;
};

export type PublicEventV1 =
  | StreamEventEnvelopeV1<"session.created", { sessionPhase: "created" | "active" }>
  | StreamEventEnvelopeV1<"session.state_changed", { from: SessionPhaseV1; to: SessionPhaseV1 }>
  | StreamEventEnvelopeV1<"turn.accepted", TurnAcceptedV1>
  | StreamEventEnvelopeV1<"action.classified", { action: "ask_patient" | "other" }>
  | StreamEventEnvelopeV1<"patient.reply.delta", { delta: string }>
  | StreamEventEnvelopeV1<"patient.reply.completed", TurnCompletedV1>
  | StreamEventEnvelopeV1<"test.accepted", { testId: TestIdV1 }>
  | StreamEventEnvelopeV1<"test.completed", TestResultV1>
  | StreamEventEnvelopeV1<"diagnosis.accepted", { submissionId: string; sessionPhase: "diagnosis_submitted" | "evaluating" }>
  | StreamEventEnvelopeV1<"evaluation.progress", { percent: number; stage: string }>
  | StreamEventEnvelopeV1<"evaluation.completed", EvaluationResultV1>
  | StreamEventEnvelopeV1<"safety.interrupted", { decision: Exclude<SafetyDecisionV1, "ALLOW_GAME">; templateId: string }>
  | StreamEventEnvelopeV1<"request.error", SharedErrorV1>;

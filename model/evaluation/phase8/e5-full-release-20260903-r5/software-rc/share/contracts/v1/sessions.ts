import type {
  ClientRequestIdV1,
  GameProfileIdV1,
  SessionIdV1,
  UserIdV1,
} from "./ids.js";

export const SESSION_PHASES_V1 = [
  "created",
  "active",
  "awaiting_model",
  "test_pending",
  "diagnosis_submitted",
  "evaluating",
  "completed",
  "expired",
  "cancelled",
  "failed",
] as const;
export type SessionPhaseV1 = (typeof SESSION_PHASES_V1)[number];

export const SAFETY_DECISIONS_V1 = [
  "ALLOW_GAME",
  "EXIT_SELF_HARM_CRISIS",
  "EXIT_URGENT_RED_FLAG",
  "EXIT_OUT_OF_SCOPE",
  "EXIT_REAL_HEALTH",
  "EXIT_FAIL_CLOSED",
] as const;
export type SafetyDecisionV1 = (typeof SAFETY_DECISIONS_V1)[number];

export const SESSION_TRANSITIONS_V1: Readonly<Record<SessionPhaseV1, readonly SessionPhaseV1[]>> = {
  created: ["active", "expired", "cancelled", "failed"],
  active: ["awaiting_model", "test_pending", "diagnosis_submitted", "expired", "cancelled", "failed"],
  awaiting_model: ["active", "expired", "failed"],
  test_pending: ["active", "expired", "failed"],
  diagnosis_submitted: ["evaluating", "expired", "failed"],
  evaluating: ["diagnosis_submitted", "completed", "expired", "failed"],
  completed: [],
  expired: [],
  cancelled: [],
  failed: [],
};

export function canTransitionSessionV1(from: SessionPhaseV1, to: SessionPhaseV1): boolean {
  return SESSION_TRANSITIONS_V1[from].includes(to);
}

export type SessionReferenceV1 = {
  contractVersion: "1";
  sessionId: SessionIdV1;
  userId?: UserIdV1;
  gameProfileId?: GameProfileIdV1;
  sessionPhase: SessionPhaseV1;
  createdAt: string;
  expiresAt: string;
};

export type CancelSessionRequestV1 = { clientRequestId: ClientRequestIdV1 };
export type CancelSessionResponseV1 = {
  sessionId: SessionIdV1;
  sessionPhase: "cancelled";
  cancelledAt: string;
};

import {
  canTransitionSessionV1,
  type SessionPhaseV1,
} from "@ahamed/doctor-game-share";

import { ModelServiceError } from "./errors.js";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_RETENTION_MS = 8 * 24 * 60 * 60 * 1000;

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export interface StoredDisclosedFact {
  factId: string;
  displayText: string;
  disclosedAtTurn: number;
}

export interface StoredTestResult {
  testId: string;
  status: "unavailable" | "completed";
  report?: string;
  assetId?: string;
  reasonCode?: string;
}

export type StoredTurnEffect =
  | { type: "test_completed"; result: StoredTestResult }
  | { type: "test_unavailable"; testId: string; reasonCode: string };

export type StoredPatientInteractionKind =
  | "medical_chat"
  | "social_chat"
  | "test_query"
  | "test_order";

export interface StoredTurn {
  turnId: string;
  clientTurnId: string;
  text: string;
  reply: string;
  disclosedFactIds: string[];
  action: "ask_patient" | "repeat" | "other";
  requestedFactIds: string[];
  interactionKind: StoredPatientInteractionKind;
  factIdsUsed: string[];
  personaFactIdsUsed: string[];
  completedTestIdsUsed: string[];
  effects: StoredTurnEffect[];
  turnNumber: number;
  createdAt: string;
}

export interface StoredDiagnosisSubmission {
  submissionId: string;
  fingerprint: string;
  primaryDiagnosis: string;
  differentials: string[];
  acceptedAt: string;
}

export interface SessionAggregate {
  sessionId: string;
  patientNpcId: string;
  userId?: string;
  publicCaseId: string;
  caseVersion: string;
  providerName: string;
  modelId: string;
  promptVersion: string;
  evaluationVersion: string;
  sessionPhase: SessionPhaseV1;
  turnCount: number;
  medicalTurnCount: number;
  repeatTurnCount: number;
  otherTurnCount: number;
  turnAttemptCount: number;
  consecutiveOffTopicTurns: number;
  pendingTestSuggestionId?: string;
  interactionKind?: StoredPatientInteractionKind;
  eventSequence: number;
  revision: number;
  createdAt: string;
  expiresAt: string;
  activeOperationId?: string;
  failureCode?: string;
  turns: StoredTurn[];
  disclosedFacts: StoredDisclosedFact[];
  completedTests: StoredTestResult[];
  diagnosisSubmission?: StoredDiagnosisSubmission;
  evaluation?: unknown;
}

export function createSessionAggregate(input: {
  sessionId: string;
  patientNpcId: string;
  userId?: string;
  publicCaseId: string;
  caseVersion: string;
  providerName?: string;
  modelId?: string;
  promptVersion?: string;
  evaluationVersion: string;
  now: Date;
}): SessionAggregate {
  const createdAt = input.now.toISOString();
  return {
    sessionId: input.sessionId,
    patientNpcId: input.patientNpcId,
    ...(input.userId === undefined ? {} : { userId: input.userId }),
    publicCaseId: input.publicCaseId,
    caseVersion: input.caseVersion,
    providerName: input.providerName ?? "deterministic",
    modelId: input.modelId ?? "deterministic-v1",
    promptVersion: input.promptVersion ?? "v0.1.0",
    evaluationVersion: input.evaluationVersion,
    sessionPhase: "created",
    turnCount: 0,
    medicalTurnCount: 0,
    repeatTurnCount: 0,
    otherTurnCount: 0,
    turnAttemptCount: 0,
    consecutiveOffTopicTurns: 0,
    eventSequence: 0,
    revision: 0,
    createdAt,
    expiresAt: new Date(input.now.getTime() + SESSION_TTL_MS).toISOString(),
    turns: [],
    disclosedFacts: [],
    completedTests: [],
  };
}

export function transitionSession(
  session: SessionAggregate,
  next: SessionPhaseV1,
): void {
  if (session.sessionPhase === next) {
    return;
  }
  if (!canTransitionSessionV1(session.sessionPhase, next)) {
    throw new ModelServiceError(
      "INVALID_SESSION_STATE",
      `Session cannot transition from ${session.sessionPhase} to ${next}.`,
    );
  }
  session.sessionPhase = next;
  session.revision += 1;
}

export function expireSessionIfNeeded(
  session: SessionAggregate,
  now: Date,
): boolean {
  if (
    session.sessionPhase === "completed" ||
    session.sessionPhase === "expired" ||
    session.sessionPhase === "cancelled" ||
    session.sessionPhase === "failed" ||
    now.getTime() < Date.parse(session.expiresAt)
  ) {
    return false;
  }
  transitionSession(session, "expired");
  return true;
}

export function assertSessionAcceptsWrites(session: SessionAggregate): void {
  if (session.sessionPhase === "expired") {
    throw new ModelServiceError("SESSION_EXPIRED", "Session has expired.");
  }
  if (session.sessionPhase === "cancelled") {
    throw new ModelServiceError("SESSION_CANCELLED", "Session was cancelled.");
  }
  if (session.sessionPhase !== "active") {
    throw new ModelServiceError(
      "INVALID_SESSION_STATE",
      "The session does not accept this action.",
    );
  }
}

import type { IdempotencyOperationV1 } from "@ahamed/doctor-game-share";

import type { SessionAggregate } from "../domain/session.js";
import type { ModelEvent } from "../observability/event-sink.js";

export type IdempotencyStatus =
  | "in_progress"
  | "committed"
  | "failed"
  | "recovery_required";

export interface IdempotencyRecord {
  scopeId: string;
  operation: IdempotencyOperationV1;
  idempotencyKey: string;
  requestHash: string;
  status: IdempotencyStatus;
  operationId?: string;
  response?: unknown;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  createdAt: string;
  retainUntil: string;
}

export type OperationKind = "turn" | "evaluation";
export type OperationStatus =
  | "prepared"
  | "dispatched"
  | "response_validated"
  | "committed"
  | "failed"
  | "unknown";

export interface ValidatedOperationBuffer {
  kind: "turn.v1" | "evaluation.v1";
  payload: unknown;
  sha256: string;
  hmacSha256?: string;
  validatedAt: string;
}

export interface OperationJournalRecord {
  operationId: string;
  sessionId: string;
  idempotencyKey: string;
  requestHash: string;
  kind: OperationKind;
  status: OperationStatus;
  request: unknown;
  attemptCount: number;
  providerName: string;
  modelId: string;
  promptVersion: string;
  caseVersion: string;
  createdAt: string;
  updatedAt: string;
  providerRequestId?: string;
  buffer?: ValidatedOperationBuffer;
  failureCode?: string;
  operator?: string;
  recoveryReason?: string;
  leaseToken?: string;
  leaseExpiresAt?: string;
}

export interface SessionRepository {
  get(sessionId: string): SessionAggregate | undefined;
  save(session: SessionAggregate): void;
  list(): SessionAggregate[];
}

export interface IdempotencyRepository {
  get(
    scopeId: string,
    operation: IdempotencyOperationV1,
    idempotencyKey: string,
  ): IdempotencyRecord | undefined;
  save(record: IdempotencyRecord): void;
  deleteExpired(now: Date): number;
}

export interface EventRepository {
  append(event: ModelEvent): void;
  list(sessionId: string): ModelEvent[];
}

export interface OperationRepository {
  get(operationId: string): OperationJournalRecord | undefined;
  save(operation: OperationJournalRecord): void;
  listRecoverable(): OperationJournalRecord[];
  listForSession(sessionId: string): OperationJournalRecord[];
}

export interface PersistenceTransaction {
  sessions: SessionRepository;
  idempotency: IdempotencyRepository;
  events: EventRepository;
  operations: OperationRepository;
}

export interface ModelPersistence {
  readonly requiresStableIntegrityKey: boolean;
  transaction<T>(work: (transaction: PersistenceTransaction) => T): T;
  purgeSensitiveData?(): void;
  close(): void;
}

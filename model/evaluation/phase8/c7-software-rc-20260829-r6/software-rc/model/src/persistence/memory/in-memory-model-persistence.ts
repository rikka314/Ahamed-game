import type { IdempotencyOperationV1 } from "@ahamed/doctor-game-share";

import type { SessionAggregate } from "../../domain/session.js";
import type { ModelEvent } from "../../observability/event-sink.js";
import type {
  IdempotencyRecord,
  ModelPersistence,
  OperationJournalRecord,
  PersistenceTransaction,
} from "../ports.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function cloneMap<T>(source: Map<string, T>): Map<string, T> {
  return new Map(
    Array.from(source, ([key, value]) => [key, clone(value)] as const),
  );
}

function idempotencyRecordKey(
  scopeId: string,
  operation: IdempotencyOperationV1,
  idempotencyKey: string,
): string {
  return JSON.stringify([scopeId, operation, idempotencyKey]);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" && value !== null) ||
    typeof value === "function"
  ) && typeof (value as { then?: unknown }).then === "function";
}

export class InMemoryModelPersistence implements ModelPersistence {
  readonly requiresStableIntegrityKey = false;
  private sessionsById = new Map<string, SessionAggregate>();
  private idempotencyByKey = new Map<string, IdempotencyRecord>();
  private eventsById = new Map<string, ModelEvent>();
  private operationsById = new Map<string, OperationJournalRecord>();
  private transactionActive = false;

  transaction<T>(work: (transaction: PersistenceTransaction) => T): T {
    if (this.transactionActive) {
      throw new Error("Nested persistence transactions are not supported.");
    }

    const snapshot = {
      sessionsById: cloneMap(this.sessionsById),
      idempotencyByKey: cloneMap(this.idempotencyByKey),
      eventsById: cloneMap(this.eventsById),
      operationsById: cloneMap(this.operationsById),
    };

    this.transactionActive = true;
    const lifetime = { active: true };
    try {
      const result = work(this.createTransaction(lifetime));
      if (isPromiseLike(result)) {
        void Promise.resolve(result).catch(() => undefined);
        throw new TypeError(
          "Persistence transactions require a synchronous callback; Promise results are not supported.",
        );
      }
      return result;
    } catch (error) {
      this.sessionsById = snapshot.sessionsById;
      this.idempotencyByKey = snapshot.idempotencyByKey;
      this.eventsById = snapshot.eventsById;
      this.operationsById = snapshot.operationsById;
      throw error;
    } finally {
      lifetime.active = false;
      this.transactionActive = false;
    }
  }

  close(): void {
    // No resources are owned by the in-memory adapter.
  }

  private createTransaction(lifetime: { active: boolean }): PersistenceTransaction {
    const assertActive = (): void => {
      if (!lifetime.active) {
        throw new Error("Persistence transaction is no longer active.");
      }
    };
    return {
      sessions: {
        get: (sessionId) => {
          assertActive();
          const session = this.sessionsById.get(sessionId);
          return session === undefined ? undefined : clone(session);
        },
        save: (session) => {
          assertActive();
          this.sessionsById.set(session.sessionId, clone(session));
        },
        list: () => {
          assertActive();
          return Array.from(this.sessionsById.values())
            .sort(
              (left, right) =>
                left.createdAt.localeCompare(right.createdAt) ||
                left.sessionId.localeCompare(right.sessionId),
            )
            .map(clone);
        },
      },
      idempotency: {
        get: (scopeId, operation, idempotencyKey) => {
          assertActive();
          const record = this.idempotencyByKey.get(
            idempotencyRecordKey(scopeId, operation, idempotencyKey),
          );
          return record === undefined ? undefined : clone(record);
        },
        save: (record) => {
          assertActive();
          this.idempotencyByKey.set(
            idempotencyRecordKey(
              record.scopeId,
              record.operation,
              record.idempotencyKey,
            ),
            clone(record),
          );
        },
        deleteExpired: (now) => {
          assertActive();
          let deleted = 0;
          for (const [key, record] of this.idempotencyByKey) {
            if (Date.parse(record.retainUntil) <= now.getTime()) {
              this.idempotencyByKey.delete(key);
              deleted += 1;
            }
          }
          return deleted;
        },
      },
      events: {
        append: (event) => {
          assertActive();
          this.eventsById.set(event.eventId, clone(event));
        },
        list: (sessionId) => {
          assertActive();
          return Array.from(this.eventsById.values())
            .filter((event) => event.sessionId === sessionId)
            .sort((left, right) => left.sequence - right.sequence)
            .map(clone);
        },
      },
      operations: {
        get: (operationId) => {
          assertActive();
          const record = this.operationsById.get(operationId);
          return record === undefined ? undefined : clone(record);
        },
        save: (record) => {
          assertActive();
          this.operationsById.set(record.operationId, clone(record));
        },
        listRecoverable: () => {
          assertActive();
          return Array.from(this.operationsById.values())
            .filter(
              (record) =>
                record.status !== "committed" && record.status !== "failed",
            )
            .sort(
              (left, right) =>
                left.createdAt.localeCompare(right.createdAt) ||
                left.operationId.localeCompare(right.operationId),
            )
            .map(clone);
        },
        listForSession: (sessionId) => {
          assertActive();
          return Array.from(this.operationsById.values())
            .filter((record) => record.sessionId === sessionId)
            .sort(
              (left, right) =>
                left.createdAt.localeCompare(right.createdAt) ||
                left.operationId.localeCompare(right.operationId),
            )
            .map(clone);
        },
      },
    };
  }
}

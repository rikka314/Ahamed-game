import { DatabaseSync } from "node:sqlite";

import {
  IDEMPOTENCY_OPERATIONS_V1,
  SESSION_PHASES_V1,
} from "@ahamed/doctor-game-share";

import type {
  SessionAggregate,
  StoredDiagnosisSubmission,
  StoredDisclosedFact,
  StoredTestResult,
  StoredTurn,
  StoredTurnEffect,
} from "../../domain/session.js";
import type { ModelEvent } from "../../observability/event-sink.js";
import type {
  IdempotencyRecord,
  ModelPersistence,
  OperationJournalRecord,
  PersistenceTransaction,
  ValidatedOperationBuffer,
} from "../ports.js";
import { applySqliteMigrations } from "./migrations.js";

type SqliteRow = Record<string, unknown>;

export interface SqliteModelPersistenceOptions {
  busyTimeoutMs?: number;
  readOnly?: boolean;
}

function encodeJson(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}

function decodeJson(value: unknown, column: string): unknown {
  if (typeof value !== "string") {
    throw new Error(`Expected ${column} to be a persisted JSON string.`);
  }
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(`Expected ${column} to contain valid JSON.`, {
      cause: error,
    });
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeJsonObject(value: unknown, column: string): Record<string, unknown> {
  const decoded = decodeJson(value, column);
  if (!isJsonObject(decoded)) {
    throw new Error(`Expected ${column} to contain a JSON object.`);
  }
  return decoded;
}

function decodeStringArray(value: unknown, column: string): string[] {
  const decoded = decodeJson(value, column);
  if (!Array.isArray(decoded) || !decoded.every((entry) => typeof entry === "string")) {
    throw new Error(`Expected ${column} to contain an array of strings.`);
  }
  return decoded;
}

function hasExactObjectKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function decodeTurnEffects(value: unknown): StoredTurnEffect[] {
  const decoded = decodeJson(value, "effects_json");
  if (!Array.isArray(decoded)) {
    throw new Error("Expected effects_json to contain an array of turn effects.");
  }
  return decoded.map((effect): StoredTurnEffect => {
    if (!isJsonObject(effect) || typeof effect.type !== "string") {
      throw new Error("Expected effects_json to contain valid turn effects.");
    }
    if (effect.type === "test_unavailable") {
      if (
        !hasExactObjectKeys(effect, ["type", "testId", "reasonCode"]) ||
        typeof effect.testId !== "string" ||
        typeof effect.reasonCode !== "string" ||
        effect.reasonCode.trim().length === 0
      ) {
        throw new Error("Expected effects_json to contain valid turn effects.");
      }
      return {
        type: "test_unavailable",
        testId: effect.testId,
        reasonCode: effect.reasonCode,
      };
    }
    if (
      effect.type !== "test_completed" ||
      !hasExactObjectKeys(effect, ["type", "result"]) ||
      !isJsonObject(effect.result) ||
      !hasExactObjectKeys(
        effect.result,
        ["testId", "status"],
        ["report", "assetId", "reasonCode"],
      ) ||
      typeof effect.result.testId !== "string" ||
      effect.result.status !== "completed" ||
      (effect.result.report !== undefined &&
        typeof effect.result.report !== "string") ||
      (effect.result.assetId !== undefined &&
        typeof effect.result.assetId !== "string") ||
      (effect.result.reasonCode !== undefined &&
        typeof effect.result.reasonCode !== "string")
    ) {
      throw new Error("Expected effects_json to contain valid turn effects.");
    }
    return {
      type: "test_completed",
      result: {
        testId: effect.result.testId,
        status: "completed",
        ...(effect.result.report === undefined
          ? {}
          : { report: effect.result.report }),
        ...(effect.result.assetId === undefined
          ? {}
          : { assetId: effect.result.assetId }),
        ...(effect.result.reasonCode === undefined
          ? {}
          : { reasonCode: effect.result.reasonCode }),
      },
    };
  });
}

function requiredString(row: SqliteRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`Expected ${column} to be a string.`);
  }
  return value;
}

function optionalString(row: SqliteRow, column: string): string | undefined {
  const value = row[column];
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Expected ${column} to be a nullable string.`);
  }
  return value;
}

function requiredNumber(row: SqliteRow, column: string): number {
  const value = row[column];
  if (typeof value !== "number") {
    throw new Error(`Expected ${column} to be a number.`);
  }
  return value;
}

function requiredNonNegativeInteger(row: SqliteRow, column: string): number {
  const value = requiredNumber(row, column);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Expected ${column} to be a non-negative safe integer.`);
  }
  return value;
}

function assertValidDate(value: string, column: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`Expected ${column} to be a valid date string.`);
  }
  return value;
}

function requiredDateString(row: SqliteRow, column: string): string {
  return assertValidDate(requiredString(row, column), column);
}

function optionalDateString(row: SqliteRow, column: string): string | undefined {
  const value = optionalString(row, column);
  return value === undefined ? undefined : assertValidDate(value, column);
}

function requiredEnum<const T extends readonly string[]>(
  row: SqliteRow,
  column: string,
  values: T,
): T[number] {
  const value = requiredString(row, column);
  if (!(values as readonly string[]).includes(value)) {
    throw new Error(
      `Expected ${column} to be one of the allowed values: ${values.join(", ")}.`,
    );
  }
  return value as T[number];
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    ((typeof value === "object" && value !== null) || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

const IDEMPOTENCY_STATUSES = [
  "in_progress",
  "committed",
  "failed",
  "recovery_required",
] as const;
const OPERATION_KINDS = ["turn", "evaluation"] as const;
const OPERATION_STATUSES = [
  "prepared",
  "dispatched",
  "response_validated",
  "committed",
  "failed",
  "unknown",
] as const;
const TEST_STATUSES = ["unavailable", "completed"] as const;
const PATIENT_INTERACTION_KINDS = [
  "medical_chat",
  "social_chat",
  "test_query",
  "test_order",
] as const;
const BUFFER_KINDS = ["turn.v1", "evaluation.v1"] as const;

function decodeValidatedBuffer(value: unknown): ValidatedOperationBuffer {
  const decoded = decodeJsonObject(value, "buffer_json");
  const kind = decoded.kind;
  const sha256 = decoded.sha256;
  const hmacSha256 = decoded.hmacSha256;
  const validatedAt = decoded.validatedAt;
  if (
    typeof kind !== "string" ||
    !(BUFFER_KINDS as readonly string[]).includes(kind) ||
    !Object.hasOwn(decoded, "payload") ||
    !isJsonObject(decoded.payload) ||
    typeof sha256 !== "string" ||
    (hmacSha256 !== undefined && typeof hmacSha256 !== "string") ||
    typeof validatedAt !== "string" ||
    !Number.isFinite(Date.parse(validatedAt))
  ) {
    throw new Error(
      "Expected buffer_json to contain a valid validated operation buffer.",
    );
  }
  return {
    kind: kind as ValidatedOperationBuffer["kind"],
    payload: decoded.payload,
    sha256,
    ...(hmacSha256 === undefined ? {} : { hmacSha256 }),
    validatedAt,
  };
}

function asRow(row: Record<string, unknown> | undefined): SqliteRow | undefined {
  return row;
}

export class SqliteModelPersistence implements ModelPersistence {
  readonly requiresStableIntegrityKey = true;
  private readonly database: DatabaseSync;
  private readonly readOnly: boolean;
  private transactionActive = false;

  constructor(
    path: string,
    options: SqliteModelPersistenceOptions = {},
  ) {
    const busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
    if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
      throw new RangeError("busyTimeoutMs must be a non-negative safe integer.");
    }
    this.readOnly = options.readOnly ?? false;
    const database = new DatabaseSync(path, {
      enableForeignKeyConstraints: true,
      timeout: busyTimeoutMs,
      readOnly: this.readOnly,
    });
    try {
      database.exec("PRAGMA foreign_keys = ON");
      database.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
      if (this.readOnly) {
        database.exec("PRAGMA query_only = ON");
      } else {
        database.exec("PRAGMA journal_mode = WAL");
        database.exec("PRAGMA synchronous = FULL");
        database.exec("PRAGMA secure_delete = ON");
        applySqliteMigrations(database);
      }
    } catch (error) {
      database.close();
      throw error;
    }
    this.database = database;
  }

  transaction<T>(work: (transaction: PersistenceTransaction) => T): T {
    if (this.transactionActive || this.database.isTransaction) {
      throw new Error("Nested persistence transactions are not supported.");
    }

    this.database.exec(this.readOnly ? "BEGIN" : "BEGIN IMMEDIATE");
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
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    } finally {
      lifetime.active = false;
      this.transactionActive = false;
    }
  }

  close(): void {
    if (this.database.isOpen) {
      this.database.close();
    }
  }

  purgeSensitiveData(): void {
    if (this.readOnly) {
      throw new Error("Read-only persistence cannot purge sensitive data.");
    }
    if (this.transactionActive || this.database.isTransaction) {
      throw new Error("Sensitive-data purge requires a committed transaction.");
    }
    this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.database.exec("VACUUM");
    this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
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
          return this.getSession(sessionId);
        },
        save: (session) => {
          assertActive();
          this.saveSession(session);
        },
        list: () => {
          assertActive();
          return this.database
            .prepare("SELECT session_id FROM sessions ORDER BY created_at, session_id")
            .all()
            .map((row) => this.getSession(requiredString(row, "session_id")))
            .filter((session): session is SessionAggregate => session !== undefined);
        },
      },
      idempotency: {
        get: (scopeId, operation, idempotencyKey) => {
          assertActive();
          const row = asRow(
            this.database
              .prepare(
                `SELECT * FROM idempotency_records
                 WHERE scope_id = ? AND operation = ? AND idempotency_key = ?`,
              )
              .get(scopeId, operation, idempotencyKey),
          );
          return row === undefined ? undefined : this.rowToIdempotency(row);
        },
        save: (record) => {
          assertActive();
          this.saveIdempotency(record);
        },
        deleteExpired: (now) => {
          assertActive();
          const result = this.database
            .prepare("DELETE FROM idempotency_records WHERE retain_until <= ?")
            .run(now.toISOString());
          return Number(result.changes);
        },
      },
      events: {
        append: (event) => {
          assertActive();
          this.appendEvent(event);
        },
        list: (sessionId) => {
          assertActive();
          return this.database
            .prepare(
              "SELECT * FROM audit_events WHERE session_id = ? ORDER BY sequence",
            )
            .all(sessionId)
            .map((row) => this.rowToEvent(row));
        },
      },
      operations: {
        get: (operationId) => {
          assertActive();
          const row = asRow(
            this.database
              .prepare("SELECT * FROM operation_journal WHERE operation_id = ?")
              .get(operationId),
          );
          return row === undefined ? undefined : this.rowToOperation(row);
        },
        save: (record) => {
          assertActive();
          this.saveOperation(record);
        },
        listRecoverable: () => {
          assertActive();
          return this.database
            .prepare(
              `SELECT * FROM operation_journal
               WHERE status NOT IN ('committed', 'failed')
               ORDER BY created_at, operation_id`,
            )
            .all()
            .map((row) => this.rowToOperation(row));
        },
        listForSession: (sessionId) => {
          assertActive();
          return this.database
            .prepare(
              `SELECT * FROM operation_journal
               WHERE session_id = ? ORDER BY created_at, operation_id`,
            )
            .all(sessionId)
            .map((row) => this.rowToOperation(row));
        },
      },
    };
  }

  private getSession(sessionId: string): SessionAggregate | undefined {
    const row = asRow(
      this.database
        .prepare("SELECT * FROM sessions WHERE session_id = ?")
        .get(sessionId),
    );
    if (row === undefined) {
      return undefined;
    }

    const turns = this.database
      .prepare("SELECT * FROM turns WHERE session_id = ? ORDER BY turn_number")
      .all(sessionId)
      .map((turnRow): StoredTurn => ({
        turnId: requiredString(turnRow, "turn_id"),
        clientTurnId: requiredString(turnRow, "client_turn_id"),
        text: requiredString(turnRow, "text"),
        reply: requiredString(turnRow, "reply"),
        disclosedFactIds: decodeStringArray(
          turnRow.disclosed_fact_ids_json,
          "disclosed_fact_ids_json",
        ),
        action: requiredEnum(turnRow, "action", [
          "ask_patient",
          "repeat",
          "other",
        ] as const),
        requestedFactIds: decodeStringArray(
          turnRow.requested_fact_ids_json,
          "requested_fact_ids_json",
        ),
        interactionKind: requiredEnum(
          turnRow,
          "interaction_kind",
          PATIENT_INTERACTION_KINDS,
        ),
        factIdsUsed: decodeStringArray(
          turnRow.fact_ids_used_json,
          "fact_ids_used_json",
        ),
        personaFactIdsUsed: decodeStringArray(
          turnRow.persona_fact_ids_used_json,
          "persona_fact_ids_used_json",
        ),
        completedTestIdsUsed: decodeStringArray(
          turnRow.completed_test_ids_used_json,
          "completed_test_ids_used_json",
        ),
        effects: decodeTurnEffects(turnRow.effects_json),
        turnNumber: requiredNonNegativeInteger(turnRow, "turn_number"),
        createdAt: requiredDateString(turnRow, "created_at"),
      }));
    const disclosedFacts = this.database
      .prepare(
        `SELECT * FROM disclosed_facts
         WHERE session_id = ? ORDER BY ordinal`,
      )
      .all(sessionId)
      .map((factRow): StoredDisclosedFact => {
        requiredNonNegativeInteger(factRow, "ordinal");
        return {
          factId: requiredString(factRow, "fact_id"),
          displayText: requiredString(factRow, "display_text"),
          disclosedAtTurn: requiredNonNegativeInteger(
            factRow,
            "disclosed_at_turn",
          ),
        };
      });
    const completedTests = this.database
      .prepare("SELECT * FROM completed_tests WHERE session_id = ? ORDER BY ordinal")
      .all(sessionId)
      .map((testRow): StoredTestResult => {
        requiredNonNegativeInteger(testRow, "ordinal");
        const test: StoredTestResult = {
          testId: requiredString(testRow, "test_id"),
          status: requiredEnum(testRow, "status", TEST_STATUSES),
        };
        const report = optionalString(testRow, "report");
        const assetId = optionalString(testRow, "asset_id");
        const reasonCode = optionalString(testRow, "reason_code");
        if (report !== undefined) test.report = report;
        if (assetId !== undefined) test.assetId = assetId;
        if (reasonCode !== undefined) test.reasonCode = reasonCode;
        return test;
      });

    const aggregate: SessionAggregate = {
      sessionId: requiredString(row, "session_id"),
      patientNpcId: requiredString(row, "patient_npc_id"),
      publicCaseId: requiredString(row, "public_case_id"),
      caseVersion: requiredString(row, "case_version"),
      providerName: requiredString(row, "provider_name"),
      modelId: requiredString(row, "model_id"),
      promptVersion: requiredString(row, "prompt_version"),
      evaluationVersion: requiredString(row, "evaluation_version"),
      sessionPhase: requiredEnum(row, "session_phase", SESSION_PHASES_V1),
      turnCount: requiredNonNegativeInteger(row, "turn_count"),
      medicalTurnCount: requiredNonNegativeInteger(row, "medical_turn_count"),
      repeatTurnCount: requiredNonNegativeInteger(row, "repeat_turn_count"),
      otherTurnCount: requiredNonNegativeInteger(row, "other_turn_count"),
      turnAttemptCount: requiredNonNegativeInteger(row, "turn_attempt_count"),
      consecutiveOffTopicTurns: requiredNonNegativeInteger(
        row,
        "consecutive_off_topic_turns",
      ),
      eventSequence: requiredNonNegativeInteger(row, "event_sequence"),
      revision: requiredNonNegativeInteger(row, "revision"),
      createdAt: requiredDateString(row, "created_at"),
      expiresAt: requiredDateString(row, "expires_at"),
      turns,
      disclosedFacts,
      completedTests,
    };

    const userId = optionalString(row, "user_id");
    const activeOperationId = optionalString(row, "active_operation_id");
    const failureCode = optionalString(row, "failure_code");
    const pendingTestSuggestionId = optionalString(
      row,
      "pending_test_suggestion_id",
    );
    const interactionKind = optionalString(row, "interaction_kind");
    if (userId !== undefined) aggregate.userId = userId;
    if (activeOperationId !== undefined) aggregate.activeOperationId = activeOperationId;
    if (failureCode !== undefined) aggregate.failureCode = failureCode;
    if (pendingTestSuggestionId !== undefined) {
      aggregate.pendingTestSuggestionId = pendingTestSuggestionId;
    }
    if (interactionKind !== undefined) {
      if (!(PATIENT_INTERACTION_KINDS as readonly string[]).includes(interactionKind)) {
        throw new Error(
          "Expected interaction_kind to be one of the allowed values.",
        );
      }
      aggregate.interactionKind = interactionKind as NonNullable<
        typeof aggregate.interactionKind
      >;
    }

    const diagnosisRow = asRow(
      this.database
        .prepare("SELECT * FROM diagnosis_submissions WHERE session_id = ?")
        .get(sessionId),
    );
    if (diagnosisRow !== undefined) {
      aggregate.diagnosisSubmission = this.rowToDiagnosis(diagnosisRow);
    }

    const evaluationRow = asRow(
      this.database
        .prepare("SELECT evaluation_json FROM evaluations WHERE session_id = ?")
        .get(sessionId),
    );
    if (evaluationRow !== undefined) {
      aggregate.evaluation = decodeJsonObject(
        evaluationRow.evaluation_json,
        "evaluation_json",
      );
    }

    return structuredClone(aggregate);
  }

  private saveSession(session: SessionAggregate): void {
    const stored = structuredClone(session);
    this.database
      .prepare(
        `INSERT INTO sessions (
          session_id, patient_npc_id, user_id, public_case_id, case_version,
          provider_name, model_id, prompt_version, evaluation_version,
          session_phase, turn_count, medical_turn_count, repeat_turn_count,
          other_turn_count, turn_attempt_count, consecutive_off_topic_turns,
          pending_test_suggestion_id, interaction_kind, event_sequence,
          revision, created_at, expires_at, active_operation_id, failure_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          patient_npc_id = excluded.patient_npc_id,
          user_id = excluded.user_id,
          public_case_id = excluded.public_case_id,
          case_version = excluded.case_version,
          provider_name = excluded.provider_name,
          model_id = excluded.model_id,
          prompt_version = excluded.prompt_version,
          evaluation_version = excluded.evaluation_version,
          session_phase = excluded.session_phase,
          turn_count = excluded.turn_count,
          medical_turn_count = excluded.medical_turn_count,
          repeat_turn_count = excluded.repeat_turn_count,
          other_turn_count = excluded.other_turn_count,
          turn_attempt_count = excluded.turn_attempt_count,
          consecutive_off_topic_turns = excluded.consecutive_off_topic_turns,
          pending_test_suggestion_id = excluded.pending_test_suggestion_id,
          interaction_kind = excluded.interaction_kind,
          event_sequence = excluded.event_sequence,
          revision = excluded.revision,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at,
          active_operation_id = excluded.active_operation_id,
          failure_code = excluded.failure_code`,
      )
      .run(
        stored.sessionId,
        stored.patientNpcId,
        stored.userId ?? null,
        stored.publicCaseId,
        stored.caseVersion,
        stored.providerName,
        stored.modelId,
        stored.promptVersion,
        stored.evaluationVersion,
        stored.sessionPhase,
        stored.turnCount,
        stored.medicalTurnCount,
        stored.repeatTurnCount,
        stored.otherTurnCount,
        stored.turnAttemptCount,
        stored.consecutiveOffTopicTurns,
        stored.pendingTestSuggestionId ?? null,
        stored.interactionKind ?? null,
        stored.eventSequence,
        stored.revision,
        stored.createdAt,
        stored.expiresAt,
        stored.activeOperationId ?? null,
        stored.failureCode ?? null,
      );

    for (const table of [
      "turns",
      "disclosed_facts",
      "completed_tests",
      "diagnosis_submissions",
      "evaluations",
    ]) {
      this.database.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(stored.sessionId);
    }

    const insertTurn = this.database.prepare(
      `INSERT INTO turns (
        turn_id, session_id, client_turn_id, text, reply,
        disclosed_fact_ids_json, action, requested_fact_ids_json,
        interaction_kind, fact_ids_used_json, persona_fact_ids_used_json,
        completed_test_ids_used_json, effects_json, turn_number, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const turn of stored.turns) {
      insertTurn.run(
        turn.turnId,
        stored.sessionId,
        turn.clientTurnId,
        turn.text,
        turn.reply,
        encodeJson(turn.disclosedFactIds),
        turn.action,
        encodeJson(turn.requestedFactIds),
        turn.interactionKind,
        encodeJson(turn.factIdsUsed),
        encodeJson(turn.personaFactIdsUsed),
        encodeJson(turn.completedTestIdsUsed),
        encodeJson(turn.effects),
        turn.turnNumber,
        turn.createdAt,
      );
    }

    const insertFact = this.database.prepare(
      `INSERT INTO disclosed_facts
       (session_id, fact_id, display_text, disclosed_at_turn, ordinal)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const [ordinal, fact] of stored.disclosedFacts.entries()) {
      insertFact.run(
        stored.sessionId,
        fact.factId,
        fact.displayText,
        fact.disclosedAtTurn,
        ordinal,
      );
    }

    const insertTest = this.database.prepare(
      `INSERT INTO completed_tests
       (session_id, test_id, status, report, asset_id, reason_code, ordinal)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [ordinal, test] of stored.completedTests.entries()) {
      insertTest.run(
        stored.sessionId,
        test.testId,
        test.status,
        test.report ?? null,
        test.assetId ?? null,
        test.reasonCode ?? null,
        ordinal,
      );
    }

    if (stored.diagnosisSubmission !== undefined) {
      const diagnosis = stored.diagnosisSubmission;
      this.database
        .prepare(
          `INSERT INTO diagnosis_submissions
           (submission_id, session_id, fingerprint, primary_diagnosis,
            differentials_json, accepted_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          diagnosis.submissionId,
          stored.sessionId,
          diagnosis.fingerprint,
          diagnosis.primaryDiagnosis,
          encodeJson(diagnosis.differentials),
          diagnosis.acceptedAt,
        );
    }

    if (stored.evaluation !== undefined) {
      this.database
        .prepare(
          "INSERT INTO evaluations (session_id, evaluation_json) VALUES (?, ?)",
        )
        .run(stored.sessionId, encodeJson(stored.evaluation));
    }
  }

  private rowToDiagnosis(row: SqliteRow): StoredDiagnosisSubmission {
    return {
      submissionId: requiredString(row, "submission_id"),
      fingerprint: requiredString(row, "fingerprint"),
      primaryDiagnosis: requiredString(row, "primary_diagnosis"),
      differentials: decodeStringArray(
        row.differentials_json,
        "differentials_json",
      ),
      acceptedAt: requiredDateString(row, "accepted_at"),
    };
  }

  private rowToIdempotency(row: SqliteRow): IdempotencyRecord {
    const record: IdempotencyRecord = {
      scopeId: requiredString(row, "scope_id"),
      operation: requiredEnum(
        row,
        "operation",
        IDEMPOTENCY_OPERATIONS_V1,
      ),
      idempotencyKey: requiredString(row, "idempotency_key"),
      requestHash: requiredString(row, "request_hash"),
      status: requiredEnum(row, "status", IDEMPOTENCY_STATUSES),
      createdAt: requiredDateString(row, "created_at"),
      retainUntil: requiredDateString(row, "retain_until"),
    };
    const operationId = optionalString(row, "operation_id");
    if (operationId !== undefined) record.operationId = operationId;
    if (row.response_json !== null && row.response_json !== undefined) {
      record.response = decodeJsonObject(row.response_json, "response_json");
    }
    if (row.error_json !== null && row.error_json !== undefined) {
      const decoded = decodeJsonObject(row.error_json, "error_json");
      if (
        typeof decoded.code !== "string" ||
        typeof decoded.message !== "string" ||
        typeof decoded.retryable !== "boolean"
      ) {
        throw new Error("Expected error_json to contain a valid error object.");
      }
      record.error = {
        code: decoded.code,
        message: decoded.message,
        retryable: decoded.retryable,
      };
    }
    return structuredClone(record);
  }

  private saveIdempotency(record: IdempotencyRecord): void {
    const stored = structuredClone(record);
    this.database
      .prepare(
        `INSERT INTO idempotency_records (
          scope_id, operation, idempotency_key, request_hash, status,
          operation_id, response_json, error_json, created_at, retain_until
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(scope_id, operation, idempotency_key) DO UPDATE SET
          request_hash = excluded.request_hash,
          status = excluded.status,
          operation_id = excluded.operation_id,
          response_json = excluded.response_json,
          error_json = excluded.error_json,
          created_at = excluded.created_at,
          retain_until = excluded.retain_until`,
      )
      .run(
        stored.scopeId,
        stored.operation,
        stored.idempotencyKey,
        stored.requestHash,
        stored.status,
        stored.operationId ?? null,
        stored.response === undefined ? null : encodeJson(stored.response),
        stored.error === undefined ? null : encodeJson(stored.error),
        stored.createdAt,
        stored.retainUntil,
      );
  }

  private rowToEvent(row: SqliteRow): ModelEvent {
    return structuredClone({
      eventId: requiredString(row, "event_id"),
      eventType: requiredString(row, "event_type"),
      sessionId: requiredString(row, "session_id"),
      sequence: requiredNonNegativeInteger(row, "sequence"),
      emittedAt: requiredDateString(row, "emitted_at"),
      payload: decodeJsonObject(row.payload_json, "payload_json"),
    });
  }

  private appendEvent(event: ModelEvent): void {
    const stored = structuredClone(event);
    this.database
      .prepare(
        `INSERT INTO audit_events
         (event_id, event_type, session_id, sequence, emitted_at, payload_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        stored.eventId,
        stored.eventType,
        stored.sessionId,
        stored.sequence,
        stored.emittedAt,
        encodeJson(stored.payload),
      );
  }

  private rowToOperation(row: SqliteRow): OperationJournalRecord {
    const record: OperationJournalRecord = {
      operationId: requiredString(row, "operation_id"),
      sessionId: requiredString(row, "session_id"),
      idempotencyKey: requiredString(row, "idempotency_key"),
      requestHash: requiredString(row, "request_hash"),
      kind: requiredEnum(row, "kind", OPERATION_KINDS),
      status: requiredEnum(row, "status", OPERATION_STATUSES),
      request: decodeJsonObject(row.request_json, "request_json"),
      attemptCount: requiredNonNegativeInteger(row, "attempt_count"),
      providerName: requiredString(row, "provider_name"),
      modelId: requiredString(row, "model_id"),
      promptVersion: requiredString(row, "prompt_version"),
      caseVersion: requiredString(row, "case_version"),
      createdAt: requiredDateString(row, "created_at"),
      updatedAt: requiredDateString(row, "updated_at"),
    };
    const providerRequestId = optionalString(row, "provider_request_id");
    const failureCode = optionalString(row, "failure_code");
    const operator = optionalString(row, "operator");
    const recoveryReason = optionalString(row, "recovery_reason");
    const leaseToken = optionalString(row, "lease_token");
    const leaseExpiresAt = optionalDateString(row, "lease_expires_at");
    if (providerRequestId !== undefined) record.providerRequestId = providerRequestId;
    if (row.buffer_json !== null && row.buffer_json !== undefined) {
      record.buffer = decodeValidatedBuffer(row.buffer_json);
    }
    if (failureCode !== undefined) record.failureCode = failureCode;
    if (operator !== undefined) record.operator = operator;
    if (recoveryReason !== undefined) record.recoveryReason = recoveryReason;
    if (leaseToken !== undefined) record.leaseToken = leaseToken;
    if (leaseExpiresAt !== undefined) record.leaseExpiresAt = leaseExpiresAt;
    return structuredClone(record);
  }

  private saveOperation(record: OperationJournalRecord): void {
    const stored = structuredClone(record);
    this.database
      .prepare(
        `INSERT INTO operation_journal (
          operation_id, session_id, idempotency_key, request_hash, kind, status,
          request_json, attempt_count, provider_name, model_id, prompt_version,
          case_version, created_at, updated_at, provider_request_id, buffer_json,
          failure_code, operator, recovery_reason, lease_token, lease_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(operation_id) DO UPDATE SET
          session_id = excluded.session_id,
          idempotency_key = excluded.idempotency_key,
          request_hash = excluded.request_hash,
          kind = excluded.kind,
          status = excluded.status,
          request_json = excluded.request_json,
          attempt_count = excluded.attempt_count,
          provider_name = excluded.provider_name,
          model_id = excluded.model_id,
          prompt_version = excluded.prompt_version,
          case_version = excluded.case_version,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          provider_request_id = excluded.provider_request_id,
          buffer_json = excluded.buffer_json,
          failure_code = excluded.failure_code,
          operator = excluded.operator,
          recovery_reason = excluded.recovery_reason,
          lease_token = excluded.lease_token,
          lease_expires_at = excluded.lease_expires_at`,
      )
      .run(
        stored.operationId,
        stored.sessionId,
        stored.idempotencyKey,
        stored.requestHash,
        stored.kind,
        stored.status,
        encodeJson(stored.request),
        stored.attemptCount,
        stored.providerName,
        stored.modelId,
        stored.promptVersion,
        stored.caseVersion,
        stored.createdAt,
        stored.updatedAt,
        stored.providerRequestId ?? null,
        stored.buffer === undefined ? null : encodeJson(stored.buffer),
        stored.failureCode ?? null,
        stored.operator ?? null,
        stored.recoveryReason ?? null,
        stored.leaseToken ?? null,
        stored.leaseExpiresAt ?? null,
      );
  }
}

export { SqliteModelPersistence as SQLiteModelPersistence };

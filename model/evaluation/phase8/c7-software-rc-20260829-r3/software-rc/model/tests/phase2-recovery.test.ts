import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { createRequestFingerprintMaterialV1 } from "@ahamed/doctor-game-share";

import { createSqliteModelService as createSqliteModelServiceWithKey } from "../src/application/create-sqlite-model-service.js";
import {
  operationBufferHmacSha256V1,
  operationBufferSha256V1,
} from "../src/application/operation-buffer-integrity.js";
import { encryptTurnOperationRequestV1 } from "../src/application/turn-request-crypto.js";
import { ModelServiceError } from "../src/domain/errors.js";
import { runOpsCli } from "../src/ops/runner.js";
import { evaluateDeterministically } from "../src/evaluation/deterministic-evaluator.js";
import {
  createSessionAggregate,
  transitionSession,
  type SessionAggregate,
} from "../src/domain/session.js";
import { SqliteModelPersistence } from "../src/persistence/sqlite/sqlite-model-persistence.js";
import type {
  IdempotencyRecord,
  OperationJournalRecord,
  PersistenceTransaction,
} from "../src/persistence/ports.js";
import type { ModelProvider } from "../src/providers/model-provider.js";
import { createCaseFixture } from "./fixtures/case-fixture.js";

const NOW = new Date("2026-08-02T00:00:00.000Z");
const CREATED_AT = new Date("2026-08-01T00:00:00.000Z");
const TEST_SAFETY_AUDIT_HMAC_KEY =
  "phase7-test-only-stable-hmac-key-000000000000";
const closeablesByTest = new WeakMap<
  TestContext,
  Array<{ close(): void }>
>();

type SqliteServiceOptions = Parameters<typeof createSqliteModelServiceWithKey>[0];

function createSqliteModelService(
  options: Omit<SqliteServiceOptions, "safetyAuditHmacKey">,
) {
  return createSqliteModelServiceWithKey({
    ...options,
    safetyAuditHmacKey: TEST_SAFETY_AUDIT_HMAC_KEY,
  });
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function signedBuffer(
  operation: OperationJournalRecord,
  kind: "turn.v1" | "evaluation.v1",
  payload: Record<string, unknown>,
  validatedAt = CREATED_AT.toISOString(),
) {
  const unsigned = {
    kind,
    payload,
    sha256: operationBufferSha256V1(payload),
    validatedAt,
  };
  return {
    ...unsigned,
    hmacSha256: operationBufferHmacSha256V1(
      operation,
      unsigned,
      TEST_SAFETY_AUDIT_HMAC_KEY,
    ),
  };
}

function requestFingerprint(
  operation: "submit_turn" | "submit_diagnosis",
  sessionId: string,
  payload: unknown,
): string {
  return createHash("sha256")
    .update(createRequestFingerprintMaterialV1(operation, sessionId, payload))
    .digest("hex");
}

function safetyRequestFingerprint(
  operation: "submit_turn",
  sessionId: string,
  payload: unknown,
): string {
  return `hmac-sha256:${createHmac(
    "sha256",
    TEST_SAFETY_AUDIT_HMAC_KEY,
  )
    .update(createRequestFingerprintMaterialV1(operation, sessionId, payload))
    .digest("hex")}`;
}

function createCountingProvider(counter: { calls: number }): ModelProvider {
  return {
    identity: {
      providerName: "deterministic",
      modelId: "deterministic-v1",
      promptVersion: "v0.1.0",
    },
    async classifyTurn() {
      counter.calls += 1;
      return { action: "ask_patient", requestedFactIds: ["fact.onset"] };
    },
    async generatePatientReply(input) {
      counter.calls += 1;
      const normalized = input.userText.toLocaleLowerCase("en-US");
      const facts = input.safeCaseView.facts.filter((fact) =>
        fact.questionMatchers.some((matcher) =>
          normalized.includes(matcher.toLocaleLowerCase("en-US")),
        ),
      );
      return {
        reply: facts.map(({ value }) => value).join(" ") || "I do not know.",
        interactionKind: "medical_chat",
        factIdsUsed: facts.map(({ factId }) => factId),
        personaFactIdsUsed: [],
        completedTestIdsUsed: [],
        newFactsClaimed: [],
        diagnosisLeak: false,
      };
    },
    async evaluate() {
      counter.calls += 1;
      throw new Error("Evaluation is not expected in this test.");
    },
  };
}

async function createDatabase(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ahamed-recovery-"));
  closeablesByTest.set(t, []);
  t.after(async () => {
    for (const closeable of closeablesByTest.get(t)?.reverse() ?? []) {
      closeable.close();
    }
    await rm(directory, { recursive: true, force: true });
  });
  return join(directory, "recovery.sqlite");
}

function trackCloseable(t: TestContext, closeable: { close(): void }): void {
  closeablesByTest.get(t)?.push(closeable);
}

function baseSession(sessionId: string): SessionAggregate {
  const fixture = createCaseFixture();
  return createSessionAggregate({
    sessionId,
    patientNpcId: "npc_fixture_patient",
    publicCaseId: fixture.publicCaseId,
    caseVersion: fixture.caseVersion,
    evaluationVersion: fixture.evaluationVersion,
    now: CREATED_AT,
  });
}

function moveToPhase(
  session: SessionAggregate,
  phase: SessionAggregate["sessionPhase"],
): void {
  if (phase === "created") return;
  transitionSession(session, "active");
  if (phase === "active") return;
  if (phase === "awaiting_model") {
    transitionSession(session, "awaiting_model");
    return;
  }
  if (phase === "diagnosis_submitted" || phase === "evaluating" || phase === "completed") {
    session.diagnosisSubmission = {
      submissionId: `submission_${session.sessionId}`,
      fingerprint: "diagnosis-fingerprint",
      primaryDiagnosis: "Fixture Syndrome",
      differentials: ["Example Condition", "Second Example Condition"],
      acceptedAt: CREATED_AT.toISOString(),
    };
    transitionSession(session, "diagnosis_submitted");
    if (phase === "diagnosis_submitted") return;
    transitionSession(session, "evaluating");
    if (phase === "evaluating") return;
    transitionSession(session, "completed");
    return;
  }
  transitionSession(session, phase);
}

function seedOperation(
  transaction: PersistenceTransaction,
  session: SessionAggregate,
  kind: "turn" | "evaluation",
  status: OperationJournalRecord["status"],
): OperationJournalRecord {
  const operationId = `operation_${session.sessionId}`;
  const idempotencyKey = `idempotency_${session.sessionId}`;
  const operationName = kind === "turn" ? "submit_turn" : "submit_diagnosis";
  const turnText = "When did it start?";
  const evaluationRequest = {
    primaryDiagnosis: "Fixture Syndrome",
    differentials: ["Example Condition", "Second Example Condition"],
  };
  const requestHash = kind === "turn"
    ? safetyRequestFingerprint("submit_turn", session.sessionId, {
        text: turnText,
      })
    : requestFingerprint(operationName, session.sessionId, evaluationRequest);
  if (kind === "evaluation" && session.diagnosisSubmission !== undefined) {
    session.diagnosisSubmission.fingerprint = requestHash;
  }
  const idempotency: IdempotencyRecord = {
    scopeId: session.sessionId,
    operation: operationName,
    idempotencyKey,
    requestHash,
    status: status === "committed" ? "committed" : "in_progress",
    operationId,
    createdAt: CREATED_AT.toISOString(),
    retainUntil: new Date("2026-08-09T00:00:00.000Z").toISOString(),
  };
  const operation: OperationJournalRecord = {
    operationId,
    sessionId: session.sessionId,
    idempotencyKey,
    requestHash,
    kind,
    status,
    request: kind === "turn"
      ? encryptTurnOperationRequestV1(
          {
            operationId,
            sessionId: session.sessionId,
            idempotencyKey,
            requestHash,
            providerName: session.providerName,
            modelId: session.modelId,
            promptVersion: session.promptVersion,
            caseVersion: session.caseVersion,
          },
          turnText,
          TEST_SAFETY_AUDIT_HMAC_KEY,
        )
      : evaluationRequest,
    attemptCount: status === "dispatched" ? 1 : 0,
    providerName: session.providerName,
    modelId: session.modelId,
    promptVersion: session.promptVersion,
    caseVersion: session.caseVersion,
    createdAt: CREATED_AT.toISOString(),
    updatedAt: CREATED_AT.toISOString(),
  };
  if (status === "response_validated") {
    if (kind === "evaluation" && session.turns.length === 0) {
      session.turns.push({
        turnId: `turn_${session.sessionId}`,
        clientTurnId: `client_turn_${session.sessionId}`,
        text: "When did it start?",
        reply: "It began two weeks ago.",
        disclosedFactIds: ["fact.onset"],
        action: "ask_patient",
        requestedFactIds: ["fact.onset"],
        interactionKind: "medical_chat",
        factIdsUsed: ["fact.onset"],
        personaFactIdsUsed: [],
        completedTestIdsUsed: [],
        effects: [],
        turnNumber: 1,
        createdAt: CREATED_AT.toISOString(),
      });
      session.turnCount = 1;
      session.medicalTurnCount = 1;
      session.disclosedFacts.push({
        factId: "fact.onset",
        displayText: "It began two weeks ago.",
        disclosedAtTurn: 1,
      });
    }
    const casePackage = createCaseFixture();
    const evaluation = kind === "evaluation"
      ? evaluateDeterministically(
          {
            casePackage,
            primaryDiagnosis:
              session.diagnosisSubmission!.primaryDiagnosis,
            differentials: [
              ...session.diagnosisSubmission!.differentials,
            ],
            disclosedFactIds: session.disclosedFacts.map(
              ({ factId }) => factId,
            ),
            completedTestIds: session.completedTests.map(
              ({ testId }) => testId,
            ),
            turnIds: session.turns.map(({ turnId }) => turnId),
          },
          {
            status: "available",
            score: 100,
            supportingTurnIds: [session.turns[0]!.turnId],
            rubricCriterionIds: [
              casePackage.rubric.communicationCriterionIds[0]!,
              casePackage.rubric.communicationCriterionIds[1]!,
            ],
          },
        )
      : undefined;
    const payload = kind === "turn"
      ? {
          text: "When did it start?",
          action: "ask_patient",
          requestedFactIds: ["fact.onset"],
          createdAt: CREATED_AT.toISOString(),
          disclosedFacts: [
            {
              factId: "fact.onset",
              displayText: "It started about two weeks ago.",
              disclosedAtTurn: 1,
            },
          ],
          response: {
            sessionId: session.sessionId,
            turnId: `turn_${session.sessionId}`,
            reply: "It started about two weeks ago.",
            disclosedFactIds: ["fact.onset"],
            turnNumber: 1,
            sessionPhase: "active",
          },
        }
      : {
          response: {
            sessionId: session.sessionId,
            caseVersion: session.caseVersion,
            ...evaluation!,
            sessionPhase: "completed",
            completedAt: CREATED_AT.toISOString(),
          },
          communicationAssessment: {
            status: "available",
            score: 100,
            supportingTurnIds: [session.turns[0]!.turnId],
            rubricCriterionIds: [
              casePackage.rubric.communicationCriterionIds[0]!,
              casePackage.rubric.communicationCriterionIds[1]!,
            ],
          },
        };
    operation.buffer = signedBuffer(
      operation,
      kind === "turn" ? "turn.v1" : "evaluation.v1",
      payload,
    );
  }
  session.activeOperationId = operationId;
  transaction.sessions.save(session);
  transaction.idempotency.save(idempotency);
  transaction.operations.save(operation);
  return operation;
}

function seedSession(
  databasePath: string,
  phase: SessionAggregate["sessionPhase"],
  operationStatus?: OperationJournalRecord["status"],
): { sessionId: string; operationId?: string } {
  const persistence = new SqliteModelPersistence(databasePath);
  const session = baseSession(`session_${phase}_${operationStatus ?? "none"}`);
  moveToPhase(session, phase);
  let operationId: string | undefined;
  persistence.transaction((transaction) => {
    transaction.sessions.save(session);
    if (operationStatus !== undefined) {
      operationId = seedOperation(
        transaction,
        session,
        phase === "evaluating" ? "evaluation" : "turn",
        operationStatus,
      ).operationId;
    }
  });
  persistence.close();
  return {
    sessionId: session.sessionId,
    ...(operationId === undefined ? {} : { operationId }),
  };
}

function rewriteTurnBuffer(
  databasePath: string,
  operationId: string,
  mutate: (payload: Record<string, unknown>) => void,
): void {
  const database = new DatabaseSync(databasePath);
  const row = database
    .prepare("SELECT buffer_json FROM operation_journal WHERE operation_id = ?")
    .get(operationId) as { buffer_json: string };
  const encoded = JSON.parse(row.buffer_json) as {
    payload: Record<string, unknown>;
    sha256: string;
  };
  mutate(encoded.payload);
  encoded.sha256 = sha256(encoded.payload);
  database
    .prepare("UPDATE operation_journal SET buffer_json = ? WHERE operation_id = ?")
    .run(JSON.stringify(encoded), operationId);
  database.close();
}

function resignPersistedBuffer(
  databasePath: string,
  operationId: string,
): void {
  const persistence = new SqliteModelPersistence(databasePath);
  persistence.transaction((transaction) => {
    const operation = transaction.operations.get(operationId);
    assert.ok(operation?.buffer);
    operation.buffer.hmacSha256 = operationBufferHmacSha256V1(
      operation,
      operation.buffer,
      TEST_SAFETY_AUDIT_HMAC_KEY,
    );
    transaction.operations.save(operation);
  });
  persistence.close();
}

function assertTurnRecoveryFailsClosed(
  databasePath: string,
  sessionId: string,
): void {
  assert.throws(
    () =>
      createSqliteModelService({
        databasePath,
        cases: [createCaseFixture()],
        clock: { now: () => new Date(NOW) },
      }),
    (error: unknown) =>
      error instanceof ModelServiceError &&
      error.code === "OPERATION_RECOVERY_REQUIRED",
  );
  const database = new DatabaseSync(databasePath, { readOnly: true });
  const session = database
    .prepare("SELECT session_phase, turn_count FROM sessions WHERE session_id = ?")
    .get(sessionId) as { session_phase: string; turn_count: number };
  const turnCount = database
    .prepare("SELECT COUNT(*) AS count FROM turns WHERE session_id = ?")
    .get(sessionId) as { count: number };
  database.close();
  assert.equal(session.session_phase, "awaiting_model");
  assert.equal(session.turn_count, 0);
  assert.equal(turnCount.count, 0);
}

test("startup covers every session-phase row without provider calls", async (t) => {
  const scenarios: Array<{
    phase: SessionAggregate["sessionPhase"];
    operationStatus?: OperationJournalRecord["status"];
    expected: SessionAggregate["sessionPhase"];
  }> = [
    { phase: "created", expected: "active" },
    { phase: "active", expected: "active" },
    {
      phase: "awaiting_model",
      operationStatus: "response_validated",
      expected: "active",
    },
    { phase: "diagnosis_submitted", expected: "diagnosis_submitted" },
    {
      phase: "evaluating",
      operationStatus: "response_validated",
      expected: "completed",
    },
    { phase: "completed", expected: "completed" },
    { phase: "expired", expected: "expired" },
    { phase: "cancelled", expected: "cancelled" },
    { phase: "failed", expected: "failed" },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.phase, async (subtest) => {
      const databasePath = await createDatabase(subtest);
      const seeded = seedSession(
        databasePath,
        scenario.phase,
        scenario.operationStatus,
      );
      const counter = { calls: 0 };
      const service = createSqliteModelService({
        databasePath,
        cases: [createCaseFixture()],
        provider: createCountingProvider(counter),
        clock: { now: () => new Date(NOW) },
      });
      trackCloseable(subtest, service);

      assert.equal(service.getSession(seeded.sessionId).sessionPhase, scenario.expected);
      assert.equal(counter.calls, 0);
      if (seeded.operationId) {
        assert.equal(
          service.inspectOperation(seeded.operationId).status,
          "committed",
        );
      }
    });
  }
});

test("startup recovers a v3-shaped validated turn buffer after the v4 migration", async (t) => {
  const databasePath = await createDatabase(t);
  const seeded = seedSession(databasePath, "awaiting_model", "response_validated");
  assert.ok(seeded.operationId);
  const operationId = seeded.operationId;
  const database = new DatabaseSync(databasePath);
  const row = database
    .prepare("SELECT buffer_json FROM operation_journal WHERE operation_id = ?")
    .get(operationId) as { buffer_json: string };
  const encoded = JSON.parse(row.buffer_json) as {
    payload: Record<string, unknown>;
    sha256: string;
  };
  delete encoded.payload["action"];
  delete encoded.payload["requestedFactIds"];
  encoded.sha256 = sha256(encoded.payload);
  database
    .prepare("UPDATE operation_journal SET buffer_json = ? WHERE operation_id = ?")
    .run(JSON.stringify(encoded), operationId);
  database.close();
  resignPersistedBuffer(databasePath, operationId);

  const service = createSqliteModelService({
    databasePath,
    cases: [createCaseFixture()],
    clock: { now: () => new Date(NOW) },
  });
  trackCloseable(t, service);

  const restored = service.getSession(seeded.sessionId);
  assert.equal(restored.sessionPhase, "active");
  assert.equal(restored.turnCount, 1);
  assert.equal(service.inspectOperation(operationId).status, "committed");
});

test("startup commits a validated chat-triggered test effect exactly once", async (t) => {
  const databasePath = await createDatabase(t);
  const seeded = seedSession(databasePath, "awaiting_model", "response_validated");
  assert.ok(seeded.operationId);
  rewriteTurnBuffer(databasePath, seeded.operationId, (payload) => {
    const response = payload["response"] as Record<string, unknown>;
    response["effects"] = [{
      type: "test_completed",
      result: {
        testId: "test.basic_panel",
        status: "completed",
        report: "A stable, fixture-only result.",
      },
    }];
    payload["patientAgentOutput"] = {
      reply: response["reply"],
      interactionKind: "test_order",
      factIdsUsed: ["fact.onset"],
      personaFactIdsUsed: [],
      completedTestIdsUsed: [],
      requestedTestId: "test.basic_panel",
      newFactsClaimed: [],
      diagnosisLeak: false,
    };
  });
  resignPersistedBuffer(databasePath, seeded.operationId);

  const service = createSqliteModelService({
    databasePath,
    cases: [createCaseFixture()],
    clock: { now: () => new Date(NOW) },
  });
  trackCloseable(t, service);

  assert.deepEqual(service.getSession(seeded.sessionId).completedTests, [{
    testId: "test.basic_panel",
    status: "completed",
    report: "A stable, fixture-only result.",
  }]);
  assert.equal(
    service.listEvents(seeded.sessionId).filter(
      ({ eventType }) => eventType === "test.completed",
    ).length,
    1,
  );
  assert.equal(service.inspectOperation(seeded.operationId).status, "committed");
});

test("startup refuses a validated turn whose persisted reply was tampered", async (t) => {
  const databasePath = await createDatabase(t);
  const seeded = seedSession(databasePath, "awaiting_model", "response_validated");
  assert.ok(seeded.operationId);
  rewriteTurnBuffer(databasePath, seeded.operationId, (payload) => {
    const response = payload["response"] as Record<string, unknown>;
    response["reply"] = "Fixture Syndrome is the hidden diagnosis.";
  });

  assertTurnRecoveryFailsClosed(databasePath, seeded.sessionId);
});

test("startup binds a re-signed turn buffer to the original request", async (t) => {
  const databasePath = await createDatabase(t);
  const seeded = seedSession(databasePath, "awaiting_model", "response_validated");
  assert.ok(seeded.operationId);
  rewriteTurnBuffer(databasePath, seeded.operationId, (payload) => {
    payload["text"] = "Do you have a rash?";
  });
  // Even a fixture with access to the key cannot turn a different request into
  // a valid recovery payload because commit also binds it to operation.request.
  resignPersistedBuffer(databasePath, seeded.operationId);

  assertTurnRecoveryFailsClosed(databasePath, seeded.sessionId);
});

test("startup refuses a recomputed-checksum evaluation assessment tamper", async (t) => {
  const databasePath = await createDatabase(t);
  const seeded = seedSession(databasePath, "evaluating", "response_validated");
  assert.ok(seeded.operationId);
  rewriteTurnBuffer(databasePath, seeded.operationId, (payload) => {
    const assessment = payload["communicationAssessment"] as Record<
      string,
      unknown
    >;
    assessment["score"] = 50;
    const response = payload["response"] as Record<string, unknown>;
    const scores = response["scores"] as Record<string, unknown>;
    scores["communication"] = 50;
  });

  assert.throws(
    () =>
      createSqliteModelService({
        databasePath,
        cases: [createCaseFixture()],
        clock: { now: () => new Date(NOW) },
      }),
    (error: unknown) =>
      error instanceof ModelServiceError &&
      error.code === "OPERATION_RECOVERY_REQUIRED",
  );
  const database = new DatabaseSync(databasePath, { readOnly: true });
  const session = database
    .prepare(
      `SELECT session_phase,
        (SELECT COUNT(*) FROM evaluations WHERE session_id = sessions.session_id)
          AS evaluation_count
       FROM sessions WHERE session_id = ?`,
    )
    .get(seeded.sessionId) as {
      session_phase: string;
      evaluation_count: number;
    };
  database.close();
  assert.equal(session.session_phase, "evaluating");
  assert.equal(session.evaluation_count, 0);
});

test("startup refuses validated turn facts that differ from the current case", async (t) => {
  await t.test("invalid fact id", async (subtest) => {
    const databasePath = await createDatabase(subtest);
    const seeded = seedSession(
      databasePath,
      "awaiting_model",
      "response_validated",
    );
    assert.ok(seeded.operationId);
    rewriteTurnBuffer(databasePath, seeded.operationId, (payload) => {
      payload["requestedFactIds"] = ["fact.hidden_clue"];
      const response = payload["response"] as Record<string, unknown>;
      response["disclosedFactIds"] = ["fact.hidden_clue"];
      response["reply"] = "server-only-hidden-clue";
      payload["disclosedFacts"] = [
        {
          factId: "fact.hidden_clue",
          displayText: "server-only-hidden-clue",
          disclosedAtTurn: 1,
        },
      ];
    });

    assertTurnRecoveryFailsClosed(databasePath, seeded.sessionId);
  });

  await t.test("invalid fact value", async (subtest) => {
    const databasePath = await createDatabase(subtest);
    const seeded = seedSession(
      databasePath,
      "awaiting_model",
      "response_validated",
    );
    assert.ok(seeded.operationId);
    rewriteTurnBuffer(databasePath, seeded.operationId, (payload) => {
      const disclosedFacts = payload["disclosedFacts"] as Array<
        Record<string, unknown>
      >;
      disclosedFacts[0]!["displayText"] = "A forged persisted fact value.";
    });

    assertTurnRecoveryFailsClosed(databasePath, seeded.sessionId);
  });
});

test("startup preserves a v3 empty-fact validated turn as a committed medical turn", async (t) => {
  const databasePath = await createDatabase(t);
  const seeded = seedSession(databasePath, "awaiting_model", "response_validated");
  assert.ok(seeded.operationId);
  const operationId = seeded.operationId;
  const database = new DatabaseSync(databasePath);
  const row = database
    .prepare("SELECT buffer_json FROM operation_journal WHERE operation_id = ?")
    .get(operationId) as { buffer_json: string };
  const encoded = JSON.parse(row.buffer_json) as {
    payload: Record<string, unknown>;
    sha256: string;
  };
  const response = encoded.payload["response"] as Record<string, unknown>;
  encoded.payload["disclosedFacts"] = [];
  response["disclosedFactIds"] = [];
  response["reply"] = "I am not sure how to answer that.";
  delete encoded.payload["action"];
  delete encoded.payload["requestedFactIds"];
  encoded.sha256 = sha256(encoded.payload);
  database
    .prepare("UPDATE operation_journal SET buffer_json = ? WHERE operation_id = ?")
    .run(JSON.stringify(encoded), operationId);
  database.close();
  resignPersistedBuffer(databasePath, operationId);

  const service = createSqliteModelService({
    databasePath,
    cases: [createCaseFixture()],
    clock: { now: () => new Date(NOW) },
  });
  trackCloseable(t, service);

  const restored = service.getSession(seeded.sessionId);
  assert.equal(restored.sessionPhase, "active");
  assert.equal(restored.turnCount, 1);
  const inspectionDatabase = new DatabaseSync(databasePath);
  const persistedSession = inspectionDatabase
    .prepare(
      "SELECT medical_turn_count, other_turn_count FROM sessions WHERE session_id = ?",
    )
    .get(seeded.sessionId) as {
      medical_turn_count: number;
      other_turn_count: number;
    };
  const persistedTurn = inspectionDatabase
    .prepare(
      "SELECT action, requested_fact_ids_json FROM turns WHERE session_id = ?",
    )
    .get(seeded.sessionId) as {
      action: string;
      requested_fact_ids_json: string;
    };
  inspectionDatabase.close();
  assert.equal(persistedSession.medical_turn_count, 1);
  assert.equal(persistedSession.other_turn_count, 0);
  assert.equal(persistedTurn.action, "ask_patient");
  assert.deepEqual(JSON.parse(persistedTurn.requested_fact_ids_json), []);
  const recoveredOperation = service.inspectOperation(operationId);
  assert.equal(
    recoveredOperation.buffer?.sha256,
    sha256(recoveredOperation.buffer?.payload),
  );
  assert.equal(
    (recoveredOperation.buffer?.payload as Record<string, unknown>)["action"],
    undefined,
  );
  const next = await service.askPatient({
    sessionId: seeded.sessionId,
    clientTurnId: "turn_after_legacy_empty_fact",
    text: "When did it start?",
  });
  assert.equal(next.turnNumber, 2);
});

test("restart converts dispatched to unknown and requires explicit recovery", async (t) => {
  const databasePath = await createDatabase(t);
  const seeded = seedSession(databasePath, "awaiting_model", "dispatched");
  const counter = { calls: 0 };
  const service = createSqliteModelService({
    databasePath,
    cases: [createCaseFixture()],
    provider: createCountingProvider(counter),
    clock: { now: () => new Date(NOW) },
  });
  trackCloseable(t, service);

  assert.equal(service.inspectOperation(seeded.operationId!).status, "unknown");
  await assert.rejects(
    service.askPatient({
      sessionId: seeded.sessionId,
      clientTurnId: `idempotency_${seeded.sessionId}`,
      text: "When did it start?",
    }),
    (error: unknown) =>
      error instanceof ModelServiceError &&
      error.code === "OPERATION_RECOVERY_REQUIRED",
  );
  assert.equal(counter.calls, 0);
});

test("ops fail records operator metadata and restores the legal phase", async (t) => {
  const databasePath = await createDatabase(t);
  const seeded = seedSession(databasePath, "awaiting_model", "prepared");
  const service = createSqliteModelService({
    databasePath,
    cases: [createCaseFixture()],
    clock: { now: () => new Date(NOW) },
  });
  trackCloseable(t, service);

  const operation = await service.recoverOperation({
    operationId: seeded.operationId!,
    action: "fail",
    operator: "ops.fixture",
    reason: "fixture operator decision",
  });

  assert.equal(operation.status, "failed");
  assert.equal(operation.operator, "ops.fixture");
  assert.equal(operation.recoveryReason, "fixture operator decision");
  assert.equal(service.getSession(seeded.sessionId).sessionPhase, "active");
  const recoveryEvents = service
    .listEvents(seeded.sessionId)
    .filter(({ eventType }) => eventType === "operation.recovery_decided");
  assert.equal(recoveryEvents.length, 1);
  assert.deepEqual(recoveryEvents[0]?.payload, {
    operationId: seeded.operationId,
    action: "fail",
    operator: "ops.fixture",
    reason: "fixture operator decision",
    fromStatus: "prepared",
    toStatus: "failed",
  });
});

test("startup expires old recovery state before deleting its idempotency record", async (t) => {
  const databasePath = await createDatabase(t);
  const seeded = seedSession(databasePath, "awaiting_model", "dispatched");
  const counter = { calls: 0 };
  const service = createSqliteModelService({
    databasePath,
    cases: [createCaseFixture()],
    provider: createCountingProvider(counter),
    clock: { now: () => new Date("2026-08-10T00:00:00.000Z") },
  });
  trackCloseable(t, service);

  assert.equal(service.getSession(seeded.sessionId).sessionPhase, "expired");
  assert.equal(service.inspectOperation(seeded.operationId!).status, "unknown");
  assert.equal(counter.calls, 0);
});

test("an active recovery lease prevents a second provider dispatch", async (t) => {
  const databasePath = await createDatabase(t);
  const seeded = seedSession(databasePath, "awaiting_model", "prepared");
  const persistence = new SqliteModelPersistence(databasePath);
  persistence.transaction((transaction) => {
    const operation = transaction.operations.get(seeded.operationId!);
    assert.ok(operation);
    operation.leaseToken = "lease.fixture";
    operation.leaseExpiresAt = new Date(NOW.getTime() + 60_000).toISOString();
    transaction.operations.save(operation);
  });
  persistence.close();
  const counter = { calls: 0 };
  const service = createSqliteModelService({
    databasePath,
    cases: [createCaseFixture()],
    provider: createCountingProvider(counter),
    clock: { now: () => new Date(NOW) },
  });
  trackCloseable(t, service);

  await assert.rejects(
    service.recoverOperation({
      operationId: seeded.operationId!,
      action: "retry-same-provider",
      operator: "ops.fixture",
      reason: "must respect active lease",
    }),
    (error: unknown) =>
      error instanceof ModelServiceError && error.code === "OPERATION_IN_PROGRESS",
  );
  assert.equal(counter.calls, 0);
});

test("startup rejects a malformed validated buffer with a stable recovery error", async (t) => {
  const databasePath = await createDatabase(t);
  seedSession(databasePath, "awaiting_model", "response_validated");
  const payload = { response: {} };
  const database = new DatabaseSync(databasePath);
  database
    .prepare("UPDATE operation_journal SET buffer_json = ?")
    .run(
      JSON.stringify({
        kind: "turn.v1",
        payload,
        sha256: sha256(payload),
        hmacSha256: "hmac-sha256:invalid",
        validatedAt: CREATED_AT.toISOString(),
      }),
    );
  database.close();

  assert.throws(
    () =>
      createSqliteModelService({
        databasePath,
        cases: [createCaseFixture()],
        clock: { now: () => new Date(NOW) },
      }),
    (error: unknown) =>
      error instanceof ModelServiceError &&
      error.code === "OPERATION_RECOVERY_REQUIRED",
  );
});

test("ops retry uses the same provider and remaining attempt budget", async (t) => {
  const databasePath = await createDatabase(t);
  const seeded = seedSession(databasePath, "awaiting_model", "prepared");
  const counter = { calls: 0 };
  const service = createSqliteModelService({
    databasePath,
    cases: [createCaseFixture()],
    provider: createCountingProvider(counter),
    clock: { now: () => new Date(NOW) },
  });
  trackCloseable(t, service);

  const operation = await service.recoverOperation({
    operationId: seeded.operationId!,
    action: "retry-same-provider",
    operator: "ops.fixture",
    reason: "retry fixture",
  });

  assert.equal(operation.status, "committed");
  assert.equal(operation.attemptCount, 1);
  assert.equal(counter.calls, 1);
  assert.equal(service.getSession(seeded.sessionId).turnCount, 1);
});

test("legacy raw turn recovery fails closed instead of executing untrusted plaintext", async (t) => {
  const databasePath = await createDatabase(t);
  const seeded = seedSession(databasePath, "awaiting_model", "prepared");
  const legacyText = "tampered legacy plaintext";
  const legacyRequestHash = requestFingerprint(
    "submit_turn",
    seeded.sessionId,
    { text: legacyText },
  );
  const persistence = new SqliteModelPersistence(databasePath);
  persistence.transaction((transaction) => {
    const operation = transaction.operations.get(seeded.operationId!);
    assert.ok(operation);
    const idempotency = transaction.idempotency.get(
      operation.sessionId,
      "submit_turn",
      operation.idempotencyKey,
    );
    assert.ok(idempotency);
    operation.request = {
      text: legacyText,
      clientTurnId: operation.idempotencyKey,
    };
    operation.requestHash = legacyRequestHash;
    idempotency.requestHash = legacyRequestHash;
    transaction.operations.save(operation);
    transaction.idempotency.save(idempotency);
  });
  persistence.close();
  let controllerCalls = 0;
  const provider: ModelProvider = {
    identity: {
      providerName: "deterministic",
      modelId: "deterministic-v1",
      promptVersion: "v0.1.0",
    },
    async classifyTurn() {
      controllerCalls += 1;
      return {
        action: "unsafe",
        requestedFactIds: [],
        safetyCode: "SAFETY_REAL_HEALTH_INPUT",
      };
    },
    async generatePatientReply() {
      throw new Error("Patient must not run after an unsafe controller decision.");
    },
    async evaluate() {
      throw new Error("Evaluation is not expected in this test.");
    },
  };
  const service = createSqliteModelService({
    databasePath,
    cases: [createCaseFixture()],
    provider,
    clock: { now: () => new Date(NOW) },
  });
  trackCloseable(t, service);

  await assert.rejects(
    service.recoverOperation({
      operationId: seeded.operationId!,
      action: "retry-same-provider",
      operator: "ops.fixture",
      reason: "legacy unsafe turn fixture",
    }),
    (error: unknown) =>
      error instanceof ModelServiceError &&
      error.code === "OPERATION_RECOVERY_REQUIRED",
  );

  assert.equal(controllerCalls, 0);
  const operation = service.inspectOperation(seeded.operationId!);
  assert.equal(operation.status, "failed");
  assert.match(operation.requestHash, /^hmac-sha256:[a-f0-9]{64}$/u);
  assert.notEqual(operation.requestHash, legacyRequestHash);
  assert.deepEqual(operation.request, {
    clientTurnId: operation.idempotencyKey,
    redacted: true,
    textLength: legacyText.length,
    inputHmac: operation.requestHash,
  });
  assert.equal(
    service
      .listEvents(seeded.sessionId)
      .some(({ eventType }) => eventType === "safety.interrupted"),
    false,
  );
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    const bytes = await readFile(path).catch((error: unknown) => {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return Buffer.alloc(0);
      }
      throw error;
    });
    assert.equal(
      bytes.includes(Buffer.from(legacyText, "utf8")),
      false,
      `${path} must not retain legacy pending-turn plaintext`,
    );
  }
});

test("ops commit-buffered performs only a local commit", async (t) => {
  const databasePath = await createDatabase(t);
  const counter = { calls: 0 };
  const service = createSqliteModelService({
    databasePath,
    cases: [createCaseFixture()],
    provider: createCountingProvider(counter),
    clock: { now: () => new Date(NOW) },
  });
  trackCloseable(t, service);
  const seeded = seedSession(
    databasePath,
    "awaiting_model",
    "response_validated",
  );

  const operation = await service.recoverOperation({
    operationId: seeded.operationId!,
    action: "commit-buffered",
    operator: "ops.fixture",
    reason: "commit validated fixture",
  });

  assert.equal(operation.status, "committed");
  assert.equal(counter.calls, 0);
  assert.equal(service.getSession(seeded.sessionId).turnCount, 1);
});

test("ops CLI requires and reuses the stable buffer HMAC key across processes", async (t) => {
  const databasePath = await createDatabase(t);
  const seeded = seedSession(
    databasePath,
    "awaiting_model",
    "response_validated",
  );
  assert.ok(seeded.operationId);
  const persistence = new SqliteModelPersistence(databasePath);
  persistence.transaction((transaction) => {
    const session = transaction.sessions.get(seeded.sessionId);
    assert.ok(session);
    session.expiresAt = "2099-08-01T00:00:00.000Z";
    transaction.sessions.save(session);
  });
  persistence.close();
  const args = [
    "recover",
    "--database",
    databasePath,
    "--operation",
    seeded.operationId,
    "--commit-buffered",
    "--operator",
    "ops.fixture",
    "--reason",
    "cross-process stable-key regression",
  ];
  const errors: string[] = [];

  assert.equal(
    await runOpsCli(args, () => undefined, (line) => errors.push(line), {}),
    1,
  );
  assert.match(errors.join("\n"), /SAFETY_AUDIT_HMAC_KEY/u);

  const output: string[] = [];
  assert.equal(
    await runOpsCli(
      args,
      (line) => output.push(line),
      () => undefined,
      { SAFETY_AUDIT_HMAC_KEY: TEST_SAFETY_AUDIT_HMAC_KEY },
    ),
    0,
  );
  const summary = JSON.parse(output.join("\n")) as Record<string, unknown>;
  assert.equal(summary["status"], "committed");

  const inspection = new SqliteModelPersistence(databasePath, {
    readOnly: true,
  });
  const state = inspection.transaction((transaction) => ({
    operation: transaction.operations.get(seeded.operationId!),
    session: transaction.sessions.get(seeded.sessionId),
  }));
  inspection.close();
  assert.equal(state.operation?.status, "committed");
  assert.equal(state.session?.turnCount, 1);
});

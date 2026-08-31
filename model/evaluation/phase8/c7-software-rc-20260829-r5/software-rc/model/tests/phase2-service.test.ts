import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";

import { createSqliteModelService as createSqliteModelServiceWithKey } from "../src/application/create-sqlite-model-service.js";
import { ModelService } from "../src/application/model-service.js";
import { ModelServiceError } from "../src/domain/errors.js";
import { MemoryEventSink } from "../src/observability/event-sink.js";
import { SqliteModelPersistence } from "../src/persistence/sqlite/sqlite-model-persistence.js";
import { DeterministicModelProvider } from "../src/providers/deterministic-model-provider.js";
import type {
  ControllerDecision,
  ModelProvider,
  PatientReply,
} from "../src/providers/model-provider.js";
import { InMemoryCaseRepository } from "../src/repositories/case-repository.js";
import { createCaseFixture } from "./fixtures/case-fixture.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_SAFETY_AUDIT_HMAC_KEY =
  "phase7-test-only-stable-hmac-key-000000000000";
const servicesByTest = new WeakMap<TestContext, Array<{ close(): void }>>();

type SqliteServiceOptions = Parameters<typeof createSqliteModelServiceWithKey>[0];

function createSqliteModelService(
  options: Omit<SqliteServiceOptions, "safetyAuditHmacKey">,
) {
  return createSqliteModelServiceWithKey({
    ...options,
    safetyAuditHmacKey: TEST_SAFETY_AUDIT_HMAC_KEY,
  });
}

function trackService<T extends { close(): void }>(t: TestContext, service: T): T {
  servicesByTest.get(t)?.push(service);
  return service;
}

async function createDatabasePath(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ahamed-phase2-"));
  const services: Array<{ close(): void }> = [];
  servicesByTest.set(t, services);
  t.after(async () => {
    for (const service of services.reverse()) {
      service.close();
    }
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 25,
    });
  });
  return join(directory, "model-service.sqlite");
}

function errorHasCode(expectedCode: string) {
  return (error: unknown): boolean =>
    error instanceof ModelServiceError &&
    (error as ModelServiceError & { code: string }).code === expectedCode;
}

function createFixtureProvider(options: {
  onCall?: () => void;
  classifyTurn?: ModelProvider["classifyTurn"];
  generatePatientReply?: ModelProvider["generatePatientReply"];
  identity?: ModelProvider["identity"];
} = {}): ModelProvider {
  return {
    identity: options.identity ?? {
      providerName: "fixture-provider",
      modelId: "fixture-model-v1",
      promptVersion: "fixture-prompt-v1",
    },
    async classifyTurn(input): Promise<ControllerDecision> {
      options.onCall?.();
      if (options.classifyTurn) {
        return options.classifyTurn(input);
      }
      return {
        action: "ask_patient",
        requestedFactIds: [
          input.text.toLocaleLowerCase("en-US").includes("rash")
            ? "fact.rash"
            : "fact.onset",
        ],
      };
    },
    async generatePatientReply(input): Promise<PatientReply> {
      options.onCall?.();
      if (options.generatePatientReply) {
        return options.generatePatientReply(input);
      }
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
      options.onCall?.();
      throw new Error("Evaluation is not used by these Phase 2 tests.");
    },
  };
}

async function createSession(
  service: ReturnType<typeof createSqliteModelService>,
  clientRequestId = "create-session",
) {
  return service.createSession({
    clientRequestId,
    idempotencyScopeId: "phase2.fixture",
    publicCaseId: "case_fixture_001",
    patientNpcId: "npc_fixture_patient",
  });
}

test("restores the same public projection after restart without calling the provider", async (t) => {
  const databasePath = await createDatabasePath(t);
  const firstService = createSqliteModelService({
    databasePath,
    cases: [createCaseFixture()],
    provider: createFixtureProvider(),
  });
  const created = await createSession(firstService, "create-restart");
  await firstService.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn-before-restart",
    text: "When did it start?",
  });
  await firstService.orderTest({
    sessionId: created.session.sessionId,
    clientRequestId: "test-before-restart",
    testId: "test.basic_panel",
  });
  const beforeRestart = firstService.getSession(created.session.sessionId);
  let restartProviderCalls = 0;

  const restartedService = createSqliteModelService({
    databasePath,
    cases: [createCaseFixture()],
    provider: createFixtureProvider({
      onCall: () => {
        restartProviderCalls += 1;
      },
    }),
  });
  trackService(t, firstService);
  trackService(t, restartedService);

  assert.deepEqual(
    restartedService.getSession(created.session.sessionId),
    beforeRestart,
  );
  assert.equal(restartProviderCalls, 0);
});

test("rejects a changed create-session payload that reuses an idempotency key", async (t) => {
  const service = createSqliteModelService({
    databasePath: await createDatabasePath(t),
    cases: [createCaseFixture()],
  });
  trackService(t, service);
  await createSession(service, "create-conflict");

  await assert.rejects(
    service.createSession({
      clientRequestId: "create-conflict",
      idempotencyScopeId: "phase2.fixture",
      publicCaseId: "case_fixture_001",
      patientNpcId: "npc_changed",
    }),
    errorHasCode("IDEMPOTENCY_CONFLICT"),
  );
});

test("rejects a changed turn payload that reuses an idempotency key", async (t) => {
  const service = createSqliteModelService({
    databasePath: await createDatabasePath(t),
    cases: [createCaseFixture()],
    provider: createFixtureProvider(),
  });
  trackService(t, service);
  const created = await createSession(service, "create-turn-conflict");
  await service.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn-conflict",
    text: "When did it start?",
  });

  await assert.rejects(
    service.askPatient({
      sessionId: created.session.sessionId,
      clientTurnId: "turn-conflict",
      text: "Do you have a rash?",
    }),
    errorHasCode("IDEMPOTENCY_CONFLICT"),
  );
});

test("rejects a changed test payload that reuses an idempotency key", async (t) => {
  const service = createSqliteModelService({
    databasePath: await createDatabasePath(t),
    cases: [createCaseFixture()],
  });
  trackService(t, service);
  const created = await createSession(service, "create-test-conflict");
  await service.orderTest({
    sessionId: created.session.sessionId,
    clientRequestId: "test-conflict",
    testId: "test.basic_panel",
  });

  await assert.rejects(
    service.orderTest({
      sessionId: created.session.sessionId,
      clientRequestId: "test-conflict",
      testId: "test.changed",
    }),
    errorHasCode("IDEMPOTENCY_CONFLICT"),
  );
});

test("expires seven days after creation without extending TTL on later writes", async (t) => {
  let currentTime = new Date("2026-08-01T00:00:00.000Z");
  const service = createSqliteModelService({
    databasePath: await createDatabasePath(t),
    cases: [createCaseFixture()],
    provider: createFixtureProvider(),
    clock: { now: () => new Date(currentTime) },
  });
  trackService(t, service);
  const created = await createSession(service, "create-expiring");
  currentTime = new Date(currentTime.getTime() + 6 * DAY_MS);
  await service.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn-day-six",
    text: "When did it start?",
  });
  currentTime = new Date("2026-08-08T00:00:00.001Z");

  await assert.rejects(
    service.orderTest({
      sessionId: created.session.sessionId,
      clientRequestId: "test-after-expiry",
      testId: "test.basic_panel",
    }),
    errorHasCode("SESSION_EXPIRED"),
  );
  assert.equal(
    service.getSession(created.session.sessionId).sessionPhase,
    "expired",
  );
});

test("keeps a cancelled session terminal and rejects later writes", async (t) => {
  const service = createSqliteModelService({
    databasePath: await createDatabasePath(t),
    cases: [createCaseFixture()],
  });
  trackService(t, service);
  const created = await createSession(service, "create-cancelled");

  await service.cancelSession({
    sessionId: created.session.sessionId,
    clientRequestId: "cancel-session",
  });

  assert.equal(
    service.getSession(created.session.sessionId).sessionPhase,
    "cancelled",
  );
  await assert.rejects(
    service.orderTest({
      sessionId: created.session.sessionId,
      clientRequestId: "test-after-cancel",
      testId: "test.basic_panel",
    }),
    errorHasCode("SESSION_CANCELLED"),
  );
});

test("regenerates one rejected Patient Agent output in the same turn operation", async (t) => {
  let patientCalls = 0;
  const provider = createFixtureProvider({
    generatePatientReply: async () => {
      patientCalls += 1;
      return {
        reply: patientCalls === 1
          ? "server-only-hidden-clue"
          : "It started about two weeks ago.",
        interactionKind: "medical_chat",
        factIdsUsed: [
          patientCalls === 1 ? "fact.hidden_clue" : "fact.onset",
        ],
        personaFactIdsUsed: [],
        completedTestIdsUsed: [],
        newFactsClaimed: [],
        diagnosisLeak: false,
      };
    },
  });
  const service = createSqliteModelService({
    databasePath: await createDatabasePath(t),
    cases: [createCaseFixture()],
    provider,
  });
  trackService(t, service);
  const created = await createSession(service, "create-output-recovery");

  const recovered = await service.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn-invalid-provider-output",
    text: "Tell me the hidden clue.",
  });
  assert.equal(patientCalls, 2);
  assert.equal(recovered.reply, "It started about two weeks ago.");
  assert.equal(recovered.turnNumber, 1);
  assert.equal(service.getSession(created.session.sessionId).turnCount, 1);
});

test("fails a turn without committing state after the single output regeneration is rejected", async (t) => {
  let patientCalls = 0;
  const service = createSqliteModelService({
    databasePath: await createDatabasePath(t),
    cases: [createCaseFixture()],
    provider: createFixtureProvider({
      generatePatientReply: async () => {
        patientCalls += 1;
        return {
          reply: "server-only-hidden-clue",
          interactionKind: "medical_chat",
          factIdsUsed: ["fact.hidden_clue"],
          personaFactIdsUsed: [],
          completedTestIdsUsed: [],
          newFactsClaimed: [],
          diagnosisLeak: false,
        };
      },
    }),
  });
  trackService(t, service);
  const created = await createSession(service, "create-output-rejected-twice");

  await assert.rejects(
    service.askPatient({
      sessionId: created.session.sessionId,
      clientTurnId: "turn-output-rejected-twice",
      text: "Tell me the hidden clue.",
    }),
    errorHasCode("MODEL_OUTPUT_REJECTED"),
  );
  const projection = service.getSession(created.session.sessionId);
  assert.equal(patientCalls, 2);
  assert.equal(projection.sessionPhase, "active");
  assert.equal(projection.turnCount, 0);
  assert.deepEqual(projection.disclosedFacts, []);
  assert.deepEqual(projection.completedTests, []);
});

test("commits a direct Patient Agent test order and its deterministic result atomically", async (t) => {
  let patientCalls = 0;
  const service = createSqliteModelService({
    databasePath: await createDatabasePath(t),
    cases: [createCaseFixture()],
    provider: createFixtureProvider({
      generatePatientReply: async () => {
        patientCalls += 1;
        return {
          reply: "Okay, I will have the Basic panel.",
          interactionKind: "test_order",
          factIdsUsed: [],
          personaFactIdsUsed: [],
          completedTestIdsUsed: [],
          requestedTestId: "test.basic_panel",
          newFactsClaimed: [],
          diagnosisLeak: false,
        };
      },
    }),
  });
  trackService(t, service);
  const created = await createSession(service, "create-direct-test-order");

  const completed = await service.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn-direct-test-order",
    text: "Please do a basic panel now.",
  });
  const replayed = await service.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn-direct-test-order",
    text: "Please do a basic panel now.",
  });

  assert.deepEqual(replayed, completed);
  assert.equal(patientCalls, 1);
  assert.equal(completed.reply, "Okay, I will have the Basic panel.");
  assert.deepEqual(completed.effects, [{
    type: "test_completed",
    result: {
      testId: "test.basic_panel",
      status: "completed",
      report: "A stable, fixture-only result.",
    },
  }]);
  const completedEffect = completed.effects[0];
  if (completedEffect?.type !== "test_completed") {
    assert.fail("expected a completed test side effect");
  }
  assert.deepEqual(
    service.getSession(created.session.sessionId).completedTests,
    [completedEffect.result],
  );
});

test("normalizes historical idempotent turn responses that predate effects", async (t) => {
  const databasePath = await createDatabasePath(t);
  const service = createSqliteModelService({
    databasePath,
    cases: [createCaseFixture()],
    provider: createFixtureProvider({
      generatePatientReply: async () => ({
        reply: "It started about two weeks ago.",
        interactionKind: "medical_chat",
        factIdsUsed: ["fact.onset"],
        personaFactIdsUsed: [],
        completedTestIdsUsed: [],
        newFactsClaimed: [],
        diagnosisLeak: false,
      }),
    }),
  });
  trackService(t, service);
  const created = await createSession(service, "create-legacy-turn-replay");
  const request = {
    sessionId: created.session.sessionId,
    clientTurnId: "turn-legacy-replay",
    text: "How are you feeling?",
  };
  const completed = await service.askPatient(request);
  assert.deepEqual(completed.effects, []);

  const database = new DatabaseSync(databasePath);
  try {
    const row = database
      .prepare(
        `SELECT response_json FROM idempotency_records
         WHERE scope_id = ? AND operation = 'submit_turn' AND idempotency_key = ?`,
      )
      .get(request.sessionId, request.clientTurnId) as
      | { response_json?: unknown }
      | undefined;
    if (typeof row?.response_json !== "string") {
      assert.fail("expected a persisted idempotency response");
    }
    const historicalResponse = JSON.parse(row.response_json) as Record<
      string,
      unknown
    >;
    delete historicalResponse.effects;
    database
      .prepare(
        `UPDATE idempotency_records SET response_json = ?
         WHERE scope_id = ? AND operation = 'submit_turn' AND idempotency_key = ?`,
      )
      .run(
        JSON.stringify(historicalResponse),
        request.sessionId,
        request.clientTurnId,
      );
  } finally {
    database.close();
  }

  const replayed = await service.askPatient(request);
  assert.deepEqual(replayed, completed);
});

test("persists a pending test suggestion across restart and confirms it with the shared test engine", async (t) => {
  const databasePath = await createDatabasePath(t);
  const firstService = createSqliteModelService({
    databasePath,
    cases: [createCaseFixture()],
    provider: createFixtureProvider({
      generatePatientReply: async () => ({
        reply: "That Basic panel has not been done. Should I do it now?",
        interactionKind: "test_query",
        factIdsUsed: [],
        personaFactIdsUsed: [],
        completedTestIdsUsed: [],
        suggestedTestId: "test.basic_panel",
        newFactsClaimed: [],
        diagnosisLeak: false,
      }),
    }),
  });
  trackService(t, firstService);
  const created = await createSession(firstService, "create-pending-test");
  const queried = await firstService.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn-query-test",
    text: "What is the Basic panel result?",
  });
  assert.deepEqual(queried.effects, []);
  assert.deepEqual(
    firstService.getSession(created.session.sessionId).completedTests,
    [],
  );

  let confirmationCalls = 0;
  const restartedService = createSqliteModelService({
    databasePath,
    cases: [createCaseFixture()],
    provider: createFixtureProvider({
      generatePatientReply: async (input) => {
        confirmationCalls += 1;
        assert.equal(
          input.pendingTestSuggestionId,
          "test.basic_panel",
        );
        return {
          reply: "Okay, I will do it now.",
          interactionKind: "test_order",
          factIdsUsed: [],
          personaFactIdsUsed: [],
          completedTestIdsUsed: [],
          requestedTestId: input.pendingTestSuggestionId,
          newFactsClaimed: [],
          diagnosisLeak: false,
        };
      },
    }),
  });
  trackService(t, restartedService);

  const confirmed = await restartedService.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn-confirm-test",
    text: "Okay, do it.",
  });
  const replayed = await restartedService.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn-confirm-test",
    text: "Okay, do it.",
  });
  const compatibilityResult = await restartedService.orderTest({
    sessionId: created.session.sessionId,
    clientRequestId: "test-compatibility-entry",
    testId: "test.basic_panel",
  });

  assert.deepEqual(replayed, confirmed);
  assert.equal(confirmationCalls, 1);
  assert.equal(confirmed.effects[0]?.type, "test_completed");
  if (confirmed.effects[0]?.type !== "test_completed") {
    assert.fail("expected a completed test side effect");
  }
  assert.deepEqual(compatibilityResult, confirmed.effects[0].result);
  assert.deepEqual(
    restartedService.getSession(created.session.sessionId).completedTests,
    [compatibilityResult],
  );
});

test("clears a pending test suggestion after the next committed non-confirmation turn", async (t) => {
  let patientCalls = 0;
  const service = createSqliteModelService({
    databasePath: await createDatabasePath(t),
    cases: [createCaseFixture()],
    provider: createFixtureProvider({
      generatePatientReply: async (input) => {
        patientCalls += 1;
        if (patientCalls === 1) {
          return {
            reply: "That Basic panel has not been done. Should I do it now?",
            interactionKind: "test_query",
            factIdsUsed: [],
            personaFactIdsUsed: [],
            completedTestIdsUsed: [],
            suggestedTestId: "test.basic_panel",
            newFactsClaimed: [],
            diagnosisLeak: false,
          };
        }
        if (patientCalls === 2) {
          assert.equal(input.pendingTestSuggestionId, "test.basic_panel");
          return {
            reply: "Okay, we will not do it.",
            interactionKind: "social_chat",
            factIdsUsed: [],
            personaFactIdsUsed: [],
            completedTestIdsUsed: [],
            newFactsClaimed: [],
            diagnosisLeak: false,
          };
        }
        assert.equal(input.pendingTestSuggestionId, undefined);
        return {
          reply: "Hello, doctor.",
          interactionKind: "social_chat",
          factIdsUsed: [],
          personaFactIdsUsed: [],
          completedTestIdsUsed: [],
          newFactsClaimed: [],
          diagnosisLeak: false,
        };
      },
    }),
  });
  trackService(t, service);
  const created = await createSession(service, "create-expiring-suggestion");

  await service.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn-expiring-suggestion",
    text: "What is the Basic panel result?",
  });
  await service.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn-decline-suggestion",
    text: "No, do not do it.",
  });
  const laterAgreement = await service.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn-later-agreement",
    text: "Okay.",
  });

  assert.equal(patientCalls, 3);
  assert.deepEqual(laterAgreement.effects, []);
  assert.deepEqual(
    service.getSession(created.session.sessionId).completedTests,
    [],
  );
});

test("persists and resets the consecutive off-topic counter across restarts", async (t) => {
  const databasePath = await createDatabasePath(t);
  const firstService = createSqliteModelService({
    databasePath,
    cases: [createCaseFixture()],
    provider: createFixtureProvider({
      generatePatientReply: async () => ({
        reply: "Hello, doctor.",
        interactionKind: "social_chat",
        factIdsUsed: [],
        personaFactIdsUsed: [],
        completedTestIdsUsed: [],
        newFactsClaimed: [],
        diagnosisLeak: false,
      }),
    }),
  });
  trackService(t, firstService);
  const created = await createSession(firstService, "create-off-topic-state");
  await firstService.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn-off-topic",
    text: "Hello.",
  });

  const medicalService = createSqliteModelService({
    databasePath,
    cases: [createCaseFixture()],
    provider: createFixtureProvider({
      generatePatientReply: async (input) => {
        assert.equal(input.consecutiveOffTopicTurns, 1);
        return {
          reply: "It started about two weeks ago.",
          interactionKind: "medical_chat",
          factIdsUsed: ["fact.onset"],
          personaFactIdsUsed: [],
          completedTestIdsUsed: [],
          newFactsClaimed: [],
          diagnosisLeak: false,
        };
      },
    }),
  });
  trackService(t, medicalService);
  await medicalService.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn-medical-reset",
    text: "When did it start?",
  });

  const verificationService = createSqliteModelService({
    databasePath,
    cases: [createCaseFixture()],
    provider: createFixtureProvider({
      generatePatientReply: async (input) => {
        assert.equal(input.consecutiveOffTopicTurns, 0);
        return {
          reply: "Hello again, doctor.",
          interactionKind: "social_chat",
          factIdsUsed: [],
          personaFactIdsUsed: [],
          completedTestIdsUsed: [],
          newFactsClaimed: [],
          diagnosisLeak: false,
        };
      },
    }),
  });
  trackService(t, verificationService);
  await verificationService.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn-off-topic-after-reset",
    text: "Hello again.",
  });
});

test("serializes concurrent turns for one session without losing either turn", async (t) => {
  let releaseFirst!: () => void;
  let markFirstEntered!: () => void;
  const firstEntered = new Promise<void>((resolve) => {
    markFirstEntered = resolve;
  });
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let patientCalls = 0;
  let activePatientCalls = 0;
  let maximumActivePatientCalls = 0;
  const provider = createFixtureProvider({
    generatePatientReply: async (input) => {
      patientCalls += 1;
      activePatientCalls += 1;
      maximumActivePatientCalls = Math.max(
        maximumActivePatientCalls,
        activePatientCalls,
      );
      if (patientCalls === 1) {
        markFirstEntered();
        await firstGate;
      }
      activePatientCalls -= 1;
      const factId = input.userText.toLocaleLowerCase("en-US").includes("rash")
        ? "fact.rash"
        : "fact.onset";
      return {
        reply: factId === "fact.rash"
          ? "I have not noticed a rash."
          : "It started about two weeks ago.",
        interactionKind: "medical_chat",
        factIdsUsed: [factId],
        personaFactIdsUsed: [],
        completedTestIdsUsed: [],
        newFactsClaimed: [],
        diagnosisLeak: false,
      };
    },
  });
  const service = createSqliteModelService({
    databasePath: await createDatabasePath(t),
    cases: [createCaseFixture()],
    provider,
  });
  trackService(t, service);
  const created = await createSession(service, "create-concurrent");

  const firstPromise = service.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn-concurrent-first",
    text: "When did it start?",
  });
  const secondPromise = service.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn-concurrent-second",
    text: "Do you have a rash?",
  });
  await firstEntered;
  await new Promise<void>((resolve) => setImmediate(resolve));
  const callsBeforeFirstCompleted = patientCalls;
  releaseFirst();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  assert.equal(callsBeforeFirstCompleted, 1);
  assert.equal(maximumActivePatientCalls, 1);
  assert.equal(first.turnNumber, 1);
  assert.equal(second.turnNumber, 2);
  assert.equal(service.getSession(created.session.sessionId).turnCount, 2);
});

test("provider configuration drift never dispatches under a stale journal identity", async (t) => {
  const databasePath = await createDatabasePath(t);
  const firstService = createSqliteModelService({
    databasePath,
    cases: [createCaseFixture()],
    provider: createFixtureProvider({
      identity: {
        providerName: "provider-a",
        modelId: "model-a",
        promptVersion: "prompt-a",
      },
    }),
  });
  const created = await createSession(firstService, "create-provider-drift");
  firstService.close();

  let providerCalls = 0;
  const restartedService = createSqliteModelService({
    databasePath,
    cases: [createCaseFixture()],
    provider: createFixtureProvider({
      onCall: () => {
        providerCalls += 1;
      },
      identity: {
        providerName: "provider-b",
        modelId: "model-b",
        promptVersion: "prompt-b",
      },
    }),
  });
  trackService(t, restartedService);

  await assert.rejects(
    restartedService.askPatient({
      sessionId: created.session.sessionId,
      clientTurnId: "turn-provider-drift",
      text: "When did it start?",
    }),
    errorHasCode("OPERATION_RECOVERY_REQUIRED"),
  );
  assert.equal(providerCalls, 0);
  assert.equal(
    restartedService.getSession(created.session.sessionId).sessionPhase,
    "active",
  );
});

test("a safety interruption replays identically after SQLite restart with the stable HMAC key", async (t) => {
  const databasePath = await createDatabasePath(t);
  const firstService = createSqliteModelService({
    databasePath,
    cases: [createCaseFixture()],
  });
  const created = await createSession(firstService, "create-safety-restart");
  const request = {
    sessionId: created.session.sessionId,
    clientTurnId: "turn-safety-restart",
    text: "我现在想死，刀就在手边",
  };

  let firstError: ModelServiceError | undefined;
  try {
    await firstService.askPatient(request);
  } catch (error) {
    assert.ok(error instanceof ModelServiceError);
    firstError = error;
  }
  assert.ok(firstError);
  assert.equal(firstError.code, "SAFETY_INTERRUPTED");
  firstService.close();

  let providerCalls = 0;
  const restartedService = createSqliteModelService({
    databasePath,
    cases: [createCaseFixture()],
    provider: createFixtureProvider({
      onCall: () => {
        providerCalls += 1;
      },
    }),
  });
  trackService(t, restartedService);

  let replayedError: ModelServiceError | undefined;
  try {
    await restartedService.askPatient(request);
  } catch (error) {
    assert.ok(error instanceof ModelServiceError);
    replayedError = error;
  }
  assert.ok(replayedError);
  assert.equal(replayedError.code, firstError.code);
  assert.equal(replayedError.message, firstError.message);
  assert.equal(providerCalls, 0);
  assert.equal(restartedService.getSession(request.sessionId).turnCount, 0);
  assert.equal(
    restartedService
      .listEvents(request.sessionId)
      .filter(({ eventType }) => eventType === "safety.interrupted").length,
    1,
  );
});

test("SQLite factory rejects a missing or short safety-audit key at runtime", async (t) => {
  const databasePath = await createDatabasePath(t);
  const baseOptions = {
    databasePath,
    cases: [createCaseFixture()],
  };

  assert.throws(
    () => createSqliteModelServiceWithKey({
      ...baseOptions,
      safetyAuditHmacKey: undefined as never,
    }),
    /at least 32 characters/u,
  );
  assert.throws(
    () => createSqliteModelServiceWithKey({
      ...baseOptions,
      safetyAuditHmacKey: "too-short",
    }),
    /at least 32 characters/u,
  );

  assert.throws(
    () =>
      new ModelService(
        new InMemoryCaseRepository([createCaseFixture()]),
        new DeterministicModelProvider(),
        new MemoryEventSink(),
        undefined,
        { persistence: new SqliteModelPersistence(databasePath) },
      ),
    /stable safetyAuditHmacKey/u,
  );
});

test("Patient Agent failure never writes pending turn plaintext to SQLite or WAL", async (t) => {
  const databasePath = await createDatabasePath(t);
  let controllerCalls = 0;
  let patientCalls = 0;
  const provider: ModelProvider = {
    identity: {
      providerName: "provider-safety-wal-fixture",
      modelId: "provider-safety-wal-fixture-v1",
      promptVersion: "fixture-v1",
    },
    async classifyTurn() {
      controllerCalls += 1;
      throw new Error("online Controller must not be called");
    },
    async generatePatientReply() {
      patientCalls += 1;
      throw new Error("simulated Patient Agent outage");
    },
    async evaluate() {
      throw new Error("not reached");
    },
  };
  const service = trackService(
    t,
    createSqliteModelService({
      databasePath,
      cases: [createCaseFixture()],
      provider,
    }),
  );
  const created = await createSession(service, "create.provider.safety.wal");
  const request = {
    sessionId: created.session.sessionId,
    clientTurnId: "turn.provider.safety.wal",
    text: "Could you clarify timeline PHI_MARKER_7f92e4a1?",
  };

  await assert.rejects(
    service.askPatient(request),
    errorHasCode("MODEL_UNAVAILABLE"),
  );
  await assert.rejects(
    service.askPatient(request),
    errorHasCode("MODEL_UNAVAILABLE"),
  );
  assert.equal(controllerCalls, 0);
  assert.equal(patientCalls, 1);
  await assert.rejects(
    service.askPatient({ ...request, text: `${request.text} changed` }),
    errorHasCode("IDEMPOTENCY_CONFLICT"),
  );

  const inspection = new SqliteModelPersistence(databasePath, {
    readOnly: true,
  });
  const operations = inspection.transaction((transaction) =>
    transaction.operations.listForSession(request.sessionId)
  );
  inspection.close();
  assert.equal(operations.length, 1);
  assert.match(operations[0]?.requestHash ?? "", /^hmac-sha256:[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(operations).includes(request.text), false);

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
      bytes.includes(Buffer.from(request.text, "utf8")),
      false,
      `${path} must not contain pending turn plaintext`,
    );
  }
});
